import type { GmailTokenStore } from "@outreach/adapters";
import type { DbClient } from "@outreach/db";

const HEALTH_WRITE_EVERY_MS = 60 * 60 * 1000;

/**
 * Mailbox sign-ins live in the `inboxes` table (service role only). The adapter asks for them here, and reports back when
 * Google stops accepting one, which flips only THAT mailbox to "needs_reconnect" so the others keep working.
 */
export function createGmailTokenStore(db: DbClient): GmailTokenStore {
  const lastHealthWrite = new Map<string, number>();
  return {
    async load(inboxId) {
      const { data, error } = await db.from("inboxes").select("encrypted_refresh_token, email, display_name, status, scopes").eq("id", inboxId).is("deleted_at", null).maybeSingle();
      if (error) throw new Error(`load mailbox: ${error.message}`);
      if (!data) return null;
      return { encryptedRefreshToken: data.encrypted_refresh_token, email: data.email, displayName: data.display_name, status: data.status, scopes: data.scopes };
    },
    async markNeedsReconnect(inboxId, reason) {
      await db.from("inboxes").update({ status: "needs_reconnect", last_error: reason.slice(0, 500), last_health_check: new Date().toISOString() }).eq("id", inboxId).in("status", ["active", "error"]);
    },
    async markHealthy(inboxId) {
      // every change to an inbox is audited, so this is written at most once an hour per mailbox, not once per draft
      const last = lastHealthWrite.get(inboxId) ?? 0;
      if (Date.now() - last < HEALTH_WRITE_EVERY_MS) return;
      lastHealthWrite.set(inboxId, Date.now());
      await db.from("inboxes").update({ last_health_check: new Date().toISOString(), last_error: null }).eq("id", inboxId).eq("status", "active");
    },
  };
}
