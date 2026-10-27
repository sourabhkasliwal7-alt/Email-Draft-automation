import { NextResponse, type NextRequest } from "next/server";
import {
  GoogleAuthError,
  OAUTH_COOKIE,
  encryptToken,
  exchangeCode,
  fetchGmailAddress,
  missingScopes,
  revokeToken,
  sameState,
  verifyOAuthCookie,
} from "@outreach/adapters";
import { evaluateGuard, getSession } from "@/lib/auth";
import { googleConfig } from "@/lib/google";
import { createServiceDb } from "@/lib/supabase/service";

/**
 * Step 2: Google sends the person back here. Nothing is stored unless ALL of this holds:
 *  1. the `state` equals the nonce in our signed cookie (CSRF) and the cookie is fresh,
 *  2. the same admin who started the flow is still signed in,
 *  3. Google granted a refresh token and both permissions,
 *  4. the Gmail address that signed in is the mailbox being connected.
 * The refresh token is then encrypted (AES-256-GCM) and stored with the service role: no user role can read or write it.
 */
export async function GET(request: NextRequest) {
  const cfg = googleConfig();
  const done = (code: string) => {
    const res = NextResponse.redirect(new URL(`/inboxes?gmail=${code}`, cfg.siteUrl ?? request.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/google", maxAge: 0 }); // one use only
    return res;
  };
  if (!cfg.ok) return done("not_configured");

  const q = request.nextUrl.searchParams;
  const cookie = verifyOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value, cfg.encryptionKey);
  if (!cookie || !sameState(cookie.n, q.get("state"))) return done("state");

  const guard = evaluateGuard(await getSession(), "inbox.manage");
  if (!guard.ok || guard.user.id !== cookie.u) return done("session");

  if (q.get("error")) return done(q.get("error") === "access_denied" ? "denied" : "google_error");
  const code = q.get("code");
  if (!code) return done("no_code");

  const db = createServiceDb();
  const { data: inbox } = await db.from("inboxes").select("id, email_lower").eq("id", cookie.i).is("deleted_at", null).maybeSingle();
  if (!inbox) return done("no_inbox");

  let tokens;
  try {
    tokens = await exchangeCode({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }, { code, redirectUri: cfg.redirectUri });
  } catch (e) {
    return done(e instanceof GoogleAuthError ? "token" : "google_error");
  }
  if (!tokens.refreshToken) return done("no_refresh_token");
  if (missingScopes(tokens.scopes).length) {
    await revokeToken(tokens.refreshToken);
    return done("scopes");
  }

  let address: string;
  try {
    address = await fetchGmailAddress(tokens.accessToken);
  } catch {
    await revokeToken(tokens.refreshToken);
    return done("profile");
  }
  if (address !== inbox.email_lower) {
    await revokeToken(tokens.refreshToken); // a grant from the wrong account must not linger
    return done("wrong_account");
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("inboxes")
    .update({ encrypted_refresh_token: encryptToken(tokens.refreshToken, cfg.encryptionKey, inbox.id), scopes: tokens.scopes, status: "active", connected_at: now, last_error: null, last_health_check: now })
    .eq("id", inbox.id);
  if (error) return done("google_error");
  return done("connected");
}
