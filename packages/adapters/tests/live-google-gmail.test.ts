import { describe, expect, it } from "vitest";
import {
  GOOGLE_SCOPES,
  GoogleAuthError,
  MailboxNeedsReconnectError,
  buildConsentUrl,
  buildRawMessage,
  createLiveGmail,
  decryptToken,
  encryptToken,
  exchangeCode,
  googleRedirectUri,
  missingScopes,
  needsReconnectForLabel,
  newOAuthNonce,
  refreshAccessToken,
  sameState,
  signOAuthCookie,
  verifyOAuthCookie,
  type GmailInboxRecord,
  type GmailTokenStore,
} from "../src";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("refresh-token encryption (AES-256-GCM)", () => {
  it("round-trips and never stores the token in the clear", () => {
    const blob = encryptToken("1//refresh-secret", KEY, "inbox-1");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("refresh-secret");
    expect(decryptToken(blob, KEY, "inbox-1")).toBe("1//refresh-secret");
  });
  it("uses a fresh IV every time", () => {
    expect(encryptToken("x", KEY, "i")).not.toBe(encryptToken("x", KEY, "i"));
  });
  it("fails for a wrong key, another inbox, or a tampered blob", () => {
    const blob = encryptToken("secret", KEY, "inbox-1");
    expect(() => decryptToken(blob, OTHER_KEY, "inbox-1")).toThrow(/could not be decrypted/);
    expect(() => decryptToken(blob, KEY, "inbox-2")).toThrow(/could not be decrypted/);
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptToken(parts.join("."), KEY, "inbox-1")).toThrow(/could not be decrypted/);
    expect(() => decryptToken("garbage", KEY, "inbox-1")).toThrow(/unknown format/);
  });
  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptToken("x", Buffer.alloc(16).toString("base64"), "i")).toThrow(/32 random bytes/);
  });
});

