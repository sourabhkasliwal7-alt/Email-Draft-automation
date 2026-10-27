/**
 * Messages that arrive through the address bar after a redirect (?gmail=... after the Google sign-in, ?notice=... after a Retry).
 * Only fixed codes travel in the address, never free text. They are shown on the page and as a toast.
 */

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
  scopes: { tone: "error", text: "Both permissions (create drafts, label them) must be allowed. Connect again and tick both boxes. Nothing was stored." },
  wrong_account: { tone: "error", text: "You signed in to a different Gmail account than this mailbox. Nothing was stored: choose the matching account in the Google window." },
  profile: { tone: "error", text: "Connected to Google but could not read which account signed in. Nothing was stored." },
  no_inbox: { tone: "error", text: "That mailbox does not exist." },
  forbidden: { tone: "error", text: "Only an admin can connect a mailbox." },
  disconnected: { tone: "ok", text: "Mailbox disconnected. Google was told to forget the sign-in." },
};

/** Setup notices (?notice=...). */
export const SETUP_NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  demo_archived: { tone: "ok", text: "The demo data is archived. Your own records were not touched." },
  demo_failed: { tone: "error", text: "Some demo records could not be archived. Reload the page and try again." },
  demo_forbidden: { tone: "error", text: "Only an admin can archive the demo data." },
};

export const DRAFT_NOTICES: Record<string, string> = {
  retry_running: "Done. The lead is back at the step that failed and will continue in the current run. Nothing that already ran is repeated.",
  retry_paused: "The lead is back at the step that failed, but this campaign has a paused run. Resume or cancel that run on Home first, then it continues.",
  retry_started: "Done. The lead is back at the step that failed and a run has started: watch it on Home. Nothing that already ran is repeated.",
};
