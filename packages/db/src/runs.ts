import type { DbClient } from "./clients";

function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<T>;
}

/** Creates a run: a batch plus its one job. The database allows one running/paused run per campaign. Server side only (service role). */
export async function startRun(db: DbClient, campaignId: string, opts: { startedBy: string | null; dryRun?: boolean; label?: string }) {
  const batch = must(
    await db.from("pipeline_batches").insert({ campaign_id: campaignId, label: opts.label ?? null, status: "running", estimate: { dryRun: opts.dryRun === true }, started_by: opts.startedBy }).select("id").single(),
    "start run",
  );
  must(await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `run:${batch.id}:1`, payload: { batchId: batch.id }, campaign_id: campaignId, batch_id: batch.id }), "queue run");
  return batch.id;
}

/** Continues a paused run (time limit, cap, settings): same batch, so finished steps are not repeated. */
export async function resumeRun(db: DbClient, batchId: string): Promise<boolean> {
  const batch = must(await db.from("pipeline_batches").select("id, campaign_id, status").eq("id", batchId).single(), "load run");
  if (batch.status !== "paused") return false;
  must(await db.from("pipeline_batches").update({ status: "running", pause_reason: null, pause_detail: {}, paused_at: null }).eq("id", batchId), "resume run");
  const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  must(await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `run:${batchId}:${(count ?? 0) + 1}`, payload: { batchId }, campaign_id: batch.campaign_id, batch_id: batchId }), "queue resumed run");
  return true;
}

/** Stops a run for good. The worker notices within a few seconds and finishes the lead it is on. */
export async function cancelRun(db: DbClient, batchId: string): Promise<boolean> {
  const { data } = await db.from("pipeline_batches").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", batchId).in("status", ["running", "paused"]).select("id");
  return (data?.length ?? 0) > 0;
}
