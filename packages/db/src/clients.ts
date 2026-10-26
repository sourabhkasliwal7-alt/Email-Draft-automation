import { createBrowserClient as ssrBrowser, createServerClient as ssrServer } from "@supabase/ssr";
import type { CookieMethodsServer } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { Database } from "./database.types";

export type DbClient = ReturnType<typeof createServiceClient>;

/** supabase-js wants the bare project origin; tolerate URLs pasted with a path such as /rest/v1/. */
export function projectUrl(url: string): string {
  return new URL(url.trim()).origin;
}

/** Browser client: publishable key only, RLS applies. */
export function createBrowserClient(url: string, publishableKey: string) {
  return ssrBrowser<Database>(projectUrl(url), publishableKey);
}

/** Server-component / route-handler client acting as the signed-in user (RLS applies). */
export function createServerClient(url: string, publishableKey: string, cookies: CookieMethodsServer) {
  return ssrServer<Database>(projectUrl(url), publishableKey, { cookies });
}

/**
 * Service client: bypasses RLS. SERVER-SIDE AND WORKER ONLY. Never import this from client components
 * and never pass the secret key to the browser.
 */
export function createServiceClient(url: string, secretKey: string) {
  return createClient<Database>(projectUrl(url), secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 has no native WebSocket, which supabase-js requires at construction time.
    ...(typeof globalThis.WebSocket === "undefined" ? { realtime: { transport: ws as never } } : {}),
  });
}
