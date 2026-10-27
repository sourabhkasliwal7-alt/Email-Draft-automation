import { istDayStartIso, shouldStartScheduledRun } from "@outreach/core";
import type { DbClient } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { must } from "../pipeline/common";
import { loadWorkflowConfig } from "../pipeline/run-common";

/** Creates a run (a batch plus its one job). The batch table allows one running/paused run per campaign. */
export async function startRun(db: DbClient, campaignId: string, opts: { startedBy: string | null; dryRun?: boolean; label?: string }) {
  const batch = must(
    await db.from("pipeline_batches").insert({ campaign_id: campaignId, label: opts.label ?? null, status: "running", estimate: { dryRun: opts.dryRun === true }, started_by: opts.startedBy }).select("id").single(),
    "start run",
  );
  must(await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `run:${batch.id}:1`, payload: { batchId: batch.id }, campaign_id: campaignId, batch_id: batch.id }), "queue run");
  return batch.id;
}

/** Continues a paused run (time limit, cap, settings): same batch, so finished steps are not repeated. */
export async function resumeRun(db: DbClient, batchId: string) {
  const batch = must(await db.from("pipeline_batches").select("id, campaign_id, status").eq("id", batchId).single(), "load run");
  if (batch.status !== "paused") return false;
  must(await db.from("pipeline_batches").update({ status: "running", pause_reason: null, pause_detail: {}, paused_at: null }).eq("id", batchId), "resume run");
  const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  must(await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `run:${batchId}:${(count ?? 0) + 1}`, payload: { batchId }, campaign_id: batch.campaign_id, batch_id: batchId }), "queue resumed run");
  return true;
}

/** Called once a minute: starts the daily run on weekdays at the configured IST time, skipping holidays. */
export async function scheduleTick(ctx: WorkerCtx, now = new Date()): Promise<string[]> {
  const cfg = await loadWorkflowConfig(ctx.db);
  const { count } = await ctx.db.from("pipeline_batches").select("id", { count: "exact", head: true }).gte("started_at", istDayStartIso(now));
  if (!shouldStartScheduledRun(now, cfg, (count ?? 0) > 0)) return [];
  const campaigns = must(await ctx.db.from("campaigns").select("id, name").eq("status", "active").is("deleted_at", null).order("created_at"), "load active campaigns");
  const started: string[] = [];
  for (const c of campaigns) {
    try {
      started.push(await startRun(ctx.db, c.id, { startedBy: null, label: "scheduled" }));
    } catch (e) {
      ctx.log(`schedule: could not start ${c.name}: ${(e as Error).message}`);
    }
  }
  return started;
}
