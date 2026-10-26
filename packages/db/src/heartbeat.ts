import type { DbClient } from "./clients";

export async function recordHeartbeat(db: DbClient, workerId: string, meta: Record<string, string | number | boolean> = {}) {
  const { error } = await db
    .from("worker_heartbeats")
    .upsert({ worker_id: workerId, last_seen_at: new Date().toISOString(), meta }, { onConflict: "worker_id" });
  if (error) throw new Error(`heartbeat failed: ${error.message}`);
}

/** Most recent heartbeat across workers, or null. */
export async function getWorkerHeartbeat(db: DbClient): Promise<{ workerId: string; lastSeenAt: Date } | null> {
  const { data, error } = await db
    .from("worker_heartbeats")
    .select("worker_id,last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`heartbeat read failed: ${error.message}`);
  return data ? { workerId: data.worker_id, lastSeenAt: new Date(data.last_seen_at) } : null;
}
