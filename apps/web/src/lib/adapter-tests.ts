import { createServiceDb } from "@/lib/supabase/service";

export type TestProvider = "anthropic" | "serper" | "verifier" | "gmail";

/** What the worker stores on the job (apps/worker/src/jobs/adapter-test.ts). */
export interface TestResult {
  ok: boolean;
  provider: TestProvider;
  message: string;
  model?: string;
  units?: Record<string, number>;
  costUsd?: number;
  draftId?: string;
  mailbox?: string;
  labelNote?: string;
  finishedAt: string;
}

export interface TestRow {
  state: "waiting" | "running" | "done" | "failed";
  queuedAt: string;
  /** still waiting after 20 seconds: the worker is probably not running */
  waitingTooLong: boolean;
  result: TestResult | null;
  error: string | null;
}

const RECENT_MS = 3 * 60_000;

/** Server only (service role): call after a permission check. Queues one "Test connection" for the worker. */
export async function queueAdapterTest(provider: TestProvider, inboxId?: string): Promise<{ ok: boolean; message: string }> {
  const db = createServiceDb();
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data: open } = await db.from("jobs").select("id, payload").eq("type", "adapter.test").in("status", ["pending", "running"]).gte("created_at", since);
  if ((open ?? []).some((j) => (j.payload as { provider?: string; inboxId?: string }).provider === provider && (j.payload as { inboxId?: string }).inboxId === inboxId)) {
    return { ok: false, message: "A test is already running. Wait a few seconds." };
  }
  const { error } = await db.from("jobs").insert({ type: "adapter.test", idempotency_key: `adapter.test:${provider}:${inboxId ?? "-"}:${Date.now()}`, payload: { provider, ...(inboxId ? { inboxId } : {}) } });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Test queued. The worker answers within a few seconds." };
}

/** The newest test per provider (and per mailbox for Gmail). Key: "anthropic" | "serper" | "verifier" | "gmail:<inboxId>". */
export async function latestAdapterTests(): Promise<Record<string, TestRow>> {
  const db = createServiceDb();
  const { data } = await db.from("jobs").select("status, payload, result, last_error, created_at").eq("type", "adapter.test").order("created_at", { ascending: false }).limit(60);
  const out: Record<string, TestRow> = {};
  for (const j of data ?? []) {
    const p = j.payload as { provider?: string; inboxId?: string };
    if (!p.provider) continue;
    const key = p.provider === "gmail" ? `gmail:${p.inboxId ?? ""}` : p.provider;
    if (out[key]) continue;
    const result = j.status === "completed" ? (j.result as unknown as TestResult | null) : null;
    const state = j.status === "completed" ? "done" : j.status === "failed" ? "failed" : j.status === "running" ? "running" : "waiting";
    out[key] = { state, queuedAt: j.created_at, waitingTooLong: state === "waiting" && Date.now() - new Date(j.created_at).getTime() > 20_000, result, error: j.last_error };
  }
  return out;
}

export const isTestActive = (t: TestRow | undefined) => t?.state === "waiting" || t?.state === "running";
