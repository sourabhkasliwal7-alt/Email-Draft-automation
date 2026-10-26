import { connection } from "next/server";
import { EnvError } from "@outreach/adapters";
import { createServiceClient, getWorkerHeartbeat } from "@outreach/db";
import { loadWebEnv } from "@/lib/env";
import { buildHealth, type HealthInputs } from "@/lib/health";

export async function GET() {
  await connection(); // always evaluated per request, never prerendered
  let env;
  try {
    env = loadWebEnv();
  } catch (e) {
    if (e instanceof EnvError) return Response.json({ status: "degraded", error: e.problems }, { status: 503 });
    throw e;
  }

  let database: HealthInputs["database"] = { configured: false };
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    try {
      const db = createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
      database = { configured: true, heartbeat: await getWorkerHeartbeat(db) };
    } catch (e) {
      database = { configured: true, error: (e as Error).message };
    }
  }

  const report = buildHealth({ mode: env.APP_MODE, now: new Date(), staleAfterSeconds: env.WORKER_STALE_AFTER_SECONDS, database });
  return Response.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
