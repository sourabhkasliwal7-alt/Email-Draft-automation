import type { Json } from "@outreach/db";
import { RetryLater, type JobInfo, type WorkerCtx } from "../ctx";
import { refreshBatch } from "../pipeline/common";
import { CapReachedError } from "../spend";
import { runImportJob } from "./import";
import { adapterTestJob } from "./adapter-test";
import { apolloFindJob } from "./apollo-find";
import { sendJob } from "./send";
import { workflowRunJob } from "./run";

/**
 * Minimal database-backed job runner over the `jobs` table: claim with an atomic status flip, bounded retries with
 * backoff, and recovery of jobs whose worker died mid-run. Handlers are idempotent (job_steps / unique keys).
 */
export const MAX_ATTEMPTS = 3;
/** campaign names starting with this are reserved for automated tests */
export const RESERVED_TEST_PREFIX = "itest";
const STALE_AFTER_MS = 10 * 60 * 1000;

type JobRow = { id: string; type: string; payload: Json; attempts: number; batch_id: string | null };
type Handler = (ctx: WorkerCtx, payload: never, job: JobInfo) => Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  "import.run": (ctx, payload: Parameters<typeof runImportJob>[1]) => runImportJob(ctx.db, payload, ctx.log),
  "workflow.run": workflowRunJob as Handler,
  "send.run": sendJob as Handler,
  "adapter.test": adapterTestJob as Handler,
  "apollo.find": apolloFindJob as Handler,
};

/** Puts jobs back in the queue when the worker that held them stopped without finishing. */
export async function recoverStaleJobs(ctx: WorkerCtx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { data } = await ctx.db.from("jobs").update({ status: "pending", locked_by: null, locked_at: null }).eq("status", "running").lt("locked_at", cutoff).select("id");
  return data?.length ?? 0;
}

/** Atomically claims the oldest due job, or returns null. Two workers can never claim the same job. */
export interface JobFilter {
  /** only jobs whose idempotency key starts with this (used by tests so they never touch other jobs) */
  keyPrefix?: string;
  /** only jobs of these campaigns */
  campaignIds?: string[];
}

export async function claimJob(ctx: WorkerCtx, now = new Date(), only: JobFilter = {}): Promise<JobRow | null> {
  let query = ctx.db
    .from("jobs")
    .select("id, type, payload, attempts, batch_id, campaigns(name)")
    .eq("status", "pending")
    .lte("run_after", now.toISOString())
    .in("type", Object.keys(HANDLERS))
    .order("created_at")
    .limit(25);
  if (only.keyPrefix) query = query.like("idempotency_key", `${only.keyPrefix}%`);
  if (only.campaignIds) query = query.in("campaign_id", only.campaignIds);
  const { data: found } = await query;
  // Campaigns named "itest..." belong to automated tests: a normal worker never touches their jobs. A test worker opts in by
  // naming the jobs it wants (keyPrefix / campaignIds).
  const optedIn = Boolean(only.keyPrefix || only.campaignIds);
  const candidates = (found ?? []).filter((c) => optedIn || !(c.campaigns?.name ?? "").startsWith(RESERVED_TEST_PREFIX));
  for (const c of candidates) {
    const { data } = await ctx.db
      .from("jobs")
      .update({ status: "running", locked_by: ctx.workerId, locked_at: now.toISOString(), attempts: c.attempts + 1 })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id, type, payload, attempts, batch_id")
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

export async function runOneJob(ctx: WorkerCtx, only: JobFilter = {}): Promise<boolean> {
  const job = await claimJob(ctx, new Date(), only);
  if (!job) return false;
  const { db, log } = ctx;
  const handler = HANDLERS[job.type]!;
  try {
    const result = await handler(ctx, job.payload as never, { jobId: job.id, attempts: job.attempts });
    await db.from("jobs").update({ status: "completed", last_error: null, locked_by: null, locked_at: null, result: (result ?? {}) as Json }).eq("id", job.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof RetryLater) {
      // not a failure: wait for the stated time and do not use up an attempt
      await db.from("jobs").update({ status: "pending", locked_by: null, locked_at: null, attempts: Math.max(0, job.attempts - 1), run_after: e.runAfter.toISOString(), last_error: message }).eq("id", job.id);
      return true;
    }
    log(`job ${job.id} (${job.type}) failed on attempt ${job.attempts}: ${message}`);
    const cap = e instanceof CapReachedError;
    const giveUp = cap || job.attempts >= MAX_ATTEMPTS;
    await db
      .from("jobs")
      .update({ status: giveUp ? "failed" : "pending", last_error: message, locked_by: null, locked_at: null, run_after: new Date(Date.now() + 30_000 * job.attempts).toISOString() })
      .eq("id", job.id);
    if (cap && job.batch_id) {
      // a spend cap stops the whole batch with the reason shown in the UI
      await db.from("pipeline_batches").update({ status: "paused", pause_reason: "cap", paused_at: new Date().toISOString(), pause_detail: (e as CapReachedError).detail as Json }).eq("id", job.batch_id).eq("status", "running");
    }
    if (job.type === "workflow.run" && giveUp && !cap && job.batch_id) {
      // the run itself crashed: pause it with the reason so it shows in the UI and can be continued
      await db.from("pipeline_batches").update({ status: "paused", pause_reason: "manual", paused_at: new Date().toISOString(), pause_detail: { error: message } as Json }).eq("id", job.batch_id).eq("status", "running");
    }
    if (job.type === "import.run" && giveUp) {
      await db.from("import_batches").update({ status: "failed", error: message }).eq("id", (job.payload as unknown as { batchId: string }).batchId);
    }
  }
  if (job.batch_id) await refreshBatch(db, job.batch_id).catch((err) => log(`refresh batch failed: ${(err as Error).message}`));
  return true;
}

/** Drains the queue, then waits. Returns a stop function. */
export function startJobLoop(ctx: WorkerCtx, idleMs = 2000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    try {
      await recoverStaleJobs(ctx);
      while (!stopped && (await runOneJob(ctx))) {
        /* keep draining */
      }
    } catch (e) {
      ctx.log(`job loop error: ${(e as Error).message}`);
    }
    if (!stopped) timer = setTimeout(loop, idleMs);
  };
  void loop();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