describe("Google OAuth request", () => {
  it("the redirect URI is NEXT_PUBLIC_SITE_URL + /api/google/callback, whatever the trailing slash or path", () => {
    expect(googleRedirectUri("http://localhost:3000")).toBe("http://localhost:3000/api/google/callback");
    expect(googleRedirectUri("http://localhost:3000/")).toBe("http://localhost:3000/api/google/callback");
    expect(googleRedirectUri("https://app.example.com/some/path")).toBe("https://app.example.com/api/google/callback");
  });
  it("asks for offline access and exactly two scopes: create drafts and put the label on them", () => {
    const url = new URL(buildConsentUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/google/callback", state: "st", loginHint: "me@gmail.com" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("login_hint")).toBe("me@gmail.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
    expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual(["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.modify"]);
    expect(GOOGLE_SCOPES).toHaveLength(2);
  });
  it("reports which scopes the person did not grant", () => {
    expect(missingScopes([...GOOGLE_SCOPES])).toEqual([]);
    expect(missingScopes(["https://www.googleapis.com/auth/gmail.compose"])).toEqual(["https://www.googleapis.com/auth/gmail.modify"]);
    // a mailbox connected before gmail.modify existed needs one reconnect for the label
    expect(needsReconnectForLabel(["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.labels"])).toBe(true);
    expect(needsReconnectForLabel([...GOOGLE_SCOPES])).toBe(false);
  });
});

describe("OAuth state (CSRF)", () => {
  const payload = () => ({ n: newOAuthNonce(), i: "inbox-1", u: "user-1", t: Date.now() });
  it("accepts its own cookie and a matching state, and rejects anything else", () => {
    const p = payload();
    const cookie = signOAuthCookie(p, KEY);
    expect(verifyOAuthCookie(cookie, KEY)).toEqual(p);
    expect(sameState(p.n, p.n)).toBe(true);
    expect(sameState(p.n, newOAuthNonce())).toBe(false);
    expect(sameState(null, p.n)).toBe(false);
    expect(sameState(p.n, "")).toBe(false);
  });
  it("rejects a tampered, foreign-key, missing or expired cookie", () => {
    const p = payload();
    const cookie = signOAuthCookie(p, KEY);
    const [data, mac] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...p, i: "inbox-2" })).toString("base64url");
    expect(verifyOAuthCookie(`${forged}.${mac}`, KEY)).toBeNull();
    expect(verifyOAuthCookie(`${data}.x`, KEY)).toBeNull();
    expect(verifyOAuthCookie(cookie, OTHER_KEY)).toBeNull();
    expect(verifyOAuthCookie(undefined, KEY)).toBeNull();
    expect(verifyOAuthCookie("nope", KEY)).toBeNull();
    expect(verifyOAuthCookie(cookie, KEY, p.t + 11 * 60_000)).toBeNull();
  });
  it("nonces are unique", () => {
    expect(new Set(Array.from({ length: 50 }, newOAuthNonce)).size).toBe(50);
  });
});

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("Google token endpoint", () => {
  it("exchanges a code for a refresh token and the granted scopes", async () => {
    let sent = "";
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return jsonRes(200, { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: GOOGLE_SCOPES.join(" ") });
    }) as unknown as typeof fetch;
    const r = await exchangeCode({ clientId: "cid", clientSecret: "csecret", fetchImpl }, { code: "the-code", redirectUri: "http://localhost:3000/api/google/callback" });
    expect(r).toMatchObject({ accessToken: "at", refreshToken: "rt", scopes: [...GOOGLE_SCOPES] });
    expect(new URLSearchParams(sent).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(sent).get("redirect_uri")).toBe("http://localhost:3000/api/google/callback");
  });
  it("turns invalid_grant into a GoogleAuthError without leaking the secret", async () => {
    const fetchImpl = (async () => jsonRes(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })) as unknown as typeof fetch;
    const err = await refreshAccessToken({ clientId: "cid", clientSecret: "csecret", fetchImpl }, "rt").catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect((err as GoogleAuthError).code).toBe("invalid_grant");
    expect(String((err as Error).message)).not.toContain("csecret");
  });
});

// ---------------------------------------------------------------- live Gmail adapter with a scripted fetch
interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

function makeStore(records: Record<string, Partial<GmailInboxRecord>>) {
  const events: string[] = [];
  const full = (id: string): GmailInboxRecord => ({
    encryptedRefreshToken: encryptToken(`refresh-${id}`, KEY, id),
    email: `${id}@gmail.com`,
    displayName: "Sourabh K",
    status: "active",
    scopes: [...GOOGLE_SCOPES],
    ...records[id],
  });
  const store: GmailTokenStore = {
    load: async (id) => (records[id] ? full(id) : null),
    markNeedsReconnect: async (id, reason) => {
      events.push(`needs_reconnect:${id}:${reason.slice(0, 40)}`);
      records[id] = { ...records[id], status: "needs_reconnect" };
    },
    markHealthy: async (id) => void events.push(`healthy:${id}`),
  };
  return { store, events };
}

function gmailFetch(opts: { labelApply?: "ok" | "403"; revoked?: Set<string> } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const body = init.body && typeof init.body === "string" && !String(init.headers && (init.headers as Record<string, string>)["content-type"]).includes("x-www-form") ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: init.method ?? "GET", url, body, auth: headers.authorization ?? null });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const form = new URLSearchParams(String(init.body));
      const rt = form.get("refresh_token")!;
      if (opts.revoked?.has(rt)) return jsonRes(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      return jsonRes(200, { access_token: `at-for-${rt}`, expires_in: 3600, scope: GOOGLE_SCOPES.join(" ") });
    }
    if (url.endsWith("/labels") && (init.method ?? "GET") === "GET") return jsonRes(200, { labels: [{ id: "L1", name: "INBOX" }] });
    if (url.endsWith("/labels") && init.method === "POST") return jsonRes(200, { id: "Label_99", name: "AI-Outreach" });
    if (url.endsWith("/drafts") && init.method === "POST") return jsonRes(200, { id: "draft-1", message: { id: "msg-1", threadId: "t-1" } });
    if (url.includes("/drafts/draft-1")) return jsonRes(200, { id: "draft-1", message: { payload: { headers: [{ name: "Message-ID", value: "<stored@mail.gmail.com>" }] } } });
    if (url.includes("/messages/msg-1/modify")) return opts.labelApply === "403" ? jsonRes(403, { error: { message: "Request had insufficient authentication scopes." } }) : jsonRes(200, { id: "msg-1" });
    return jsonRes(404, { error: "unexpected " + url });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const opts = (store: GmailTokenStore, fetchImpl: typeof fetch) => ({ clientId: "cid", clientSecret: "csecret", encryptionKey: KEY, tokens: store, fetchImpl });
