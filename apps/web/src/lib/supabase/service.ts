import { createServiceClient } from "@outreach/db";
import { loadWebEnv } from "@/lib/env";

/**
 * Service-role client for the few things users cannot do themselves (private Storage, queueing). SERVER ONLY:
 * import it from server actions and route handlers after a permission check, never from a client component.
 */
export function createServiceDb() {
  const env = loadWebEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createServiceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
}
