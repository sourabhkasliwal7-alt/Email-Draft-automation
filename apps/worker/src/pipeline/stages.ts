import {
  buildFactsPrompt,
  buildScreenPrompt,
  checkFacts,
  factsSchema,
  keepDate,
  parseJsonLoose,
  scoreLead,
  screenSchema,
  searchHitMatchesCompany,
  triggerTypeOf,
  type FactType,
  type PageText,
  type RawFact,
  type LeadScoreResult,
  type SkipReason,
  type TriggerType,
  type WorkflowConfig,
} from "@outreach/core";
import type { Json, Tables } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { leadEvent, must, type LeadBundle } from "./common";
import { skipLead, type Skipped } from "./run-common";

type Paid = ReturnType<typeof import("../spend").makeSpender>;

const DAY = 86_400_000;

/**
 * Where research came from. Pages, search results and facts produced by the MOCK adapters are invented demo text, so they are
 * labelled and never reused once the real adapters are on: a real run only ever reads evidence that was fetched for real.
 * Research saved before this label existed carries the old "serper+fetcher" label and counts as demo text in a real run.
 */
export const RESEARCH_LIVE = "live:serper+fetcher";
export const RESEARCH_MOCK = "mock";
export const researchIsLive = (ctx: WorkerCtx) => ctx.modes.fetcher === "live" && ctx.modes.search === "live" && ctx.modes.llm === "live";
const researchLabel = (ctx: WorkerCtx) => (researchIsLive(ctx) ? RESEARCH_LIVE : RESEARCH_MOCK);
const SITE_PATHS = ["/", "/about", "/careers", "/jobs", "/blog", "/services"];
const CACHE_DAYS = 14;
const STALE_DAYS = { hiring: 60, other: 180 };

export interface Fact {
  evidenceId: string;
  type: FactType;
  statement: string;
  quote: string;
  url: string;
  date: string | null;
  retrievedAt: string;
  trigger: TriggerType;
}

const SIGNAL_TYPE: Record<string, "funding" | "hiring" | "expansion" | "launch" | "leadership" | "other"> = { hiring: "hiring", funding: "funding", launch: "launch", "team-change": "leadership" };
const titleOf = (type: string, statement: string) => `[${type}] ${statement}`.slice(0, 400);
const TITLE_RE = /^\[([a-z-]+)\] (.*)$/s;

const isOwnHost = (url: string, domain: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").endsWith(domain);
  } catch {
    return false;
  }
};

/** Saved facts of a company (evidence rows written by this module), newest first. */
export async function loadFacts(ctx: WorkerCtx, companyId: string, devKeywords: string[]): Promise<Fact[]> {
  const all = must(await ctx.db.from("evidence_items").select("id, url, title, snippet, retrieved_at, research_runs(provider)").eq("company_id", companyId), "load facts");
  // in a real run only evidence that real adapters fetched is a fact (older demo rows of the same company are ignored)
  const rows = researchIsLive(ctx) ? all.filter((r) => r.research_runs?.provider === RESEARCH_LIVE) : all;
  const sig = must(await ctx.db.from("signals").select("evidence_item_id, signal_date").eq("company_id", companyId), "load fact dates");
  const out: Fact[] = [];
  for (const r of rows) {
    const m = TITLE_RE.exec(r.title ?? "");
    if (!m || !r.snippet) continue;
    const type = m[1] as FactType;
    const date = sig.find((s) => s.evidence_item_id === r.id)?.signal_date ?? null;
    out.push({ evidenceId: r.id, type, statement: m[2]!, quote: r.snippet, url: r.url, date, retrievedAt: r.retrieved_at, trigger: triggerTypeOf({ type, statement: m[2]!, quote: r.snippet }, devKeywords) });
  }
  return out.sort((a, b) => triggerRank(b) - triggerRank(a));
}
const TRIGGER_ORDER: TriggerType[] = ["none", "tech-change", "public-talk", "award", "expansion", "funding", "new-product", "hiring-developers"];
const triggerRank = (f: Fact) => TRIGGER_ORDER.indexOf(f.trigger) * 1000 + (f.date ? new Date(f.date).getTime() / DAY / 1000 : 0);

