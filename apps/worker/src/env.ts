import { EnvError, assertAdapterEnv, cleanEnv } from "@outreach/adapters";
import { z } from "zod";

const schema = z.object({
  APP_MODE: z.enum(["mock", "live"]).default("mock"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  WORKER_ID: z.string().min(1).optional(),
  HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
});

export type WorkerEnv = z.infer<typeof schema> & { workerId: string };

/**
 * Fails fast with ONE error listing every problem. Mock mode (APP_MODE=mock, the default) needs no keys;
 * if Supabase vars are present the worker uses the database, otherwise it only logs.
 */
export function loadWorkerEnv(rawEnv: Record<string, string | undefined>, hostname = "worker"): WorkerEnv {
  const env = cleanEnv(rawEnv);
  const problems: string[] = [];
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push(`${i.path.join(".") || "env"}: ${i.message}`);
  }
  try {
    assertAdapterEnv(env);
  } catch (e) {
    if (e instanceof EnvError) problems.push(...e.problems);
    else throw e;
  }
  if (parsed.success && parsed.data.APP_MODE === "live") {
    if (!parsed.data.NEXT_PUBLIC_SUPABASE_URL) problems.push("NEXT_PUBLIC_SUPABASE_URL is required because APP_MODE=live");
    if (!parsed.data.SUPABASE_SECRET_KEY) problems.push("SUPABASE_SECRET_KEY is required because APP_MODE=live");
  }
  if (problems.length || !parsed.success) throw new EnvError(problems);
  return { ...parsed.data, workerId: parsed.data.WORKER_ID ?? hostname };
}
