import { createServiceDb } from "@/lib/supabase/service";

export type TestProvider = "anthropic" | "serper" | "verifier" | "gmail" | "apollo";

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
  llmProvider?: string;
  reportedCostUsd?: number;
  /** Apollo only: what the key can do */
  apollo?: {
    mode?: "mock" | "live";
    health?: boolean | string;
    search?: { ok: boolean; message?: string };
    reveal?: { ok: boolean; message?: string };
  };
  finishedAt: string;
}

/** What the worker stores on an `apollo.find` job: the free people search that fills a campaign with leads. */
export interface FindResult {
  found?: number;
  imported?: number;
  duplicate?: number;
  suppressed?: number;
  invalid?: number;
  note?: string;
  demo?: boolean;
}

export interface FindRow {
  state: "waiting" | "running" | "done" | "failed";
  queuedAt: string;
  waitingTooLong: boolean;
  result: FindResult | null;
  error: string | null;
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

export const isTestActive = (t: { state: string } | undefined) => t?.state === "waiting" || t?.state === "running";

/** Queues the free Apollo people search for one campaign (the worker imports the people it finds). Call after a permission check. */
export async function queueApolloFind(campaignId: string): Promise<{ ok: boolean; message: string }> {
  const db = createServiceDb();
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data: open } = await db.from("jobs").select("id").eq("type", "apollo.find").eq("campaign_id", campaignId).in("status", ["pending", "running"]).gte("created_at", since);
  if (open?.length) return { ok: false, message: "A search for this campaign is already running. Wait a few seconds." };
  const { error } = await db.from("jobs").insert({ type: "apollo.find", idempotency_key: `apollo.find:${campaignId}:${Date.now()}`, payload: { campaignId }, campaign_id: campaignId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Search started. The result shows here in a few seconds." };
}

/** The newest search per campaign, keyed by campaign id. */
export async function latestApolloFinds(): Promise<Record<string, FindRow>> {
  const db = createServiceDb();
  const { data } = await db.from("jobs").select("status, campaign_id, result, last_error, created_at").eq("type", "apollo.find").order("created_at", { ascending: false }).limit(60);
  const out: Record<string, FindRow> = {};
  for (const j of data ?? []) {
    if (!j.campaign_id || out[j.campaign_id]) continue;
    const state = j.status === "completed" ? "done" : j.status === "failed" ? "failed" : j.status === "running" ? "running" : "waiting";
    out[j.campaign_id] = { state, queuedAt: j.created_at, waitingTooLong: state === "waiting" && Date.now() - new Date(j.created_at).getTime() > 20_000, result: j.status === "completed" ? (j.result as unknown as FindResult | null) : null, error: j.last_error };
  }
  return out;
}

// ---------------------------------------------------------------- Web discovery (Google)
/** One company the Google search found, and what became of it. */
export interface WebFindCompany {
  domain: string;
  name: string;
  query: string;
  outcome: "lead" | "no-contact" | "failed-check" | "no-data";
}

/** What the worker stores on a `web.find` job: search Google for company sites, quick-check them, find a person at each. */
export interface WebFindResult {
  queries?: string[];
  queriesRun?: number;
  results?: number;
  kept?: number;
  checked?: number;
  contacts?: number;
  noContact?: number;
  skipped?: { excluded?: number; known?: number; failedCheck?: number; noData?: number };
  companies?: WebFindCompany[];
  note?: string;
  demo?: boolean;
}

export interface WebFindRow {
  state: "waiting" | "running" | "done" | "failed";
  queuedAt: string;
  waitingTooLong: boolean;
  result: WebFindResult | null;
  error: string | null;
}

/** Queues the Google company search for one campaign. Call after a permission check. */
export async function queueWebFind(campaignId: string): Promise<{ ok: boolean; message: string }> {
  const db = createServiceDb();
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const { data: open } = await db.from("jobs").select("id").eq("type", "web.find").eq("campaign_id", campaignId).in("status", ["pending", "running"]).gte("created_at", since);
  if (open?.length) return { ok: false, message: "A search for this campaign is already running. Wait a few seconds." };
  const { error } = await db.from("jobs").insert({ type: "web.find", idempotency_key: `web.find:${campaignId}:${Date.now()}`, payload: { campaignId }, campaign_id: campaignId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Search started. The result shows here in a minute or so." };
}

/** The newest Google search per campaign, keyed by campaign id. */
export async function latestWebFinds(): Promise<Record<string, WebFindRow>> {
  const db = createServiceDb();
  const { data } = await db.from("jobs").select("status, campaign_id, result, last_error, created_at").eq("type", "web.find").order("created_at", { ascending: false }).limit(60);
  const out: Record<string, WebFindRow> = {};
  for (const j of data ?? []) {
    if (!j.campaign_id || out[j.campaign_id]) continue;
    const state = j.status === "completed" ? "done" : j.status === "failed" ? "failed" : j.status === "running" ? "running" : "waiting";
    out[j.campaign_id] = { state, queuedAt: j.created_at, waitingTooLong: state === "waiting" && Date.now() - new Date(j.created_at).getTime() > 20_000, result: j.status === "completed" ? (j.result as unknown as WebFindResult | null) : null, error: j.last_error };
  }
  return out;
}
