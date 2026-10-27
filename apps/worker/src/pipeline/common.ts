import { HALT_LABELS, type HaltReason } from "@outreach/core";
import type { DbClient, Json } from "@outreach/db";

export function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as NonNullable<T>;
}

export const LEAD_SELECT = "*, contacts(*, companies(*)), campaigns(*)";

export async function loadLead(db: DbClient, leadId: string) {
  return must(await db.from("campaign_leads").select(LEAD_SELECT).eq("id", leadId).single(), "load lead");
}
export type LeadBundle = Awaited<ReturnType<typeof loadLead>>;

/** Append-only history for the lead timeline. */
export async function leadEvent(db: DbClient, lead: { id: string; contact_id: string }, type: string, payload: Record<string, unknown> = {}, actor = "workflow") {
  must(await db.from("lead_events").insert({ campaign_lead_id: lead.id, contact_id: lead.contact_id, type, payload: payload as Json, actor }), "write lead event");
}

/** A lead leaves the pipeline for a stated reason; the reason is stored and shown in the UI. */
export async function haltLead(db: DbClient, lead: { id: string; contact_id: string }, reason: HaltReason, codes: string[] = []) {
  must(
    await db.from("campaign_leads").update({ status: "disqualified", reason_codes: [...new Set([reason, ...codes])], next_action: HALT_LABELS[reason] }).eq("id", lead.id),
    "halt lead",
  );
  await leadEvent(db, lead, "halted", { reason, codes });
  return { halt: reason, codes };
}

export type StepOutput = { halt?: HaltReason; [key: string]: unknown };

/**
 * Runs one named step of a job exactly once: a completed step returns its stored output, so a retried or resumed job
 * skips straight past finished work (idempotent, resumable from the last completed step).
 */
export async function runStep(db: DbClient, jobId: string, name: string, fn: () => Promise<StepOutput>): Promise<StepOutput> {
  const { data: prev } = await db.from("job_steps").select("status, attempts, output").eq("job_id", jobId).eq("step", name).maybeSingle();
  if (prev?.status === "completed") return prev.output as StepOutput;
  must(
    await db.from("job_steps").upsert({ job_id: jobId, step: name, status: "running", attempts: (prev?.attempts ?? 0) + 1, started_at: new Date().toISOString(), error: null }, { onConflict: "job_id,step" }),
    "start step",
  );
  try {
    const output = await fn();
    must(await db.from("job_steps").update({ status: "completed", finished_at: new Date().toISOString(), output: output as Json }).eq("job_id", jobId).eq("step", name), "finish step");
    return output;
  } catch (e) {
    await db.from("job_steps").update({ status: "failed", finished_at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) }).eq("job_id", jobId).eq("step", name);
    throw e;
  }
}

export async function isSendingEnabled(db: DbClient): Promise<boolean> {
  const { data } = await db.from("settings").select("value").eq("key", "flags").maybeSingle();
  return (data?.value as { SENDING_ENABLED?: boolean } | null)?.SENDING_ENABLED === true;
}

const chunk = <T>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Recomputes the batch counters from its jobs and leads; completes the batch when nothing is left to do. */
export async function refreshBatch(db: DbClient, batchId: string) {
  const jobs = must(await db.from("jobs").select("status, campaign_lead_id, type").eq("batch_id", batchId), "load batch jobs");
  const leadJobs = jobs.filter((j) => j.type === "lead.pipeline");
  const jobCounts: Record<string, number> = {};
  for (const j of leadJobs) jobCounts[j.status] = (jobCounts[j.status] ?? 0) + 1;
  const leadIds = leadJobs.map((j) => j.campaign_lead_id).filter((x): x is string => Boolean(x));
  const leadCounts: Record<string, number> = {};
  for (const ids of chunk(leadIds)) {
    for (const l of must(await db.from("campaign_leads").select("status").in("id", ids), "load batch leads")) leadCounts[l.status] = (leadCounts[l.status] ?? 0) + 1;
  }
  const { data: batch } = await db.from("pipeline_batches").select("status, fanout_done, totals").eq("id", batchId).single();
  if (!batch) return;
  const open = (jobCounts.pending ?? 0) + (jobCounts.running ?? 0);
  const done = batch.fanout_done && open === 0 && jobs.every((j) => j.status !== "pending" && j.status !== "running");
  const patch: { totals: Json; status?: "completed"; finished_at?: string } = { totals: { ...(batch.totals as object), jobs: jobCounts, leads: leadCounts } };
  if (done && batch.status === "running") {
    patch.status = "completed";
    patch.finished_at = new Date().toISOString();
  }
  must(await db.from("pipeline_batches").update(patch).eq("id", batchId), "refresh batch");
}
