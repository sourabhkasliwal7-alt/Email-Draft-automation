import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, OAUTH_COOKIE_MAX_AGE_SECONDS, buildConsentUrl, newOAuthNonce, signOAuthCookie } from "@outreach/adapters";
import { evaluateGuard, getSession } from "@/lib/auth";
import { googleConfig } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";

/**
 * Step 1 of "Connect Gmail": an admin presses the button for one mailbox. We remember a random nonce (in a signed,
 * short-lived cookie that also records which mailbox and which person) and send the browser to Google with the same
 * nonce as `state`. The callback accepts the answer only if both match.
 */
export async function GET(request: NextRequest) {
  const cfg = googleConfig();
  const back = (code: string) => NextResponse.redirect(new URL(`/inboxes?gmail=${code}`, cfg.siteUrl ?? request.url));
  if (!cfg.ok) return back("not_configured");

  const guard = evaluateGuard(await getSession(), "inbox.manage");
  if (!guard.ok) return back("forbidden");

  const inboxId = request.nextUrl.searchParams.get("inbox") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(inboxId)) return back("no_inbox");
  const supabase = await createClient();
  const { data: inbox } = await supabase.from("inboxes").select("id, email").eq("id", inboxId).is("deleted_at", null).maybeSingle();
  if (!inbox) return back("no_inbox");

  const nonce = newOAuthNonce();
  const res = NextResponse.redirect(buildConsentUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state: nonce, loginHint: inbox.email }));
  res.cookies.set(OAUTH_COOKIE, signOAuthCookie({ n: nonce, i: inbox.id, u: guard.user.id, t: Date.now() }, cfg.encryptionKey), {
    httpOnly: true,
    sameSite: "lax", // the return from Google is a top-level navigation, so Lax cookies are sent
    secure: cfg.siteUrl.startsWith("https://"),
    path: "/api/google",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
