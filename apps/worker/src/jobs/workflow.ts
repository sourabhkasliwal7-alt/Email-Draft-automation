import type { ApolloFilters } from "@outreach/adapters";
import { icpSchema, pipelineJobKey } from "@outreach/core";
import type { Json, Tables } from "@outreach/db";
import type { ParsedTable } from "@outreach/importer";
import type { JobInfo, WorkerCtx } from "../ctx";
import { makeSpender } from "../spend";
import { must, refreshBatch } from "../pipeline/common";
import { importTable } from "./import";

export interface WorkflowPayload {
  batchId: string;
}

const HEADERS = ["Apollo ID", "First Name", "Last Name", "Title", "Company", "Website", "Industry", "# Employees", "Country", "Profile URL"];
const APOLLO_MAPPING = {
  fields: { first_name: "First Name", last_name: "Last Name", job_title: "Title", company_name: "Company", company_domain: "Website", industry: "Industry", employee_count: "# Employees", country: "Country", profile_url: "Profile URL" },
} as const;

export interface PullSummary {
  source: "apollo" | "csv";
  found: number;
  new: number;
  duplicates: number;
  suppressed: number;
  invalid: number;
  pages: number;
  filters?: ApolloFilters;
  note?: string;
}

/**
 * Apollo search -> an import batch built from the results and run through the SAME engine as a CSV upload
 * (normalise, validate, dedupe, suppression/DNC). Search returns no emails; they are revealed later, after qualification.
 */
async function pullFromApollo(ctx: WorkerCtx, campaign: Tables<"campaigns">, batch: Tables<"pipeline_batches">, job: JobInfo): Promise<PullSummary> {
  const icp = icpSchema.parse(campaign.icp ?? {});
  const filters: ApolloFilters = {
    titles: campaign.target_roles, seniorities: [], keywords: icp.industries, locations: icp.countries, employeeMin: icp.employeeMin, employeeMax: icp.employeeMax, perPage: 25,
  };
  const spend = makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId: job.jobId, step: "apolloPull" });
  const people: Awaited<ReturnType<typeof ctx.adapters.apollo.searchPeople>>["people"] = [];
  let page = 1;
  let totalPages = 1;
  while (people.length < icp.maxLeadsPerRun && page <= totalPages) {
    const res = await spend("apollo", "search_people", () => ctx.adapters.apollo.searchPeople(filters, page));
    people.push(...res.people);
    totalPages = res.totalPages;
    page++;
  }
  const picked = people.slice(0, icp.maxLeadsPerRun);
  if (!picked.length) return { source: "apollo", found: 0, new: 0, duplicates: 0, suppressed: 0, invalid: 0, pages: page - 1, filters, note: "Apollo returned no people for these filters" };

  const importBatch = must(
    await ctx.db
      .from("import_batches")
      .insert({ file_name: `apollo-pull-${batch.id.slice(0, 8)}`, file_hash: `apollo:${batch.id}`, campaign_id: campaign.id, mapping: APOLLO_MAPPING as unknown as Json, mode: "add_new", status: "mapped", runs: 1, user_id: batch.started_by })
      .select("*")
      .single(),
    "create apollo import batch",
  );
  const rows = picked.map((p) => [p.id, p.firstName, p.lastName, p.title ?? "", p.organization?.name ?? "", p.organization?.domain ?? "", p.organization?.industry ?? "", String(p.organization?.employeeCount ?? ""), p.country ?? "", p.linkedinUrl ?? ""]);
  const table: ParsedTable = {
    sheetNames: ["apollo"], sheet: "apollo", headers: HEADERS, rawHeaders: HEADERS, hasHeader: true, rows, rowNumbers: rows.map((_, i) => i + 2), blankRows: 0, encoding: null, delimiter: null, warnings: [],
  };
  const totals = await importTable(ctx.db, importBatch, { requireEmail: false, stored: APOLLO_MAPPING as never, run: 1 }, table, ctx.log);

  // remember each person's Apollo id so the email can be revealed after qualification
  const imported = must(await ctx.db.from("import_rows").select("contact_id, original, status").eq("batch_id", importBatch.id).in("status", ["imported", "updated"]), "load imported apollo rows");
  for (const r of imported) {
    if (!r.contact_id) continue;
    const personId = (r.original as Record<string, string>)["Apollo ID"];
    const { data: has } = await ctx.db.from("enrichment_results").select("id").eq("contact_id", r.contact_id).eq("provider", "apollo").limit(1).maybeSingle();
    if (!has && personId) await ctx.db.from("enrichment_results").insert({ contact_id: r.contact_id, provider: "apollo", result: { person_id: personId } as Json, credits_used: 0 });
  }
  return { source: "apollo", found: picked.length, new: totals.imported, duplicates: totals.duplicate, suppressed: totals.suppressed, invalid: totals.invalid, pages: page - 1, filters };
}

/** "Start workflow": get leads (Apollo pull, or the CSV-imported leads already in the campaign), then fan out one job per lead. */
export async function workflowStartJob(ctx: WorkerCtx, payload: WorkflowPayload, job: JobInfo) {
  const { db } = ctx;
  const batch = must(await db.from("pipeline_batches").select("*").eq("id", payload.batchId).single(), "load workflow batch");
  const campaign = must(await db.from("campaigns").select("*").eq("id", batch.campaign_id).single(), "load campaign");
  const icp = icpSchema.parse(campaign.icp ?? {});

  let pull: PullSummary = { source: "csv", found: 0, new: 0, duplicates: 0, suppressed: 0, invalid: 0, pages: 0 };
  if (icp.leadSource === "apollo") {
    try {
      pull = await pullFromApollo(ctx, campaign, batch, job);
    } catch (e) {
      const name = (e as Error).name;
      if (name === "CapReachedError" || name === "MissingPriceError") throw e;
      // 401/403, no API access, or not built yet: say so plainly and carry on with the leads already in the campaign
      pull = { ...pull, note: `Apollo is not available (${(e as Error).message}). Using the leads already imported from CSV.` };
      ctx.log(`apollo pull failed: ${(e as Error).message}`);
    }
  }

  const leads = must(
    await db.from("campaign_leads").select("id").eq("campaign_id", campaign.id).eq("status", "imported").order("created_at").limit(icp.maxLeadsPerRun),
    "load leads to process",
  );
  if (leads.length) {
    must(
      await db.from("jobs").upsert(
        leads.map((l) => ({ type: "lead.pipeline", idempotency_key: pipelineJobKey(batch.id, l.id), payload: { batchId: batch.id, campaignLeadId: l.id } as Json, campaign_id: campaign.id, batch_id: batch.id, campaign_lead_id: l.id })),
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      ),
      "fan out lead jobs",
    );
  }
  must(await db.from("pipeline_batches").update({ fanout_done: true, totals: { ...(batch.totals as object), pull, fanned: leads.length } as unknown as Json }).eq("id", batch.id), "save fan-out");
  await refreshBatch(db, batch.id);
  return { fanned: leads.length, pull };
}