const draftReq = (inboxId: string) => ({ inboxId, to: "lead@acme.com", subject: "Hello", bodyText: "Hi there\nSecond line", label: "AI-Outreach" });

describe("live Gmail: drafts", () => {
  it("creates a draft in the connected mailbox with its own token, and reports the stored Message-ID", async () => {
    const { store, events } = makeStore({ a: {} });
    const { fetchImpl, calls } = gmailFetch({ labelApply: "ok" });
    const res = await createLiveGmail(opts(store, fetchImpl)).createDraft(draftReq("a"));
    expect(res).toMatchObject({ draftId: "draft-1", messageId: "msg-1", messageIdHeader: "<stored@mail.gmail.com>", labelApplied: true });
    const create = calls.find((c) => c.url.endsWith("/drafts") && c.method === "POST")!;
    expect(create.auth).toBe("Bearer at-for-refresh-a");
    const raw = Buffer.from(String((create.body!.message as { raw: string }).raw), "base64url").toString("utf8");
    expect(raw).toContain("To: lead@acme.com");
    expect(raw).toContain('From: "Sourabh K" <a@gmail.com>');
    expect(raw).toContain("Subject: Hello");
    expect(calls.some((c) => c.url.includes("/messages/msg-1/modify") && JSON.stringify(c.body) === JSON.stringify({ addLabelIds: ["Label_99"] }))).toBe(true);
    expect(events).toContain("healthy:a");
  });

  it("never calls the Gmail send API", async () => {
    const { store } = makeStore({ a: {} });
    const { fetchImpl, calls } = gmailFetch({ labelApply: "ok" });
    await createLiveGmail(opts(store, fetchImpl)).createDraft(draftReq("a"));
    expect(calls.filter((c) => /\/send\b/.test(c.url))).toEqual([]);
  });

  it("a refused label never fails the draft; an old mailbox (no gmail.modify) is told to reconnect", async () => {
    const { store } = makeStore({ a: { scopes: ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.labels"] } });
    const { fetchImpl, calls } = gmailFetch({ labelApply: "403" });
    const gmail = createLiveGmail(opts(store, fetchImpl));
    const first = await gmail.createDraft(draftReq("a"));
    expect(first.draftId).toBe("draft-1");
    expect(first.labelApplied).toBe(false);
    expect(first.labelNote).toMatch(/reconnect it on the Setup page/);
    // it does not keep asking for something Google already refused for this mailbox
    const before = calls.filter((c) => c.url.includes("/modify")).length;
    const second = await gmail.createDraft(draftReq("a"));
    expect(second.labelApplied).toBe(false);
    expect(calls.filter((c) => c.url.includes("/modify")).length).toBe(before);
  });

  it("reuses the access token and the label id instead of fetching them again", async () => {
    const { store } = makeStore({ a: {} });
    const { fetchImpl, calls } = gmailFetch({ labelApply: "ok" });
    const gmail = createLiveGmail(opts(store, fetchImpl));
    await gmail.createDraft(draftReq("a"));
    await gmail.createDraft(draftReq("a"));
    expect(calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/labels"))).toHaveLength(2); // one list + one create, once
  });

  it("two mailboxes: each uses its own token, and a revoked one is marked 'needs reconnect' without touching the other", async () => {
    const { store, events } = makeStore({ a: {}, b: {} });
    const { fetchImpl, calls } = gmailFetch({ labelApply: "ok", revoked: new Set(["refresh-b"]) });
    const gmail = createLiveGmail(opts(store, fetchImpl));

    const okA = await gmail.createDraft(draftReq("a"));
    expect(okA.draftId).toBe("draft-1");

    await expect(gmail.createDraft(draftReq("b"))).rejects.toBeInstanceOf(MailboxNeedsReconnectError);
    expect(events.some((e) => e.startsWith("needs_reconnect:b:"))).toBe(true);
    expect(events.some((e) => e.startsWith("needs_reconnect:a:"))).toBe(false);

    // b is now refused straight away (no more calls to Google), a keeps working
    const tokenCallsBefore = calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token")).length;
    await expect(gmail.createDraft(draftReq("b"))).rejects.toThrow(/needs to be reconnected/);
    expect(calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token")).length).toBe(tokenCallsBefore);
    await expect(gmail.createDraft(draftReq("a"))).resolves.toMatchObject({ draftId: "draft-1" });
  });

  it("refuses a disconnected, paused or unknown mailbox before calling Google", async () => {
    const { store } = makeStore({ d: { status: "disconnected", encryptedRefreshToken: null }, p: { status: "paused" } });
    const { fetchImpl, calls } = gmailFetch();
    const gmail = createLiveGmail(opts(store, fetchImpl));
    await expect(gmail.createDraft(draftReq("d"))).rejects.toThrow(/not connected/);
    await expect(gmail.createDraft(draftReq("p"))).rejects.toThrow(/paused/);
    await expect(gmail.createDraft(draftReq("zzz"))).rejects.toBeInstanceOf(MailboxNeedsReconnectError);
    expect(calls).toHaveLength(0);
  });

  it("a token that cannot be decrypted is an error, never silently skipped", async () => {
    const { store } = makeStore({ a: { encryptedRefreshToken: encryptToken("x", OTHER_KEY, "a") } });
    const { fetchImpl } = gmailFetch();
    await expect(createLiveGmail(opts(store, fetchImpl)).createDraft(draftReq("a"))).rejects.toThrow(/could not be decrypted/);
  });
});

describe("building the message", () => {
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
  const base = { fromEmail: "me@gmail.com", fromName: "Me", to: "lead@acme.com", subject: "Hi", bodyText: "Hello", messageId: "<id@gmail.com>" };

  it("writes a plain-text UTF-8 message with the Message-ID, and the body survives", () => {
    const raw = decode(buildRawMessage({ ...base, bodyText: "Zażółć gęślą jaźń\nline 2" }));
    expect(raw).toContain("Message-ID: <id@gmail.com>");
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    const body = raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Zażółć gęślą jaźń\r\nline 2");
  });
  it("encodes non-ASCII subjects and names (RFC 2047)", () => {
    const raw = decode(buildRawMessage({ ...base, subject: "Idée pour vous", fromName: "Zoë" }));
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(raw).toMatch(/From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <me@gmail.com>/);
  });
  it("cannot be used to inject headers or extra recipients", () => {
    const raw = decode(buildRawMessage({ ...base, subject: "Hi\r\nBcc: evil@x.com", fromName: 'Me"\r\nBcc: evil@x.com' }));
    expect(raw).not.toMatch(/^Bcc:/m);
    for (const bad of ["a@b.com\r\nBcc: x@y.com", "a@b.com, c@d.com", "Name <a@b.com>", "nope", "a@b"]) {
      expect(() => buildRawMessage({ ...base, to: bad })).toThrow(/not a single valid email address/);
    }
  });
});
