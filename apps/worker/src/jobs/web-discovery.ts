import type { ApolloPerson } from "@outreach/adapters";
import {
  buildDiscoveryQueries,
  companyDomainOf,
  companyNameFromResult,
  icpSchema,
  leadsToFind,
  pickBestContact,
  sourcesOf,
  type ScreenResult,
  type WorkflowConfig,
} from "@outreach/core";
import type { Json, Tables } from "@outreach/db";
import type { JobInfo, WorkerCtx } from "../ctx";
import { leadEvent, must } from "../pipeline/common";
import { loadWorkflowConfig, skipLead } from "../pipeline/run-common";
import { offerOf, researchIsLive, screenCompanySite } from "../pipeline/stages";
import { makeSpender } from "../spend";
import { importApolloPeople } from "./apollo-pull";
import { loadSuppression } from "./import";

type Campaign = Tables<"campaigns">;

export const WEB_LEAD_SOURCE = "web_discovery";
/** companies that earlier had nobody to write to are looked up again, for free, at most this many per run */
const RECHECK_LIMIT = 15;

export interface WebCompany {
  domain: string;
  name: string;
  query: string;
  outcome: "lead" | "no-contact" | "failed-check" | "no-data";
}
export interface WebFindResult {
  /** every query that was built (or typed) for this campaign, in order */
  queries: string[];
  queriesRun: number;
  /** search results read (all queries together) */
  results: number;
  /** new company websites left after the filters */
  kept: number;
  /** company websites that got the quick check */
  checked: number;
  /** companies that passed the quick check and got a person to write to */
  contacts: number;
  /** companies that passed the quick check but have nobody to write to (listed in Needs attention) */
  noContact: number;
  /** companies that had no contact before and got one now (free look-up) */
  revived: number;
  skipped: { excluded: number; known: number; failedCheck: number; noData: number };
  /** the leads kept in Needs attention because nobody was found (for the run report) */
  noContactLeadIds: string[];
  /** up to 50 companies with what happened to them */
  companies: WebCompany[];
  note?: string;
  /** true when Apollo is not live: the people are made up (demo) or, in a real run, not searched at all */
  demo: boolean;
}

const isHardStop = (e: unknown) => ["CapReachedError", "MissingPriceError"].includes((e as Error).name);

/** Why web discovery is not run at all (null = run). Made-up search results must never reach real pages, a real model or real Apollo. */
export function webSkipReason(ctx: WorkerCtx): string | null {
  if (ctx.modes.search !== "live" && (ctx.modes.fetcher === "live" || ctx.modes.llm === "live" || ctx.modes.apollo === "live")) {
    return "Google search is in demo mode (no Serper key yet): nothing was searched. Add SERPER_API_KEY and set ADAPTER_SEARCH=live in .env, then restart.";
  }
  return null;
}

/** People are searched only with live Apollo, or in a demo where nothing is real. Made-up people never join a real run. */
const apolloUsable = (ctx: WorkerCtx) => ctx.modes.apollo === "live" || !researchIsLive(ctx);

async function ensureCompany(ctx: WorkerCtx, domain: string, name: string): Promise<string> {
  must(await ctx.db.from("companies").upsert({ domain, name, website: `https://${domain}` }, { onConflict: "domain", ignoreDuplicates: true }), "save company");
  return must(await ctx.db.from("companies").select("id").eq("domain", domain).single(), "load company").id;
}

/** The free Apollo people search for one company website, narrowed to the campaign's target titles. */
async function findPerson(ctx: WorkerCtx, campaign: Campaign, seniorities: string[], domain: string, step: string, jobId: string): Promise<ApolloPerson | null> {
  const paid = makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId, step });
  const res = await paid("apollo", "search_people_by_domain", () =>
    ctx.adapters.apollo.searchPeople({ titles: campaign.target_roles, seniorities, keywords: [], locations: [], domains: [domain], perPage: 10 }, 1),
  );
  return pickBestContact(res.people, campaign.target_roles);
}

/** Companies that had no contact in an earlier run: ask Apollo again (free). A person who is found makes the lead a normal one. */
async function recheckNoContact(ctx: WorkerCtx, campaign: Campaign, seniorities: string[], jobId: string, blocked: Set<string>): Promise<number> {
  const rows = must(
    await ctx.db
      .from("campaign_leads")
      .select("id, contact_id, contacts(id, companies(domain))")
      .eq("campaign_id", campaign.id)
      .eq("lead_source", WEB_LEAD_SOURCE)
      .eq("status", "disqualified")
      .contains("reason_codes", ["no-contact"])
      .order("created_at")
      .limit(RECHECK_LIMIT),
    "load companies without a contact",
  );
  let revived = 0;
  for (const l of rows) {
    const domain = l.contacts?.companies?.domain;
    if (!domain || blocked.has(domain)) continue;
    try {
      const person = await findPerson(ctx, campaign, seniorities, domain, `webRecheck:${domain}`, jobId);
      if (!person) continue;
      must(
        await ctx.db
          .from("contacts")
          .update({ first_name: person.firstName, last_name: person.lastName, full_name: `${person.firstName} ${person.lastName}`.trim(), job_title: person.title, profile_url: person.linkedinUrl })
          .eq("id", l.contact_id),
        "save the contact",
      );
      const { data: has } = await ctx.db.from("enrichment_results").select("id").eq("contact_id", l.contact_id).eq("provider", "apollo").limit(1).maybeSingle();
      if (!has) await ctx.db.from("enrichment_results").insert({ contact_id: l.contact_id, provider: "apollo", result: { person_id: person.id } as Json, credits_used: 0 });
      must(await ctx.db.from("campaign_leads").update({ status: "imported", reason_codes: [], next_action: null }).eq("id", l.id), "reopen the lead");
      await leadEvent(ctx.db, { id: l.id, contact_id: l.contact_id }, "contact_found", { domain, title: person.title });
      revived++;
    } catch (e) {
      if (isHardStop(e)) throw e;
      ctx.log(`contact look-up for ${domain} failed: ${(e as Error).message}`);
    }
  }
  return revived;
}

