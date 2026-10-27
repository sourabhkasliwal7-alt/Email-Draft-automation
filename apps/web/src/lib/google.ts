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

/** The messages shown after the Google round trip. Only these fixed codes travel in the URL, never free text. */
export const GMAIL_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Gmail connected. Use \"Create test draft\" to check it." },
  not_configured: { tone: "error", text: "Google is not configured yet: see the list below." },
  state: { tone: "error", text: "The sign-in could not be verified (it expired or did not start here). Press Connect Gmail again." },
  session: { tone: "error", text: "Your session changed during the Google sign-in. Sign in again and retry." },
  denied: { tone: "error", text: "Google access was not granted, so nothing was connected." },
  google_error: { tone: "error", text: "Google returned an error. Try again; if it repeats, check the OAuth client in Google Cloud." },
  no_code: { tone: "error", text: "Google did not return a sign-in code. Try again." },
  token: { tone: "error", text: "Google would not exchange the sign-in code (check GOOGLE_CLIENT_SECRET and that the redirect URI is registered exactly). Nothing was connected." },
  no_refresh_token: { tone: "error", text: "Google did not give a long-lived sign-in. Remove the app under your Google Account > Security > Third-party access, then connect again." },
  scopes: { tone: "error", text: "Both permissions (create drafts, manage labels) must be allowed. Connect again and tick both boxes. Nothing was stored." },
  wrong_account: { tone: "error", text: "You signed in to a different Gmail account than this mailbox. Nothing was stored: choose the matching account in the Google window." },
  profile: { tone: "error", text: "Connected to Google but could not read which account signed in. Nothing was stored." },
  no_inbox: { tone: "error", text: "That mailbox does not exist." },
  forbidden: { tone: "error", text: "Only an admin can connect a mailbox." },
  disconnected: { tone: "ok", text: "Mailbox disconnected. Google was told to forget the sign-in." },
};

/** When a Testing-mode sign-in stops working: connected_at + 7 days. */
export function testingExpiry(connectedAt: string | null): Date | null {
  return connectedAt ? new Date(new Date(connectedAt).getTime() + TESTING_TOKEN_DAYS * 86_400_000) : null;
}