// ---------------------------------------------------------------- Stage A (C1): does the homepage open, and does the business fit?
type ScreenResult = ReturnType<typeof screenSchema.parse>;
export type SiteScreen = { ok: true; result: ScreenResult } | { ok: false; reason: "no-data" | "screen-failed"; detail: string };

/**
 * The quick check of one company website: open the homepage, ask the cheap model whether the business fits. It needs no lead, so
 * web discovery can run it on a company before any person is stored. Nothing is saved here.
 */
export async function screenCompanySite(ctx: WorkerCtx, paid: Paid, cfg: WorkflowConfig, company: { domain: string; name: string; market: string }): Promise<SiteScreen> {
  let page;
  try {
    page = await ctx.adapters.fetcher.fetchPage(`https://${company.domain}/`);
  } catch (e) {
    ctx.log(`screen fetch ${company.domain} failed: ${(e as Error).message}`);
    return { ok: false, reason: "no-data", detail: "homepage did not open" };
  }
  if (page.status !== 200 || !page.text.trim()) return { ok: false, reason: "no-data", detail: `homepage did not open (${page.status})` };

  const { system, prompt } = buildScreenPrompt({ name: company.name, domain: company.domain }, company.market, page.text);
  let result: ScreenResult | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    const res = await paid("llm", "screen", () => ctx.adapters.llm.complete({ tier: "cheap", model: cfg.model_screen, system, prompt, maxTokens: 200 }));
    const parsed = screenSchema.safeParse(parseJsonLoose(res.text));
    if (parsed.success) result = parsed.data;
  }
  return result ? { ok: true, result } : { ok: false, reason: "screen-failed", detail: "the quick check returned unreadable output" };
}

export async function screenLead(ctx: WorkerCtx, paid: Paid, cfg: WorkflowConfig, lead: LeadBundle): Promise<{ fit: "yes" | "uncertain"; businessType: string } | Skipped> {
  const company = lead.contacts!.companies;
  if (!company?.domain) return skipLead(ctx.db, lead, "no-data", "no company website") as Promise<Skipped>;
  const prev = (lead.score_components as { screen?: { fit: "yes" | "uncertain" | "no"; business_type: string; mode?: string } } | null)?.screen;
  // a quick check made by the mock model is not reused once the real model is on (results saved before this note count as mock)
  if (prev && (prev.mode ?? "mock") === ctx.modes.llm) {
    if (prev.fit === "no") return skipLead(ctx.db, lead, "screen-failed", prev.business_type) as Promise<Skipped>;
    // a lead that came with its quick check already done (web discovery) moves on without paying for it again
    if (lead.status === "imported") must(await ctx.db.from("campaign_leads").update({ status: "researching", icp_segment: prev.business_type }).eq("id", lead.id), "save quick check");
    return { fit: prev.fit, businessType: prev.business_type };
  }

  const market = (lead.campaigns?.icp as { industries?: string[] } | undefined)?.industries?.join(", ") ?? "";
  const screen = await screenCompanySite(ctx, paid, cfg, { domain: company.domain, name: company.name ?? company.domain, market });
  if (!screen.ok) return skipLead(ctx.db, lead, screen.reason, screen.detail) as Promise<Skipped>;
  const result = screen.result;

  const components = { ...((lead.score_components as object) ?? {}), screen: { ...result, mode: ctx.modes.llm } } as Json;
  must(await ctx.db.from("campaign_leads").update({ score_components: components, icp_segment: result.business_type, status: result.fit === "no" ? lead.status : "researching" }).eq("id", lead.id), "save quick check");
  await leadEvent(ctx.db, lead, "screened", { fit: result.fit, business_type: result.business_type });
  if (result.fit === "no") return skipLead(ctx.db, lead, "screen-failed", result.reason.slice(0, 120)) as Promise<Skipped>;
  return { fit: result.fit, businessType: result.business_type };
}