/**
 * Web discovery: search Google (Serper) for companies, keep only company websites, run the quick check on each new one, then find the
 * person to write to with a free Apollo search by company website. Everything after that is the normal flow (research, approve, reveal,
 * verify, write, Gmail draft). Stops as soon as `want` people are found, so no search or check is paid for more than needed.
 * A company that passed the check but has nobody to write to is kept as a lead in Needs attention ("No contact found"): no email is guessed.
 */
export async function discoverFromWeb(ctx: WorkerCtx, campaign: Campaign, batch: { id: string; started_by: string | null }, job: JobInfo, want: number, cfg: WorkflowConfig): Promise<WebFindResult> {
  const icp = icpSchema.parse(campaign.icp ?? {});
  const result: WebFindResult = {
    queries: [], queriesRun: 0, results: 0, kept: 0, checked: 0, contacts: 0, noContact: 0, revived: 0, noContactLeadIds: [],
    skipped: { excluded: 0, known: 0, failedCheck: 0, noData: 0 }, companies: [], demo: ctx.modes.apollo !== "live",
  };
  const note = (n: string) => (result.note = result.note ? `${result.note}; ${n}` : n);
  const addCompany = (c: WebCompany) => {
    if (result.companies.length < 50) result.companies.push(c);
  };
  const sup = await loadSuppression(ctx.db, campaign.id);
  const canFindPeople = apolloUsable(ctx);

  if (canFindPeople) result.revived = await recheckNoContact(ctx, campaign, icp.seniorities, job.jobId, sup.domains);

  result.queries = buildDiscoveryQueries({ industries: icp.industries, countries: icp.countries, developerKeywords: icp.keywordsInclude, custom: icp.webQueries, max: icp.webMaxQueries });
  if (want <= 0) {
    note("the leads already in the campaign are enough for today");
    return result;
  }

  const search = makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId: job.jobId, step: "webDiscovery" });
  const offer = await offerOf(ctx, campaign.offer_id);
  const seen = new Set<string>();
  const picks: { person: ApolloPerson; domain: string; name: string; query: string; screen: ScreenResult }[] = [];

  for (const query of result.queries) {
    if (picks.length >= want) break;
    let hits;
    try {
      hits = (await search("search", "web_discovery", () => ctx.adapters.search.search({ query, num: icp.webMaxResults }))).results.slice(0, icp.webMaxResults);
    } catch (e) {
      if (isHardStop(e)) throw e;
      note(`Google search failed (${(e as Error).message.slice(0, 150)})`);
      break;
    }
    result.queriesRun++;
    result.results += hits.length;

    // only company websites, once each, and none that we already know (a lead, a company we checked before, or a suppressed domain)
    const found: { domain: string; name: string }[] = [];
    for (const hit of hits) {
      const domain = companyDomainOf(hit.url, cfg.web_exclude_domains);
      if (!domain) {
        result.skipped.excluded++;
        continue;
      }
      if (seen.has(domain)) continue;
      seen.add(domain);
      found.push({ domain, name: companyNameFromResult(hit.title, domain) });
    }
    const stored = new Set(found.length ? must(await ctx.db.from("companies").select("domain").in("domain", found.map((f) => f.domain)), "check known companies").map((c) => c.domain) : []);
    const fresh = found.filter((f) => {
      const known = stored.has(f.domain) || sup.domains.has(f.domain);
      if (known) result.skipped.known++;
      return !known;
    });
    result.kept += fresh.length;

    for (const c of fresh) {
      if (picks.length >= want) break;
      result.checked++;
      let screen: Awaited<ReturnType<typeof screenCompanySite>>;
      try {
        screen = await screenCompanySite(ctx, makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId: job.jobId, step: `webScreen:${c.domain}` }), cfg, { domain: c.domain, name: c.name, market: icp.industries.join(", "), offer });
      } catch (e) {
        if (isHardStop(e)) throw e;
        ctx.log(`quick check of ${c.domain} failed: ${(e as Error).message}`);
        result.skipped.noData++;
        addCompany({ ...c, query, outcome: "no-data" });
        continue;
      }
      // every checked website is stored, so it is never checked (and paid for) twice
      const companyId = await ensureCompany(ctx, c.domain, c.name);
      if (!screen.ok || screen.result.fit === "no") {
        if (!screen.ok && screen.reason === "no-data") result.skipped.noData++;
        else result.skipped.failedCheck++;
        addCompany({ ...c, query, outcome: !screen.ok && screen.reason === "no-data" ? "no-data" : "failed-check" });
        continue;
      }

      let person: ApolloPerson | null = null;
      let why = "Apollo is not connected (demo mode), so nobody was looked up";
      if (canFindPeople) {
        try {
          person = await findPerson(ctx, campaign, icp.seniorities, c.domain, `webPeople:${c.domain}`, job.jobId);
          why = "Apollo found nobody for the target titles";
        } catch (e) {
          if (isHardStop(e)) throw e;
          why = `Apollo search failed: ${(e as Error).message.slice(0, 120)}`;
          ctx.log(`people search for ${c.domain} failed: ${(e as Error).message}`);
        }
      }
      if (person) {
        picks.push({ person, domain: c.domain, name: c.name, query, screen: screen.result });
        addCompany({ ...c, query, outcome: "lead" });
        continue;
      }
      // nobody to write to: the company is kept in Needs attention with what we know, and no email is ever guessed
      const contact = must(await ctx.db.from("contacts").insert({ company_id: companyId, company_name: c.name }).select("id").single(), "save the company");
      const lead = must(
        await ctx.db
          .from("campaign_leads")
          .insert({ campaign_id: campaign.id, contact_id: contact.id, lead_source: WEB_LEAD_SOURCE, source_detail: query, status: "imported", icp_segment: screen.result.business_type, score_components: { screen: { ...screen.result, mode: ctx.modes.llm } } as unknown as Json })
          .select("id, contact_id")
          .single(),
        "save the lead",
      );
      await leadEvent(ctx.db, lead, "web_discovery", { query, domain: c.domain });
      await skipLead(ctx.db, lead, "no-contact", `${c.name} (${c.domain}), ${screen.result.business_type}. ${why}`.slice(0, 400));
      result.noContact++;
      result.noContactLeadIds.push(lead.id);
      addCompany({ ...c, query, outcome: "no-contact" });
    }
  }

  if (picks.length) {
    const people = picks.map((p) => ({ ...p.person, organization: { name: p.person.organization?.name ?? p.name, domain: p.domain, industry: null, employeeCount: null } }));
    const { contacts } = await importApolloPeople(ctx, campaign, batch, job.jobId, people, "web");
    for (const p of picks) {
      const contactId = contacts.get(p.person.id);
      if (!contactId) {
        // the person was a duplicate or suppressed: the importer already counted and explained it
        result.skipped.known++;
        const entry = result.companies.find((c) => c.domain === p.domain);
        if (entry) result.companies.splice(result.companies.indexOf(entry), 1);
        continue;
      }
      const lead = must(
        await ctx.db
          .from("campaign_leads")
          .update({ lead_source: WEB_LEAD_SOURCE, source_detail: p.query, icp_segment: p.screen.business_type, score_components: { screen: { ...p.screen, mode: ctx.modes.llm } } as unknown as Json })
          .eq("campaign_id", campaign.id)
          .eq("contact_id", contactId)
          .select("id, contact_id")
          .single(),
        "mark the lead as found on the web",
      );
      await leadEvent(ctx.db, lead, "web_discovery", { query: p.query, domain: p.domain, title: p.person.title });
      result.contacts++;
    }
  }
  if (!result.queriesRun && !result.note) note("no search ran");
  return result;
}

