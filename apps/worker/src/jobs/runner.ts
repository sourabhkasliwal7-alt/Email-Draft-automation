import type { DbClient, Json } from "@outreach/db";
import { runImportJob, type ImportJobPayload } from "./import";

/**
 * Minimal database-backed job runner over the `jobs` table: claim with an atomic status flip, bounded retries with
 * backoff, and recovery of jobs whose worker died mid-run. Phase 4 replaces the polling with pg-boss + Mastra
 * workflows but keeps the same table, idempotency keys and handler signatures.
 */
export const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 10 * 60 * 1000;

type JobRow = { id: string; type: string; payload: Json; attempts: number };
type Handler = (db: DbClient, payload: never, log: (m: string) => void) => Promise<unknown>;

export const HANDLERS: Record<string, Handler> = {
  "import.run": (db, payload: ImportJobPayload, log) => runImportJob(db, payload, log),
};

/** Puts jobs back in the queue when the worker that held them stopped without finishing. */
export async function recoverStaleJobs(db: DbClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const { data } = await db.from("jobs").update({ status: "pending", locked_by: null, locked_at: null }).eq("status", "running").lt("locked_at", cutoff).select("id");
  return data?.length ?? 0;
}

/** Atomically claims the oldest due job, or returns null. Two workers can never claim the same job. */
export async function claimJob(db: DbClient, workerId: string, now = new Date(), onlyKeyPrefix?: string): Promise<JobRow | null> {
  let query = db
    .from("jobs")
    .select("id, type, payload, attempts")
    .eq("status", "pending")
    .lte("run_after", now.toISOString())
    .in("type", Object.keys(HANDLERS))
    .order("created_at")
    .limit(5);
  if (onlyKeyPrefix) query = query.like("idempotency_key", `${onlyKeyPrefix}%`);
  const { data: candidates } = await query;
  for (const c of candidates ?? []) {
    const { data } = await db
      .from("jobs")
      .update({ status: "running", locked_by: workerId, locked_at: now.toISOString(), attempts: c.attempts + 1 })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id, type, payload, attempts")
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

export async function runOneJob(db: DbClient, workerId: string, log: (m: string) => void = console.log, onlyKeyPrefix?: string): Promise<boolean> {
  const job = await claimJob(db, workerId, new Date(), onlyKeyPrefix);
  if (!job) return false;
  const handler = HANDLERS[job.type]!;
  try {
    await handler(db, job.payload as never, log);
    await db.from("jobs").update({ status: "completed", last_error: null, locked_by: null, locked_at: null }).eq("id", job.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`job ${job.id} (${job.type}) failed on attempt ${job.attempts}: ${message}`);
    const giveUp = job.attempts >= MAX_ATTEMPTS;
    await db
      .from("jobs")
      .update({
        status: giveUp ? "failed" : "pending",
        last_error: message,
        locked_by: null,
        locked_at: null,
        run_after: new Date(Date.now() + 30_000 * job.attempts).toISOString(),
      })
      .eq("id", job.id);
    if (job.type === "import.run" && giveUp) {
      const batchId = (job.payload as unknown as ImportJobPayload).batchId;
      await db.from("import_batches").update({ status: "failed", error: message }).eq("id", batchId);
    }
  }
  return true;
}

/** Drains the queue, then waits. Returns a stop function. */
export function startJobLoop(db: DbClient, workerId: string, log: (m: string) => void = console.log, idleMs = 2000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    try {
      await recoverStaleJobs(db);
      while (!stopped && (await runOneJob(db, workerId, log))) {
        /* keep draining */
      }
    } catch (e) {
      log(`job loop error: ${(e as Error).message}`);
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
