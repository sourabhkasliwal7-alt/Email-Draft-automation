"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inboxLimitsSchema } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";

const newInboxSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  displayName: z.string().trim().default(""),
});

/** Registers an inbox record only. Connecting Google (OAuth) and storing the encrypted token is Phase 10. */
export async function addInbox(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return guard.state;
  const v = validate(newInboxSchema, formData);
  if (!v.ok) return v.state;
  const { error } = await guard.supabase
    .from("inboxes")
    .insert({ email: v.data.email, display_name: v.data.displayName || null, status: "disconnected" });
  if (error) return { ok: false, message: error.code === "23505" ? "An inbox with that address already exists." : dbErrorMessage(error) };
  revalidatePath("/inboxes");
  return { ok: true, message: "Inbox added. Connect it to Google in Phase 10." };
}

export async function saveInboxLimits(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("inbox.manage");
  if (!guard.ok) return guard.state;
  const v = validate(inboxLimitsSchema, formData);
  if (!v.ok) return v.state;
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing inbox id." };
  const { error } = await guard.supabase
    .from("inboxes")
    .update({
      display_name: v.data.displayName,
      status: v.data.status,
      daily_draft_cap: v.data.dailyDraftCap,
      daily_send_cap: v.data.dailySendCap,
      min_seconds_between_sends: v.data.minSecondsBetweenSends,
    })
    .eq("id", id);
  if (error) return { ok: false, message: dbErrorMessage(error) };
  revalidatePath("/inboxes");
  return { ok: true, message: "Saved." };
}
