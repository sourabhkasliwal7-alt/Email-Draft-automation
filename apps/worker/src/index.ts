import { hostname } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { createAdapters, resolveLlmProvider } from "@outreach/adapters";
import { createServiceClient, recordHeartbeat } from "@outreach/db";
import { loadWorkerEnv } from "./env";
import { createGmailTokenStore } from "./gmail-store";
import { startJobLoop } from "./jobs/runner";
import { scheduleTick } from "./jobs/scheduler";
import { startWorker } from "./worker";

config({ path: join(process.cwd(), "../../.env") });
config();

async function main() {
  const env = loadWorkerEnv(process.env, hostname());
  const db =
    env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY
      ? createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)
      : null;
  console.log(`worker ${env.workerId} starting (mode=${env.APP_MODE}, db=${db ? "connected" : "none"}, llm provider=${resolveLlmProvider(process.env)})`);

  const worker = startWorker({
    workerId: env.workerId,
    intervalMs: env.HEARTBEAT_INTERVAL_SECONDS * 1000,
    heartbeat: async (id) => {
      if (db) await recordHeartbeat(db, id, { mode: env.APP_MODE });
      else console.log(`heartbeat (no database configured) ${new Date().toISOString()}`);
    },
  });
  const adapters = createAdapters(process.env, db ? { gmailTokens: createGmailTokenStore(db) } : {});
  const pool = process.env.DATABASE_URL?.startsWith("postgres") ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 }) : null;
  const ctx = db ? { db, pg: pool, adapters, modes: adapters.modes, llmProvider: adapters.llmProvider, log: console.log, workerId: env.workerId } : null;
  const jobs = ctx && !process.argv.includes("--once") ? startJobLoop(ctx) : null;
  // daily schedule: checked once a minute (weekdays at the configured IST time, holidays skipped)
  const scheduler = ctx && jobs ? setInterval(() => void scheduleTick(ctx).catch((e) => console.log(`schedule check failed: ${(e as Error).message}`)), 60_000) : null;

  const shutdown = () => {
    console.log("worker shutting down");
    worker.stop();
    jobs?.stop();
    if (scheduler) clearInterval(scheduler);
    void pool?.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (process.argv.includes("--once")) {
    await worker.first;
    worker.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
