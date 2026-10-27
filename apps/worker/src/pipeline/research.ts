import type { Tables } from "@outreach/db";
import { buildExtractPrompt, classifyVerification, extractionSchema, guardExtracted, parseJsonLoose, researchRunKey, searchHitMatchesCompany, type ExtractedItem, type SourceText } from "@outreach/core";
import type { WorkerCtx } from "../ctx";
import { must } from "./common";

type Paid = ReturnType<typeof import("../spend").makeSpender>;

export interface EvidenceRow {
  id: string;
  url: string;
  snippet: string;
  retrieved_at: string;
  source_type: string;
  signal_type: string | null;
  verification: string | null;
  signal_date: string | null;
}

const CACHE_DAYS = 14;
const PAGES = ["/", "/about", "/careers"];

/** Evidence best suited for a first email: verified hiring/funding first, then newest. */
function rank(e: EvidenceRow): number {
  const v = e.verification === "verified" ? 0 : e.verification === "possible" ? 10 : 20;
  const t = e.signal_type === "hiring" ? 0 : e.signal_type === "funding" ? 1 : 2;
  return v + t;
}

export async function loadEvidence(ctx: WorkerCtx, companyId: string): Promise<EvidenceRow[]> {
  const ev = must(await ctx.db.from("evidence_items").select("id, url, snippet, retrieved_at, source_type").eq("company_id", companyId), "load evidence");
  const sig = must(await ctx.db.from("signals").select("type, verification, signal_date, source_url, evidence_item_id").eq("company_id", companyId), "load signals");
  const rows = ev.map((e) => {
    const s = sig.find((x) => x.evidence_item_id === e.id) ?? sig.find((x) => x.source_url === e.url);
    return { ...e, snippet: e.snippet ?? "", signal_type: s?.type ?? null, verification: s?.verification ?? null, signal_date: s?.signal_date ?? null } satisfies EvidenceRow;
  });
  return rows.filter((r) => r.snippet && r.verification !== "stale").sort((a, b) => rank(a) - rank(b) || b.retrieved_at.localeCompare(a.retrieved_at)).slice(0, 5);
}

/**
 * Website (home, about, careers) + two search queries -> a cheap-model extraction -> the anti-hallucination guard ->
 * evidence_items (URL + retrieval date) and signals. Cached per company for 14 days; other contacts reuse it.
 */
