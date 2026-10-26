import { EnvError, assertAdapterEnv, cleanEnv } from "@outreach/adapters";
import { z } from "zod";

const schema = z.object({
  APP_MODE: z.enum(["mock", "live"]).default("mock"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  WORKER_STALE_AFTER_SECONDS: z.coerce.number().int().min(1).default(90),
});

export type WebEnv = z.infer<typeof schema>;

/**
 * Server-side env. Fails fast with one error listing everything wrong. Mock mode (default) needs no keys;
 * live mode requires Supabase. SUPABASE_SECRET_KEY must only ever be read on the server.
 */
export function loadWebEnv(rawEnv: Record<string, string | undefined> = process.env): WebEnv {
  const env = cleanEnv(rawEnv);
  const problems: string[] = [];
  const parsed = schema.safeParse(env);
  if (!parsed.success) for (const i of parsed.error.issues) problems.push(`${i.path.join(".") || "env"}: ${i.message}`);
  try {
    assertAdapterEnv(env);
  } catch (e) {
    if (e instanceof EnvError) problems.push(...e.problems);
    else throw e;
  }
  if (parsed.success && parsed.data.APP_MODE === "live") {
    const need = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] as const;
    for (const k of need) if (!parsed.data[k]) problems.push(`${k} is required because APP_MODE=live`);
  }
  if (problems.length || !parsed.success) throw new EnvError(problems);
  return parsed.data;
}
