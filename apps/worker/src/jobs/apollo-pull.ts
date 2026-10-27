import type { ApolloFilters } from "@outreach/adapters";
import { icpSchema, type WorkflowConfig } from "@outreach/core";
import type { Json, Tables } from "@outreach/db";
import type { JobInfo, WorkerCtx } from "../ctx";
import { must } from "../pipeline/common";
import { creditsUsed } from "../pipeline/reveal";
import { makeSpender } from "../spend";
import { importTable } from "./import";

type Campaign = Tables<"campaigns">;

export interface PullResult {
  found: number;
  imported: number;
  duplicate: number;
  suppressed: number;
  invalid: number;
  note?: string;
}

const HEADERS = ["Apollo ID", "First Name", "Last Name", "Title", "Company", "Website", "Industry", "# Employees", "Country", "Profile URL"];
const APOLLO_MAPPING = {
  fields: { first_name: "First Name", last_name: "Last Name", job_title: "Title", company_name: "Company", company_domain: "Website", industry: "Industry", employee_count: "# Employees", country: "Country", profile_url: "Profile URL" },
} as const;

/** Apollo's company search charges 1 credit per page; a run never reads more pages than this. */
const MAX_SEARCH_PAGES = 3;

/**
 * The Apollo search filters of a campaign: the campaign's own target (roles, industries and keywords, countries, employee range)
 * plus the Apollo-only extras (seniority, hiring). Nothing has to be filled in twice.
 */
export function apolloFiltersFor(campaign: Campaign, cfg: WorkflowConfig): ApolloFilters {
  const icp = icpSchema.parse(campaign.icp ?? {});
  return {
    titles: campaign.target_roles,
    seniorities: icp.seniorities,
    keywords: [...new Set([...icp.industries, ...icp.keywordsInclude])],
    locations: icp.countries.length ? icp.countries : cfg.countries_in_scope,
    employeeMin: icp.employeeMin,
    employeeMax: icp.employeeMax,
    hiringTitles: icp.hiringTitles,
    minOpenJobs: icp.minOpenJobs,
    perPage: 25,
  };
}

/**
 * Apollo people search, imported through the same engine as a CSV (duplicates, do-not-contact and suppression are checked there).
 * The search returns no emails; each person's Apollo id is remembered so the email can be revealed later, for approved leads only.
 * Every Apollo credit the search costs (1 per page of companies, at most 3 pages a run) is recorded as usage and shown on Home.
 */
export async function pullFromApollo(ctx: WorkerCtx, campaign: Campaign, batch: { id: string; started_by: string | null }, job: JobInfo, want: number, cfg: WorkflowConfig): Promise<PullResult> {
  const filters = apolloFiltersFor(campaign, cfg);
  const spend = makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId: job.jobId, step: "apolloPull" });
  const people: Awaited<ReturnType<typeof ctx.adapters.apollo.searchPeople>>["people"] = [];
  let page = 1;
  let totalPages = 1;
  let stoppedByLimit = false;
  const before = await creditsUsed(ctx);
  while (people.length < want && page <= totalPages && page <= Math.min(cfg.max_pages_per_run, MAX_SEARCH_PAGES)) {
    // nothing to find people for once the day's or month's reveal limit is used up
    if (before.today >= cfg.daily_reveal_cap || before.month >= cfg.monthly_credit_cap) {
      stoppedByLimit = true;
      break;
    }
    const res = await spend("apollo", "search_people", () => ctx.adapters.apollo.searchPeople(filters, page));
    people.push(...res.people);
    totalPages = res.totalPages;
    page++;
  }
  const picked = people.slice(0, want);
  if (!picked.length) {
    return { found: 0, imported: 0, duplicate: 0, suppressed: 0, invalid: 0, note: stoppedByLimit ? "Apollo credit limit reached: nothing was searched" : "Apollo returned no people for these filters" };
  }

  const importBatch = must(
    await ctx.db
      .from("import_batches")
      .insert({ file_name: `apollo-pull-${batch.id.slice(0, 8)}`, file_hash: `apollo:${job.jobId}`, campaign_id: campaign.id, mapping: APOLLO_MAPPING as unknown as Json, mode: "add_new", status: "mapped", runs: 1, user_id: batch.started_by })
      .select("*")
      .single(),
    "create apollo import batch",
  );
  const rows = picked.map((p) => [p.id, p.firstName, p.lastName, p.title ?? "", p.organization?.name ?? "", p.organization?.domain ?? "", p.organization?.industry ?? "", String(p.organization?.employeeCount ?? ""), p.country ?? "", p.linkedinUrl ?? ""]);
  const table = { sheetNames: ["apollo"], sheet: "apollo", headers: HEADERS, rawHeaders: HEADERS, hasHeader: true, rows, rowNumbers: rows.map((_, i) => i + 2), blankRows: 0, encoding: null, delimiter: null, warnings: [] };
  const totals = await importTable(ctx.db, importBatch, { requireEmail: false, stored: APOLLO_MAPPING as never, run: 1 }, table, ctx.log);

  // remember each person's Apollo id so the email can be revealed later, after approval
  const imported = must(await ctx.db.from("import_rows").select("contact_id, original").eq("batch_id", importBatch.id).in("status", ["imported", "updated"]), "load imported apollo rows");
  for (const r of imported) {
    if (!r.contact_id) continue;
    const personId = (r.original as Record<string, string>)["Apollo ID"];
    const { data: has } = await ctx.db.from("enrichment_results").select("id").eq("contact_id", r.contact_id).eq("provider", "apollo").limit(1).maybeSingle();
    if (!has && personId) await ctx.db.from("enrichment_results").insert({ contact_id: r.contact_id, provider: "apollo", result: { person_id: personId } as Json, credits_used: 0 });
  }
  return { found: picked.length, imported: totals.imported, duplicate: totals.duplicate, suppressed: totals.suppressed, invalid: totals.invalid, note: stoppedByLimit ? "stopped early: Apollo credit limit reached" : undefined };
}
