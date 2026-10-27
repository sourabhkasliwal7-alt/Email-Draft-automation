import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requestJson, type FetchLike } from "./http";
import { parseEncryptionKey } from "./token-crypto";

/**
 * The only Google permissions this app asks for:
 * - gmail.compose: create drafts, and read the connected address with users.getProfile
 * - gmail.modify: create the AI-Outreach label and put it on each draft (labels cannot be put on a message with less)
 * gmail.modify does not allow sending mail by itself, and nothing in this app sends.
 * A mailbox connected before gmail.modify was requested has only gmail.compose and shows "Reconnect needed".
 */
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GMAIL_LABELS_SCOPE = "https://www.googleapis.com/auth/gmail.labels";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_SCOPES = [GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE] as const;

/** Connected, but without the permission that lets the label be put on drafts: the person must reconnect once. */
export const needsReconnectForLabel = (scopes: string[]): boolean => !scopes.includes(GMAIL_MODIFY_SCOPE);

export const GOOGLE_CALLBACK_PATH = "/api/google/callback";
export const GOOGLE_CONNECT_PATH = "/api/google/connect";
/** A refresh token issued while the Google app is in "Testing" stops working after 7 days. */
export const TESTING_TOKEN_DAYS = 7;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

/** The exact value to register under "Authorized redirect URIs": NEXT_PUBLIC_SITE_URL + /api/google/callback. */
export function googleRedirectUri(siteUrl: string): string {
  const u = new URL(siteUrl);
  return `${u.origin}${GOOGLE_CALLBACK_PATH}`;
}

export function buildConsentUrl(p: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", // ask for a refresh token
    prompt: "consent select_account", // always return a refresh token; let a person with two accounts pick the right one
    include_granted_scopes: "false",
    state: p.state,
  });
  if (p.loginHint) q.set("login_hint", p.loginHint);
  return `${AUTH_URL}?${q.toString()}`;
}

// ---------------------------------------------------------------- OAuth state (CSRF): a random nonce in the URL plus the same nonce in a signed, short-lived cookie
export interface OAuthCookiePayload {
  /** nonce, must equal the `state` Google sends back */
  n: string;
  /** inbox being connected */
  i: string;
  /** the signed-in user who started it */
  u: string;
  /** issued at (ms) */
  t: number;
}
export const OAUTH_COOKIE = "g_oauth";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

export const newOAuthNonce = () => randomBytes(24).toString("base64url");

const sign = (data: string, keyB64: string) => createHmac("sha256", parseEncryptionKey(keyB64)).update(`oauth-state:${data}`).digest("base64url");

export function signOAuthCookie(payload: OAuthCookiePayload, keyB64: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, keyB64)}`;
}

export function verifyOAuthCookie(value: string | undefined, keyB64: string, now = Date.now()): OAuthCookiePayload | null {
  if (!value) return null;
  const [data, mac] = value.split(".");
  if (!data || !mac) return null;
  const want = Buffer.from(sign(data, keyB64));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OAuthCookiePayload;
    if (typeof p.n !== "string" || typeof p.i !== "string" || typeof p.u !== "string" || typeof p.t !== "number") return null;
    if (now - p.t > OAUTH_COOKIE_MAX_AGE_SECONDS * 1000 || now < p.t - 5000) return null;
    return p;
  } catch {
    return null;
  }
}

export function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- token endpoint
export class GoogleAuthError extends Error {
  constructor(
    /** invalid_grant = the person revoked access, the token expired (7 days in Testing) or the password changed */
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}

async function tokenRequest(cfg: GoogleClientConfig, form: Record<string, string>) {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...form });
  const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    const desc = typeof json.error_description === "string" ? json.error_description : "";
    throw new GoogleAuthError(code, `Google sign-in failed (${code})${desc ? `: ${desc}` : ""}`);
  }
  return json;
}

export async function exchangeCode(cfg: GoogleClientConfig, p: { code: string; redirectUri: string }) {
  const j = await tokenRequest(cfg, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri });
  return {
    accessToken: String(j.access_token ?? ""),
    refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expiresInSeconds: Number(j.expires_in ?? 3600),
    scopes: String(j.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

export async function refreshAccessToken(cfg: GoogleClientConfig, refreshToken: string) {
  const j = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });
  return { accessToken: String(j.access_token ?? ""), expiresInSeconds: Number(j.expires_in ?? 3600), scopes: String(j.scope ?? "").split(/\s+/).filter(Boolean) };
}

/** Best effort: tells Google to forget the grant. Failure is not an error (the token may already be dead). */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Which Gmail address the access token belongs to (allowed by the gmail.compose scope). */
export async function fetchGmailAddress(accessToken: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const j = await requestJson<{ emailAddress?: string }>(fetchImpl, PROFILE_URL, { headers: { authorization: `Bearer ${accessToken}` } }, { label: "Gmail profile", redact: [accessToken] });
  if (!j.emailAddress) throw new Error("Gmail did not say which address signed in");
  return j.emailAddress.toLowerCase();
}

export const missingScopes = (granted: string[]): string[] => GOOGLE_SCOPES.filter((s) => !granted.includes(s));