export interface WebFindPayload {
  campaignId: string;
}

/**
 * "Find companies on Google": the same search a run does, for one campaign, without the research. The companies that pass the quick
 * check and have a person to write to join the campaign's leads; nothing is revealed and nothing is written.
 */
export async function webFindJob(ctx: WorkerCtx, payload: WebFindPayload, job: JobInfo): Promise<WebFindResult> {
  const campaign = must(await ctx.db.from("campaigns").select("*").eq("id", payload.campaignId).is("deleted_at", null).single(), "load campaign");
  const icp = icpSchema.parse(campaign.icp ?? {});
  const empty = (note: string): WebFindResult => ({ queries: [], queriesRun: 0, results: 0, kept: 0, checked: 0, contacts: 0, noContact: 0, revived: 0, noContactLeadIds: [], skipped: { excluded: 0, known: 0, failedCheck: 0, noData: 0 }, companies: [], note, demo: ctx.modes.apollo !== "live" });
  if (!sourcesOf(icp).includes("web")) return empty("This campaign does not use Web discovery. Tick it in the campaign on the Setup page.");
  const why = webSkipReason(ctx);
  if (why) return empty(why);
  const cfg = await loadWorkflowConfig(ctx.db);
  return discoverFromWeb(ctx, campaign, { id: job.jobId, started_by: null }, job, leadsToFind(campaign.daily_cap, cfg.approval_rate), cfg);
}
