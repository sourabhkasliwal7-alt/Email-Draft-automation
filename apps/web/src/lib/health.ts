export type CheckState = "ok" | "skipped" | "error" | "stale";

export interface HealthReport {
  status: "ok" | "degraded";
  mode: "mock" | "live";
  time: string;
  checks: {
    database: { state: CheckState; detail?: string };
    worker: { state: CheckState; lastSeenAt?: string; ageSeconds?: number; detail?: string };
  };
}

export interface HealthInputs {
  mode: "mock" | "live";
  now: Date;
  staleAfterSeconds: number;
  /** undefined = database not configured; a string = the error that occurred; otherwise the last heartbeat (or null if none yet) */
  database: { configured: false } | { configured: true; error?: string; heartbeat?: { lastSeenAt: Date } | null };
}

/** Pure function so the health logic is unit-testable without a database. */
export function buildHealth({ mode, now, staleAfterSeconds, database }: HealthInputs): HealthReport {
  const base = { mode, time: now.toISOString() };

  if (!database.configured) {
    // Mock mode with no database is a valid zero-key setup; live mode without one is a failure.
    const state: CheckState = mode === "live" ? "error" : "skipped";
    return {
      ...base,
      status: mode === "live" ? "degraded" : "ok",
      checks: {
        database: { state, detail: "Supabase is not configured" },
        worker: { state: state === "error" ? "error" : "skipped" },
      },
    };
  }

  if (database.error) {
    return {
      ...base,
      status: "degraded",
      checks: { database: { state: "error", detail: database.error }, worker: { state: "error", detail: "database unavailable" } },
    };
  }

  const hb = database.heartbeat;
  if (!hb) {
    return {
      ...base,
      status: mode === "live" ? "degraded" : "ok",
      checks: { database: { state: "ok" }, worker: { state: mode === "live" ? "stale" : "skipped", detail: "no heartbeat recorded yet" } },
    };
  }
  const ageSeconds = Math.max(0, Math.round((now.getTime() - hb.lastSeenAt.getTime()) / 1000));
  const fresh = ageSeconds <= staleAfterSeconds;
  return {
    ...base,
    status: fresh ? "ok" : "degraded",
    checks: {
      database: { state: "ok" },
      worker: { state: fresh ? "ok" : "stale", lastSeenAt: hb.lastSeenAt.toISOString(), ageSeconds },
    },
  };
}
