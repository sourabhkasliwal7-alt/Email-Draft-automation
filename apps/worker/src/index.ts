import { hostname } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { createServiceClient, recordHeartbeat } from "@outreach/db";
import { loadWorkerEnv } from "./env";
import { startJobLoop } from "./jobs/runner";
import { startWorker } from "./worker";

config({ path: join(process.cwd(), "../../.env") });
config();

async function main() {
  const env = loadWorkerEnv(process.env, hostname());
  const db =
    env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY
      ? createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY)
      : null;
  console.log(`worker ${env.workerId} starting (mode=${env.APP_MODE}, db=${db ? "connected" : "none"})`);

  const worker = startWorker({
    workerId: env.workerId,
    intervalMs: env.HEARTBEAT_INTERVAL_SECONDS * 1000,
    heartbeat: async (id) => {
      if (db) await recordHeartbeat(db, id, { mode: env.APP_MODE });
      else console.log(`heartbeat (no database configured) ${new Date().toISOString()}`);
    },
  });
  const jobs = db && !process.argv.includes("--once") ? startJobLoop(db, env.workerId) : null;

  const shutdown = () => {
    console.log("worker shutting down");
    worker.stop();
    jobs?.stop();
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
