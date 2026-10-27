import type { GmailAdapter } from "../types";
import { GoogleAuthError, GMAIL_MODIFY_SCOPE, refreshAccessToken } from "./google";
import { HttpError, requestJson, type FetchLike } from "./http";
import { decryptToken } from "./token-crypto";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** What the adapter needs to know about a mailbox. The worker backs this with the `inboxes` table. */
export interface GmailInboxRecord {
  encryptedRefreshToken: string | null;
  email: string;
  displayName: string | null;
  status: string;
  /** scopes Google granted when the mailbox was connected */
  scopes: string[];
}
export interface GmailTokenStore {
  load(inboxId: string): Promise<GmailInboxRecord | null>;
  /** the sign-in is no longer valid: show "Needs reconnect" for this mailbox only */
  markNeedsReconnect(inboxId: string, reason: string): Promise<void>;
  markHealthy(inboxId: string): Promise<void>;
}

/** The mailbox must be (re)connected by a person. Other mailboxes are not affected. */
export class MailboxNeedsReconnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxNeedsReconnectError";
  }
}

export interface LiveGmailOptions {
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  tokens: GmailTokenStore;
  fetchImpl?: FetchLike;
  now?: () => number;
}

// ---------------------------------------------------------------- building the message (RFC 5322)
const NOT_ASCII = /[^\x20-\x7e]/;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Header values can never contain a line break (header injection). */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
function encodeWord(value: string): string {
  const v = oneLine(value);
  return NOT_ASCII.test(v) ? `=?UTF-8?B?${b64(v)}?=` : v;
}
function formatAddress(email: string, displayName: string | null): string {
  const name = displayName ? oneLine(displayName) : "";
  if (!name) return email;
  return NOT_ASCII.test(name) ? `${encodeWord(name)} <${email}>` : `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}
const ADDRESS_RE = /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]+$/;

export function buildRawMessage(p: { fromEmail: string; fromName: string | null; to: string; subject: string; bodyText: string; messageId: string; date?: Date }): string {
  if (!ADDRESS_RE.test(p.to)) throw new Error(`"${p.to.slice(0, 80)}" is not a single valid email address`);
  const body = p.bodyText.replace(/\r?\n/g, "\r\n");
  const wrapped = (b64(body).match(/.{1,76}/g) ?? []).join("\r\n");
  const headers = [
    `From: ${formatAddress(p.fromEmail, p.fromName)}`,
    `To: ${p.to}`,
    `Subject: ${encodeWord(p.subject)}`,
    `Date: ${(p.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${p.messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${wrapped}\r\n`, "utf8").toString("base64url");
}

// ---------------------------------------------------------------- the adapter
/**
 * Creates Gmail drafts only. There is no send call in this file: sending lives in the send job and stays switched off.
 * Each mailbox has its own refresh token; one mailbox failing never touches another.
 */
export function createLiveGmail(opts: LiveGmailOptions): GmailAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const google = { clientId: opts.clientId, clientSecret: opts.clientSecret, fetchImpl };
  const access = new Map<string, { token: string; expiresAt: number }>();
  const labelIds = new Map<string, string>();
  /** mailboxes where Google refused to put a label on a message (missing permission): do not try again in this process */
  const labelApplyRefused = new Set<string>();

  async function record(inboxId: string): Promise<GmailInboxRecord & { encryptedRefreshToken: string }> {
    const rec = await opts.tokens.load(inboxId);
    if (!rec) throw new MailboxNeedsReconnectError("This mailbox no longer exists.");
    if (rec.status === "paused") throw new MailboxNeedsReconnectError(`${rec.email} is paused.`);
    if (rec.status === "needs_reconnect") throw new MailboxNeedsReconnectError(`${rec.email} needs to be reconnected to Google (Mailboxes > Reconnect).`);
    if (!rec.encryptedRefreshToken || rec.status === "disconnected") throw new MailboxNeedsReconnectError(`${rec.email} is not connected to Google yet (Mailboxes > Connect Gmail).`);
    return rec as GmailInboxRecord & { encryptedRefreshToken: string };
  }

  async function accessToken(inboxId: string, rec: GmailInboxRecord & { encryptedRefreshToken: string }, force = false): Promise<string> {
    const cached = access.get(inboxId);
    if (!force && cached && cached.expiresAt - 60_000 > now()) return cached.token;
    try {
      const refreshToken = decryptToken(rec.encryptedRefreshToken, opts.encryptionKey, inboxId);
      const t = await refreshAccessToken(google, refreshToken);
      access.set(inboxId, { token: t.accessToken, expiresAt: now() + t.expiresInSeconds * 1000 });
      return t.accessToken;
    } catch (e) {
      access.delete(inboxId);
      if (e instanceof GoogleAuthError && (e.code === "invalid_grant" || e.code === "invalid_client" || e.code === "unauthorized_client")) {
        const reason = e.code === "invalid_grant" ? "Google no longer accepts this sign-in (access was removed, it expired, or the password changed). If the Google app is in Testing mode, sign-ins expire after 7 days." : `Google rejected the app credentials (${e.code}).`;
        await opts.tokens.markNeedsReconnect(inboxId, reason);
        throw new MailboxNeedsReconnectError(`${rec.email}: ${reason}`);
      }
      throw e;
    }
  }

  async function call<T>(inboxId: string, rec: GmailInboxRecord & { encryptedRefreshToken: string }, path: string, init: { method?: string; body?: unknown } = {}, label = "Gmail"): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(inboxId, rec, attempt > 0);
      try {
        return await requestJson<T>(
          fetchImpl,
          `${API}${path}`,
          { method: init.method ?? "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
          { label, redact: [token] },
        );
      } catch (e) {
        if (e instanceof HttpError && e.status === 401 && attempt === 0) continue; // access token went stale: refresh once
        throw e;
      }
    }
  }

  async function ensureLabel(inboxId: string, rec: GmailInboxRecord & { encryptedRefreshToken: string }, name: string): Promise<string> {
    const key = `${inboxId}:${name}`;
    const known = labelIds.get(key);
    if (known) return known;
    const list = await call<{ labels?: { id: string; name: string }[] }>(inboxId, rec, "/labels", {}, "Gmail labels");
    let id = list.labels?.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
    if (!id) {
      const made = await call<{ id: string }>(inboxId, rec, "/labels", { method: "POST", body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } }, "Gmail label create");
      id = made.id;
    }
    labelIds.set(key, id);
    return id;
  }

  return {
    async createDraft(req) {
      const rec = await record(req.inboxId);
      const domain = rec.email.split("@")[1] ?? "localhost";
      const ourMessageId = `<${crypto.randomUUID()}@${domain}>`;
      const raw = buildRawMessage({ fromEmail: rec.email, fromName: rec.displayName, to: req.to, subject: req.subject, bodyText: req.bodyText, messageId: ourMessageId });
      const draft = await call<{ id: string; message?: { id: string } }>(req.inboxId, rec, "/drafts", { method: "POST", body: { message: { raw } } }, "Gmail draft");
      await opts.tokens.markHealthy(req.inboxId).catch(() => undefined);

      // the Message-ID Gmail actually stored (it may replace ours); fall back to ours
      let messageIdHeader = ourMessageId;
      try {
        const got = await call<{ message?: { payload?: { headers?: { name: string; value: string }[] } } }>(req.inboxId, rec, `/drafts/${encodeURIComponent(draft.id)}?format=metadata`, {}, "Gmail draft read");
        const h = got.message?.payload?.headers?.find((x) => x.name.toLowerCase() === "message-id")?.value;
        if (h) messageIdHeader = h;
      } catch {
        /* the draft exists; keep our own header value */
      }

      // The label is best effort: the draft is already saved, and with only compose + labels Google does not allow
      // putting a label on a message (that needs gmail.modify), so a refusal here must never fail the draft.
      let labelApplied = false;
      let labelNote: string | undefined;
      if (req.label) {
        if (labelApplyRefused.has(req.inboxId)) labelNote = `label "${req.label}" not applied: Google refused it earlier for this mailbox (reconnect it on the Setup page)`;
        else {
          try {
            const id = await ensureLabel(req.inboxId, rec, req.label);
            if (!draft.message?.id) throw new Error("Gmail returned no message id for the draft");
            await call(req.inboxId, rec, `/messages/${encodeURIComponent(draft.message.id)}/modify`, { method: "POST", body: { addLabelIds: [id] } }, "Gmail label apply");
            labelApplied = true;
          } catch (e) {
            if (e instanceof MailboxNeedsReconnectError) throw e;
            if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
              labelApplyRefused.add(req.inboxId);
              labelNote = rec.scopes.includes(GMAIL_MODIFY_SCOPE)
                ? `label "${req.label}" could not be put on the draft: Google refused it`
                : `label "${req.label}" could not be put on the draft: this mailbox was connected before the label permission (gmail.modify) was added: reconnect it on the Setup page`;
            } else {
              labelNote = `label "${req.label}" not applied: ${(e as Error).message.slice(0, 160)}`;
            }
          }
        }
      }
      return { draftId: draft.id, messageIdHeader, messageId: draft.message?.id, labelApplied, labelNote };
    },

    async listReplies() {
      throw new Error("Reading replies is not built yet (reply tracking is a later step). Nothing in the core flow needs it.");
    },
  };
}
