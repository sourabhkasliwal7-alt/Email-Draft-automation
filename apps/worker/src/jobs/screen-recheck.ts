import type { Json } from "@outreach/db";
import type { JobInfo, WorkerCtx } from "../ctx";
import { leadEvent, loadLead, must } from "../pipeline/common";
import { isSkipped, loadWorkflowConfig, mapLimit, skipLead } from "../pipeline/run-common";
import { screenLead } from "../pipeline/stages";
import { makeSpender } from "../spend";
import { suppressionHalt } from "./suppression";

/** The reasons a lead can be given a second quick check for: "not a good fit" and "could not read the website". */
export const RECHECK_REASONS = ["screen-failed", "no-data"] as const;

export interface ScreenRecheckPayload {
  campaignId: string;
}
export interface ScreenRecheckResult {
  /** leads that were skipped at the quick check and got a new one */
  total: number;
  /** now yes or uncertain: they continue with the next Start run */
  passed: number;
  /** the quick check still says no */
  stillNo: number;
  /** the website still could not be read */
  stillUnreadable: number;
  /** left out: on the do-not-contact list now */
  suppressed: number;
  /** the quick check hit an error; the lead keeps its earlier reason */
  failed: number;
  note?: string;
}

/**
 * "Re-check skipped leads": runs the quick check again, only for the leads of one campaign that were skipped as screen-failed or
 * no-data. Nothing else is repeated or paid for: other leads are not touched, and a lead that passes simply waits at the research step
 * for the next run. The do-not-contact list is checked first.
 */
export async function screenRecheckJob(ctx: WorkerCtx, payload: ScreenRecheckPayload, job: JobInfo): Promise<ScreenRecheckResult> {
  const result: ScreenRecheckResult = { total: 0, passed: 0, stillNo: 0, stillUnreadable: 0, suppressed: 0, failed: 0 };
  const campaign = must(await ctx.db.from("campaigns").select("id").eq("id", payload.campaignId).is("deleted_at", null).single(), "load campaign");
  const cfg = await loadWorkflowConfig(ctx.db);
  const rows = must(await ctx.db.from("campaign_leads").select("id, reason_codes").eq("campaign_id", campaign.id).eq("status", "disqualified").order("created_at").limit(500), "load skipped leads");
  const ids = rows.filter((r) => (RECHECK_REASONS as readonly string[]).includes(r.reason_codes[0] ?? "")).map((r) => ({ id: r.id, reason: r.reason_codes }));
  if (!ids.length) return { ...result, note: "No lead was skipped at the quick check." };

  await mapLimit(ids, 3, () => false, async ({ id, reason }) => {
    const lead = await loadLead(ctx.db, id);
    if (lead.status !== "disqualified") return;
    const halt = await suppressionHalt(ctx, lead);
    if (halt) {
      result.suppressed++;
      return;
    }
    result.total++;
    const { screen: _old, ...rest } = ((lead.score_components as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    void _old;
    // the earlier answer is dropped so the check is made again (a saved "no" would otherwise be reused)
    must(await ctx.db.from("campaign_leads").update({ status: "imported", reason_codes: [], next_action: null, score_components: rest as Json }).eq("id", id), "reopen lead");
    await leadEvent(ctx.db, lead, "rechecked", { earlier: reason });
    try {
      const out = await screenLead(ctx, makeSpender(ctx, { campaignId: campaign.id, leadId: id, jobId: job.jobId, step: "screen" }), cfg, await loadLead(ctx.db, id));
      if (!isSkipped(out)) result.passed++;
      else if (out.skipped === "no-data") result.stillUnreadable++;
      else result.stillNo++;
    } catch (e) {
      const n = (e as Error).name;
      if (n === "CapReachedError" || n === "MissingPriceError") throw e;
      // keep the lead where it was, with its earlier reason, and say so
      await skipLead(ctx.db, lead, (reason[0] ?? "screen-failed") as (typeof RECHECK_REASONS)[number], reason[1]);
      ctx.log(`re-check of lead ${id} failed: ${(e as Error).message}`);
      result.failed++;
    }
  });

  result.note = result.passed ? `${result.passed} lead(s) passed and wait for the next run.` : "No lead passed this time.";
  return result;
}
