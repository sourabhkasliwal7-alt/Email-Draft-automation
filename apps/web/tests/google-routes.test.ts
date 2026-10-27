import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_SCOPES, OAUTH_COOKIE, decryptToken, newOAuthNonce, signOAuthCookie } from "@outreach/adapters";

// the routes import Next/Supabase server modules; what is under test is the decision logic around them
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getSession: async () => session.current }));

const store = vi.hoisted(() => ({ inbox: null as { id: string; email: string; email_lower: string } | null, updates: [] as Record<string, unknown>[] }));
const chain = () => ({
  select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: store.inbox }) }) }) }),
  update: (v: Record<string, unknown>) => ({
    eq: async () => {
      store.updates.push(v);
      return { error: null };
    },
  }),
});
vi.mock("@/lib/supabase/service", () => ({ createServiceDb: () => ({ from: chain }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: chain }) }));

import { GET as callback } from "../src/app/api/google/callback/route";
import { GET as connect } from "../src/app/api/google/connect/route";

const KEY = Buffer.alloc(32, 5).toString("base64");
const INBOX = "11111111-1111-4111-8111-111111111111";
const admin = { state: "ok", user: { id: "admin-1", email: "a@x.com", role: "admin", fullName: null } };
const reviewer = { state: "ok", user: { id: "rev-1", email: "r@x.com", role: "reviewer", fullName: null } };

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SITE_URL", "GOOGLE_APP_PUBLISHING"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "csecret", TOKEN_ENCRYPTION_KEY: KEY, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
  session.current = admin;
  store.inbox = { id: INBOX, email: "me@gmail.com", email_lower: "me@gmail.com" };
  store.updates = [];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const cookieFor = (over: Partial<{ n: string; i: string; u: string; t: number }> = {}) => signOAuthCookie({ n: "nonce-1", i: INBOX, u: "admin-1", t: Date.now(), ...over }, KEY);
const callbackReq = (qs: string, cookie?: string) => new NextRequest(`http://localhost:3000/api/google/callback?${qs}`, { headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {} });
const location = (res: Response) => new URL(res.headers.get("location")!);

/** Scripted Google: token endpoint, Gmail profile, revoke. */
function google(opts: { email?: string; scopes?: string[]; refresh?: string | null; tokenFails?: boolean } = {}) {
  const revoked: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (opts.tokenFails) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at-1", ...(opts.refresh === null ? {} : { refresh_token: opts.refresh ?? "RT-SECRET-1" }), expires_in: 3600, scope: (opts.scopes ?? [...GOOGLE_SCOPES]).join(" ") }), { status: 200 });
    }
    if (url.endsWith("/users/me/profile")) return new Response(JSON.stringify({ emailAddress: opts.email ?? "Me@Gmail.com" }), { status: 200 });
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      revoked.push(String((init?.body as URLSearchParams).get("token")));
      return new Response("{}", { status: 200 });
    }
    return new Response("unexpected", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { revoked, fetchMock };
}

