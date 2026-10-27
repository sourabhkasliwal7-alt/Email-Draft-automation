import { TESTING_TOKEN_DAYS, cleanEnv, envValue, googleRedirectUri } from "@outreach/adapters";

export type GoogleConfig =
  | { ok: true; clientId: string; clientSecret: string; encryptionKey: string; siteUrl: string; redirectUri: string; publishing: "testing" | "production" }
  | { ok: false; missing: string[]; siteUrl: string | null; redirectUri: string | null };

/**
 * Everything the Google connection needs, from the environment (server only: the client secret and the encryption key
 * never reach the browser). The redirect URI is NEXT_PUBLIC_SITE_URL + /api/google/callback and must be registered in
 * Google Cloud exactly like that.
 */
export function googleConfig(rawEnv: Record<string, string | undefined> = process.env): GoogleConfig {
  const env = cleanEnv(rawEnv);
  let siteUrl: string | null = null;
  try {
    siteUrl = env.NEXT_PUBLIC_SITE_URL ? new URL(env.NEXT_PUBLIC_SITE_URL).origin : null;
  } catch {
    siteUrl = null;
  }
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].filter((v) => !envValue(env, v));
  if (!siteUrl) missing.push(env.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL (not a valid URL)" : "NEXT_PUBLIC_SITE_URL");
  if (missing.length) return { ok: false, missing, siteUrl, redirectUri: siteUrl ? googleRedirectUri(siteUrl) : null };
  return {
    ok: true,
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY!,
    siteUrl: siteUrl!,
    redirectUri: googleRedirectUri(siteUrl!),
    // unknown counts as testing: the safe assumption is that sign-ins expire
    publishing: env.GOOGLE_APP_PUBLISHING?.toLowerCase() === "production" ? "production" : "testing",
  };
}

export { GMAIL_MESSAGES } from "./notices";

/** When a Testing-mode sign-in stops working: connected_at + 7 days. */
export function testingExpiry(connectedAt: string | null): Date | null {
  return connectedAt ? new Date(new Date(connectedAt).getTime() + TESTING_TOKEN_DAYS * 86_400_000) : null;
}
