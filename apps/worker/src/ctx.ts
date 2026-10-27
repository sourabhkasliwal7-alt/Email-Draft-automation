import type { Adapters, AdapterMode, AdapterName } from "@outreach/adapters";
import type { DbClient } from "@outreach/db";
import type pg from "pg";

/** Everything a job handler needs. Built once in index.ts (and by tests with mock adapters). */
export interface WorkerCtx {
  db: DbClient;
  /** direct Postgres connection: used only for the atomic spend-cap functions in the private schema */
  pg: pg.Pool | null;
  adapters: Adapters;
  modes: Record<AdapterName, AdapterMode>;
  log: (message: string) => void;
  workerId: string;
}

export interface JobInfo {
  jobId: string;
  attempts: number;
}

/** Thrown by a handler to put the job back in the queue for later without counting as a failure. */
export class RetryLater extends Error {
  constructor(
    message: string,
    public readonly runAfter: Date,
  ) {
    super(message);
    this.name = "RetryLater";
  }
}
