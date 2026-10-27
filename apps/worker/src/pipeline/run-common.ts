import { SKIP_LABELS, parseWorkflowConfig, WORKFLOW_SETTINGS_KEY, type SkipReason, type WorkflowConfig } from "@outreach/core";
import type { DbClient, Json } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { leadEvent, must } from "./common";

export async function loadWorkflowConfig(db: DbClient): Promise<WorkflowConfig> {
  const { data } = await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  return parseWorkflowConfig(data?.value);
}

/** A lead leaves the funnel for one stated reason (SRS 5.4). The reason is the first reason code and is shown in the UI. */
export async function skipLead(db: DbClient, lead: { id: string; contact_id: string }, reason: SkipReason, detail?: string) {
  must(
    await db.from("campaign_leads").update({ status: "disqualified", reason_codes: detail ? [reason, detail] : [reason], next_action: SKIP_LABELS[reason] }).eq("id", lead.id),
    "skip lead",
  );
  await leadEvent(db, lead, "skipped", { reason, detail: detail ?? null });
  return { skipped: reason };
}

export type Skipped = { skipped: SkipReason };
export const isSkipped = (x: unknown): x is Skipped => typeof x === "object" && x !== null && "skipped" in x;

/** Runs `fn` over `items` with at most `limit` in flight. Stops taking new items when `shouldStop()` is true. */
export async function mapLimit<T, R>(items: T[], limit: number, shouldStop: () => boolean, fn: (item: T, index: number) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class RunStopped extends Error {
  constructor(public readonly why: "time_limit" | "cancelled" | "paused") {
    super(`run stopped: ${why}`);
    this.name = "RunStopped";
  }
}

// ---------------------------------------------------------------- run lock (one run at a time; a lock older than 3 hours is stale)
// The lock is the batch itself: status running + a fresh totals.heartbeat_at. It is not stored in settings, so heartbeats do not spam the audit log.
const STALE_LOCK_MS = 3 * 3_600_000;

export async function acquireRunLock(ctx: WorkerCtx, batchId: string): Promise<boolean> {
  const { data: others } = await ctx.db.from("pipeline_batches").select("id, totals, started_at").eq("status", "running").neq("id", batchId);
  const live = (others ?? []).some((o) => {
    const beat = (o.totals as { heartbeat_at?: string } | null)?.heartbeat_at ?? o.started_at;
    return Date.now() - new Date(beat).getTime() < STALE_LOCK_MS;
  });
  if (live) return false;
  await patchTotals(ctx.db, batchId, { heartbeat_at: new Date().toISOString() });
  return true;
}

export async function heartbeatRunLock(ctx: WorkerCtx, batchId: string, jobId: string) {
  await patchTotals(ctx.db, batchId, { heartbeat_at: new Date().toISOString() });
  await ctx.db.from("jobs").update({ locked_at: new Date().toISOString() }).eq("id", jobId).eq("status", "running");
}

// ---------------------------------------------------------------- run log (counts per step, shown in the UI)
export interface LogEntry {
  at: string;
  step: string;
  count: number | null;
  note?: string;
}

/** Merges into pipeline_batches.totals and appends one log line. The run job is the only writer while it runs. */
export async function patchTotals(db: DbClient, batchId: string, patch: Record<string, unknown>, log?: Omit<LogEntry, "at">) {
  const { data: row } = await db.from("pipeline_batches").select("totals").eq("id", batchId).single();
  const totals = (row?.totals ?? {}) as Record<string, unknown>;
  const lines = ((totals.log as LogEntry[] | undefined) ?? []).slice(-60);
  if (log) lines.push({ at: new Date().toISOString(), ...log });
  must(await db.from("pipeline_batches").update({ totals: { ...totals, ...patch, log: lines } as unknown as Json }).eq("id", batchId), "save run progress");
}