// ---------------------------------------------------------------- Stage B (C2): pages, careers, search -> facts -> exact quote check
export async function researchLead(
  ctx: WorkerCtx,
  paid: Paid,
  cfg: WorkflowConfig,
  lead: LeadBundle,
): Promise<{ facts: Fact[]; pages: number; failRate: number; cached: boolean } | Skipped> {
  const company = lead.contacts!.companies!;
  const fresh = company.research_cached_at && Date.now() - new Date(company.research_cached_at).getTime() < CACHE_DAYS * DAY;
  if (fresh) {
    const facts = await loadFacts(ctx, company.id, cfg.developer_keywords);
    if (facts.length) return { facts, pages: 2, failRate: 0, cached: true };
  }

  const pages: PageText[] = [];
  const dates = new Map<string, string>();
  for (const path of SITE_PATHS.slice(0, cfg.pages_per_site)) {
    const url = `https://${company.domain}${path}`;
    try {
      const page = await ctx.adapters.fetcher.fetchPage(url);
      if (page.status === 200 && page.text.trim()) pages.push({ url: page.url, text: page.text });
    } catch (e) {
      ctx.log(`fetch ${url} failed: ${(e as Error).message}`);
    }
  }
  const siteOnly = pages.length;
  const name = company.name ?? company.domain;
  for (const q of [`${name} funding`, `${name} hiring`]) {
    try {
      const res = await paid("search", "search", () => ctx.adapters.search.search({ query: q, num: 3 }));
      for (const hit of res.results) {
        if (!searchHitMatchesCompany(hit, { name: company.name, domain: company.domain })) continue; // look-alike companies are rejected
        if (!pages.some((p) => p.url === hit.url)) pages.push({ url: hit.url, text: `${hit.title}. ${hit.snippet}` });
        if (hit.publishedAt) dates.set(hit.url, hit.publishedAt);
      }
    } catch (e) {
      if ((e as Error).name === "CapReachedError" || (e as Error).name === "MissingPriceError") throw e;
      ctx.log(`search "${q}" failed: ${(e as Error).message}`);
    }
  }
  if (!pages.length) return skipLead(ctx.db, lead, "no-data", "no readable page or search result") as Promise<Skipped>;

  const { system, prompt } = buildFactsPrompt({ name, domain: company.domain }, pages);
  let raw: RawFact[] | null = null;
  for (let attempt = 0; attempt < 2 && !raw; attempt++) {
    const res = await paid("llm", "facts", () => ctx.adapters.llm.complete({ tier: "cheap", model: cfg.model_extract, system, prompt, maxTokens: 1500 }));
    const parsed = factsSchema.safeParse(parseJsonLoose(res.text));
    if (parsed.success) raw = parsed.data.facts;
  }
  if (!raw) return skipLead(ctx.db, lead, "extraction-suspect", "the fact extraction returned unreadable output twice") as Promise<Skipped>;

  const check = checkFacts(raw, pages);
  // dates: only those that appear next to the quote on the page (or come from the search result's own metadata)
  const pageByUrl = new Map(pages.map((p) => [p.url, p.text]));
  const now = new Date();
  const kept = check.kept
    .map((f) => ({ ...f, date: dates.get(f.source_url) ?? keepDate(f.date, f.quote, pageByUrl.get(f.source_url) ?? "") }))
    // hiring counts only when it is on the company's own site; stale facts are dropped
    .filter((f) => (f.type === "hiring" ? isOwnHost(f.source_url, company.domain) : true))
    .filter((f) => !f.date || now.getTime() - new Date(f.date).getTime() <= (f.type === "hiring" ? STALE_DAYS.hiring : STALE_DAYS.other) * DAY);

  await leadEvent(ctx.db, lead, "facts_checked", { given: raw.length, kept: kept.length, failed: check.failed.map((f) => f.reason), failRate: Number(check.failRate.toFixed(2)) });
  if (check.failRate > 0.4 && raw.length > 0) return skipLead(ctx.db, lead, "extraction-suspect", `${Math.round(check.failRate * 100)}% of the facts failed the quote check`) as Promise<Skipped>;
  if (!kept.length) return skipLead(ctx.db, lead, "no-verified-fact", raw.length ? "no fact survived the checks" : "nothing found") as Promise<Skipped>;

  // one stored row per page URL (the table is unique on company + url): keep the fact with the strongest trigger
  const byUrl = new Map<string, (typeof kept)[number]>();
  const rankOf = (f: (typeof kept)[number]) => TRIGGER_ORDER.indexOf(triggerTypeOf(f, cfg.developer_keywords));
  for (const f of kept) {
    const cur = byUrl.get(f.source_url);
    if (!cur || rankOf(f) > rankOf(cur)) byUrl.set(f.source_url, f);
  }
  const stamp = now.toISOString();
  const runKey = `facts:${lead.id}:${stamp.slice(0, 10)}:${researchLabel(ctx)}`;
  const run =
    (await ctx.db.from("research_runs").select("id").eq("idempotency_key", runKey).maybeSingle()).data ??
    must(await ctx.db.from("research_runs").insert({ company_id: company.id, campaign_lead_id: lead.id, depth: "standard", status: "completed", provider: researchLabel(ctx), idempotency_key: runKey, started_at: stamp, finished_at: stamp }).select("id").single(), "log research run");
  for (const f of byUrl.values()) {
    const own = isOwnHost(f.source_url, company.domain);
    const ev = must(
      await ctx.db
        .from("evidence_items")
        .upsert({ company_id: company.id, research_run_id: run.id, url: f.source_url, title: titleOf(f.type, f.statement), snippet: f.quote, retrieved_at: stamp, source_type: own ? "company_site" : "news", confidence: own ? 0.9 : 0.6 }, { onConflict: "company_id,url" })
        .select("id")
        .single(),
      "save fact",
    );
    must(
      await ctx.db.from("signals").upsert(
        { company_id: company.id, type: SIGNAL_TYPE[f.type] ?? "other", description: f.statement, source_url: f.source_url, source_name: new URL(f.source_url).hostname, signal_date: f.date, retrieved_at: stamp, verification: "verified", confidence: own ? 0.9 : 0.6, provider: "research", evidence_item_id: ev.id },
        { onConflict: "company_id,type,source_url", ignoreDuplicates: false },
      ),
      "save fact signal",
    );
  }
  await ctx.db.from("companies").update({ research_cached_at: stamp }).eq("id", company.id);
  must(await ctx.db.from("campaign_leads").update({ status: "researched" }).eq("id", lead.id), "status researched");
  const facts = await loadFacts(ctx, company.id, cfg.developer_keywords);
  return { facts, pages: siteOnly || pages.length, failRate: check.failRate, cached: false };
}