describe("/api/google/connect", () => {
  it("sends an admin to Google with offline access, the two narrow scopes, the exact redirect URI and a state that matches the signed cookie", async () => {
    const res = await connect(new NextRequest(`http://localhost:3000/api/google/connect?inbox=${INBOX}`));
    const to = location(res);
    expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(to.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
    expect(to.searchParams.get("access_type")).toBe("offline");
    expect(to.searchParams.get("login_hint")).toBe("me@gmail.com");
    expect(to.searchParams.get("scope")!.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
    const state = to.searchParams.get("state")!;
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/httponly/i);
    expect(set).toMatch(/samesite=lax/i);
    expect(set).toContain(`${OAUTH_COOKIE}=`);
    const value = /g_oauth=([^;]+)/.exec(set)![1]!;
    // the cookie carries the same nonce, the mailbox and the person
    const payload = JSON.parse(Buffer.from(decodeURIComponent(value).split(".")[0]!, "base64url").toString());
    expect(payload).toMatchObject({ n: state, i: INBOX, u: "admin-1" });
  });
  it("refuses anyone who is not an admin, an unknown mailbox, and a missing configuration", async () => {
    session.current = reviewer;
    expect(location(await connect(new NextRequest(`http://localhost:3000/api/google/connect?inbox=${INBOX}`))).search).toBe("?gmail=forbidden");
    session.current = admin;
    expect(location(await connect(new NextRequest("http://localhost:3000/api/google/connect?inbox=not-a-uuid"))).search).toBe("?gmail=no_inbox");
    store.inbox = null;
    expect(location(await connect(new NextRequest(`http://localhost:3000/api/google/connect?inbox=${INBOX}`))).search).toBe("?gmail=no_inbox");
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await connect(new NextRequest(`http://localhost:3000/api/google/connect?inbox=${INBOX}`));
    expect(location(res).search).toBe("?gmail=not_configured");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("/api/google/callback", () => {
  it("connects the mailbox: stores an ENCRYPTED refresh token for exactly that mailbox, with the scopes, and clears the cookie", async () => {
    const g = google();
    const res = await callback(callbackReq("code=abc&state=nonce-1", cookieFor()));
    expect(location(res).search).toBe("?gmail=connected");
    expect(store.updates).toHaveLength(1);
    const u = store.updates[0]!;
    expect(u.status).toBe("active");
    expect(u.scopes).toEqual([...GOOGLE_SCOPES]);
    expect(u.last_error).toBeNull();
    expect(typeof u.connected_at).toBe("string");
    const blob = String(u.encrypted_refresh_token);
    expect(blob).not.toContain("RT-SECRET-1");
    expect(decryptToken(blob, KEY, INBOX)).toBe("RT-SECRET-1");
    expect(() => decryptToken(blob, KEY, "another-inbox")).toThrow();
    expect(g.revoked).toEqual([]);
    expect(res.headers.get("set-cookie")).toMatch(/g_oauth=;/);
  });

  it("rejects a forged or missing state, a missing/tampered/expired cookie (CSRF), storing nothing and never calling Google", async () => {
    const g = google();
    for (const req of [
      callbackReq("code=abc&state=other-nonce", cookieFor()), // state does not match the cookie
      callbackReq("code=abc", cookieFor()), // no state
      callbackReq("code=abc&state=nonce-1"), // no cookie
      callbackReq("code=abc&state=nonce-1", cookieFor().replace(/.$/, "x")), // tampered signature
      callbackReq("code=abc&state=nonce-1", cookieFor({ t: Date.now() - 11 * 60_000 })), // expired
      callbackReq("code=abc&state=nonce-1", signOAuthCookie({ n: "nonce-1", i: INBOX, u: "admin-1", t: Date.now() }, Buffer.alloc(32, 9).toString("base64"))), // signed with another key
    ]) {
      expect(location(await callback(req)).search).toBe("?gmail=state");
    }
    expect(store.updates).toEqual([]);
    expect(g.fetchMock).not.toHaveBeenCalled();
  });

  it("only the same admin who started the flow can finish it", async () => {
    google();
    session.current = reviewer;
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=session");
    session.current = { state: "ok", user: { ...admin.user, id: "admin-2" } };
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=session");
    session.current = { state: "anonymous" };
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=session");
    expect(store.updates).toEqual([]);
  });

  it("refuses a different Gmail account than the mailbox, stores nothing and revokes that grant", async () => {
    const g = google({ email: "someone.else@gmail.com" });
    const res = await callback(callbackReq("code=abc&state=nonce-1", cookieFor()));
    expect(location(res).search).toBe("?gmail=wrong_account");
    expect(store.updates).toEqual([]);
    expect(g.revoked).toEqual(["RT-SECRET-1"]);
  });

  it("refuses when a permission was unticked, or Google gave no refresh token", async () => {
    let g = google({ scopes: ["https://www.googleapis.com/auth/gmail.compose"] });
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=scopes");
    expect(g.revoked).toEqual(["RT-SECRET-1"]);
    g = google({ refresh: null });
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=no_refresh_token");
    expect(store.updates).toEqual([]);
  });

  it("maps Google's answers to fixed codes: denied, error, no code, failed exchange", async () => {
    google({ tokenFails: true });
    expect(location(await callback(callbackReq("error=access_denied&state=nonce-1", cookieFor()))).search).toBe("?gmail=denied");
    expect(location(await callback(callbackReq("error=server_error&state=nonce-1", cookieFor()))).search).toBe("?gmail=google_error");
    expect(location(await callback(callbackReq("state=nonce-1", cookieFor()))).search).toBe("?gmail=no_code");
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=token");
    expect(store.updates).toEqual([]);
  });

  it("an unknown mailbox id in a valid cookie stores nothing", async () => {
    google();
    store.inbox = null;
    expect(location(await callback(callbackReq("code=abc&state=nonce-1", cookieFor()))).search).toBe("?gmail=no_inbox");
    expect(store.updates).toEqual([]);
  });

  it("uses a fresh nonce per attempt", () => {
    expect(newOAuthNonce()).not.toBe(newOAuthNonce());
  });
});
