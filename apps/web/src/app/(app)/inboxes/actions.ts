"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { decryptToken, revokeToken } from "@outreach/adapters";
import { inboxLimitsSchema } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { queueAdapterTest } from "@/lib/adapter-tests";
import { dbErrorMessage, validate } from "@/lib/forms";
import { googleConfig } from "@/lib/google";
import { createServiceDb } from "@/lib/supabase/service";

const newInboxSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  displayName: z.string().trim().default(""),
});

/** Registers a mailbox record. Press "Connect Gmail" on it to sign in to Google. */
export async function addInbox(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return guard.state;
  const v = validate(newInboxSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase
    .from("inboxes")
    .insert({ email: v.data.email, display_name: v.data.displayName || null, status: "disconnected" });
  if (error) return { ok: false, message: error.code === "23505" ? "An inbox with that address already exists." : dbErrorMessage(error) };
  revalidatePath("/setup");
  return { ok: true, message: "Mailbox added. Press Connect Gmail on it to sign in to Google." };
}

export async function saveInboxLimits(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return guard.state;
  const v = validate(inboxLimitsSchema, formData);
  if (!v.ok) return v.state;
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing inbox id." };
  // The status is not a free choice: only a connected mailbox can be switched between active and paused.
  // Connecting, "needs reconnect" and disconnecting are set by the Google flow, never by hand.
  const { data: current } = await guard.supabase.from("inboxes").select("status").eq("id", id).maybeSingle();
  const canSwitch = (current?.status === "active" || current?.status === "paused" || current?.status === "error") && (v.data.status === "active" || v.data.status === "paused");
  const { error } = await guard.supabase
    .from("inboxes")
    .update({
      display_name: v.data.displayName,
      ...(canSwitch ? { status: v.data.status } : {}),
      daily_draft_cap: v.data.dailyDraftCap,
      daily_send_cap: v.data.dailySendCap,
      min_seconds_between_sends: v.data.minSecondsBetweenSends,
    })
    .eq("id", id);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/setup");
  return { ok: true, message: "Saved." };
}

/** Forget the Google sign-in for one mailbox: the token is deleted here and Google is told to revoke it. Other mailboxes are untouched. */
export async function disconnectInbox(formData: FormData): Promise<void> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = createServiceDb();
  const { data: inbox } = await db.from("inboxes").select("encrypted_refresh_token").eq("id", id).maybeSingle();
  const cfg = googleConfig();
  if (inbox?.encrypted_refresh_token && cfg.ok) {
    try {
      await revokeToken(decryptToken(inbox.encrypted_refresh_token, cfg.encryptionKey, id));
    } catch {
      /* already unreadable or revoked: still disconnect locally */
    }
  }
  await db.from("inboxes").update({ encrypted_refresh_token: null, scopes: [], status: "disconnected", connected_at: null, last_error: null }).eq("id", id);
  revalidatePath("/setup");
  redirect("/setup?gmail=disconnected#mailboxes");
}

/** Queues one Gmail draft addressed to the mailbox itself, so the connection can be checked without touching any lead. Nothing is sent. */
export async function createTestDraft(formData: FormData): Promise<void> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (id) await queueAdapterTest("gmail", id);
  revalidatePath("/setup");
}