// ---------------------------------------------------------------- score in code (E4)
export async function scoreStoredLead(ctx: WorkerCtx, cfg: WorkflowConfig, lead: LeadBundle, facts: Fact[], pages: number): Promise<LeadScoreResult> {
  const c = lead.contacts!;
  const icp = (lead.campaigns?.icp ?? {}) as { employeeMin?: number | null; employeeMax?: number | null };
  const screen = (lead.score_components as { screen?: { fit: "yes" | "uncertain" } } | null)?.screen;
  const best = facts[0] ?? null;
  const s = scoreLead(
    {
      fit: screen?.fit ?? "uncertain", title: c.job_title, targetRoles: lead.campaigns?.target_roles ?? [], employeeCount: c.companies?.employee_count ?? null, employeeMin: icp.employeeMin, employeeMax: icp.employeeMax,
      trigger: best ? { type: best.trigger, date: best.date } : null, hasDomain: Boolean(c.companies?.domain), hasCountry: Boolean(c.country ?? c.companies?.country), hasProfileUrl: Boolean(c.profile_url), pagesRead: pages,
    },
    cfg.rubric_weights,
  );
  must(
    await ctx.db
      .from("campaign_leads")
      .update({
        status: "scored", lead_score: s.score, trigger: best ? `${best.statement}`.slice(0, 300) : null, trigger_date: best?.date ?? null, trigger_source: best?.url ?? null,
        score_components: { ...((lead.score_components as object) ?? {}), components: s.components, trigger_type: best?.trigger ?? "none", pages } as unknown as Json,
      })
      .eq("id", lead.id),
    "save score",
  );
  await leadEvent(ctx.db, lead, "scored", { score: s.score, components: s.components });
  return s;
}

export type { Tables, SkipReason };