export async function researchCompany(
  ctx: WorkerCtx,
  paid: Paid,
  company: Tables<"companies">,
  ids: { jobId: string; campaignLeadId: string },
  depth: "light" | "standard" | "deep",
): Promise<{ evidence: EvidenceRow[]; cached: boolean; dropped: number; lowConfidence: boolean }> {
  const fresh = company.research_cached_at && Date.now() - new Date(company.research_cached_at).getTime() < CACHE_DAYS * 86_400_000;
  if (fresh) {
    const evidence = await loadEvidence(ctx, company.id);
    if (evidence.length) return { evidence, cached: true, dropped: 0, lowConfidence: false };
  }

  const sources: SourceText[] = [];
  const dates = new Map<string, string>();
  for (const path of depth === "light" ? PAGES.slice(0, 1) : PAGES) {
    const url = `https://${company.domain}${path === "/" ? "/" : path}`;
    try {
      const page = await ctx.adapters.fetcher.fetchPage(url);
      if (page.status === 200 && page.text.trim()) sources.push({ url: page.url, text: page.text });
    } catch (e) {
      ctx.log(`fetch ${url} failed: ${(e as Error).message}`);
    }
  }
  const name = company.name ?? company.domain;
  const queries = depth === "light" ? [`${name} funding`] : [`${name} funding`, `${name} hiring`];
  for (const q of queries) {
    try {
      const res = await paid("search", "search", () => ctx.adapters.search.search({ query: q, num: 3 }));
      for (const hit of res.results) {
        if (!searchHitMatchesCompany(hit, { name: company.name, domain: company.domain })) continue; // look-alike companies are rejected
        if (!sources.some((s) => s.url === hit.url)) sources.push({ url: hit.url, text: `${hit.title}. ${hit.snippet}` });
        if (hit.publishedAt) dates.set(hit.url, hit.publishedAt);
      }
    } catch (e) {
      if ((e as Error).name === "CapReachedError" || (e as Error).name === "MissingPriceError") throw e;
      ctx.log(`search "${q}" failed: ${(e as Error).message}`);
    }
  }

  const run = must(
    await ctx.db
      .from("research_runs")
      .upsert({ company_id: company.id, campaign_lead_id: ids.campaignLeadId, depth, status: "running", provider: "serper+fetcher", idempotency_key: researchRunKey(ids.jobId), started_at: new Date().toISOString() }, { onConflict: "idempotency_key" })
      .select("id")
      .single(),
    "start research run",
  );

  if (!sources.length) {
    await ctx.db.from("research_runs").update({ status: "completed", finished_at: new Date().toISOString(), error: "no readable sources (site down, empty or blocked)" }).eq("id", run.id);
    return { evidence: [], cached: false, dropped: 0, lowConfidence: true };
  }

  const { system, prompt } = buildExtractPrompt({ name: company.name, domain: company.domain }, sources);
  let items: ExtractedItem[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await paid("llm", "extract", () => ctx.adapters.llm.complete({ tier: "cheap", system, prompt, maxTokens: 1200 }));
    const parsed = extractionSchema.safeParse(parseJsonLoose(res.text));
    if (parsed.success) {
      items = parsed.data.items;
      break;
    }
    if (attempt === 1) throw new Error("extraction returned invalid JSON twice");
  }

  const { kept, dropped } = guardExtracted(items, sources);
  if (dropped.length) ctx.log(`research ${company.domain}: dropped ${dropped.length} unsupported item(s): ${dropped.map((d) => d.reason).join(", ")}`);

  const now = new Date().toISOString();
  const evidenceIdByUrl = new Map<string, string>();
  for (const item of kept) {
    if (evidenceIdByUrl.has(item.source_url)) continue;
    const own = new URL(item.source_url).hostname.replace(/^www\./, "").endsWith(company.domain);
    const row = must(
      await ctx.db
        .from("evidence_items")
        .upsert(
          { company_id: company.id, research_run_id: run.id, url: item.source_url, title: item.description.slice(0, 120), snippet: item.snippet, retrieved_at: now, source_type: own ? "company_site" : "news", confidence: own ? 0.9 : 0.6 },
          { onConflict: "company_id,url" },
        )
        .select("id")
        .single(),
      "save evidence",
    );
    evidenceIdByUrl.set(item.source_url, row.id);
  }
  for (const item of kept) {
    const published = dates.get(item.source_url) ?? null;
    const verification = classifyVerification(item, company.domain, published ? new Date(published) : null);
    must(
      await ctx.db.from("signals").upsert(
        { company_id: company.id, type: item.type, description: item.description, source_url: item.source_url, source_name: new URL(item.source_url).hostname, signal_date: published, retrieved_at: now, verification, confidence: verification === "verified" ? 0.9 : 0.5, provider: "research", evidence_item_id: evidenceIdByUrl.get(item.source_url) ?? null },
        { onConflict: "company_id,type,source_url", ignoreDuplicates: true },
      ),
      "save signal",
    );
  }
  await ctx.db.from("companies").update({ research_cached_at: now }).eq("id", company.id);
  await ctx.db.from("research_runs").update({ status: "completed", finished_at: now, error: dropped.length ? `${dropped.length} unsupported item(s) dropped by the guard` : null }).eq("id", run.id);

  const evidence = await loadEvidence(ctx, company.id);
  return { evidence, cached: false, dropped: dropped.length, lowConfidence: evidence.length === 0 };
}
