import { cookies } from "next/headers";
import { createServerClient } from "@outreach/db";
import { getSupabasePublic } from "@/lib/env";

/** Supabase client acting as the signed-in user (RLS applies). Create one per request; never share globally. */
export async function createClient() {
  const cfg = getSupabasePublic();
  if (!cfg) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  const store = await cookies();
  return createServerClient(cfg.url, cfg.key, {
    getAll: () => store.getAll(),
    setAll: (list) => {
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Called from a Server Component: cookies are read-only there. The proxy refreshes the session instead.
      }
    },
  });
}
