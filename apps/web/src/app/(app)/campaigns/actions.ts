"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { campaignSchema, campaignToRow } from "@outreach/core";
import { guardAction, type ActionState } from "@/lib/auth";
import { dbErrorMessage, validate } from "@/lib/forms";

export async function saveCampaign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("campaign.manage");
  if (!guard.ok) return guard.state;
  const v = validate(campaignSchema, formData, { arrays: ["sendDays"], booleans: ["researchFirst"] });
  if (!v.ok) return v.state;

  const row = campaignToRow(v.data);
  const id = String(formData.get("id") ?? "");
  const { error } = id
    ? await guard.supabase.from("campaigns").update(row).eq("id", id).is("deleted_at", null)
    : await guard.supabase.from("campaigns").insert(row);
  if (error) return { ok: false, message: dbErrorMessage(error) };

  revalidatePath("/campaigns");
  redirect("/campaigns");
}

/** Soft delete: the campaign disappears from lists but all of its history stays. */
export async function archiveCampaign(formData: FormData): Promise<void> {
  const guard = await guardAction("campaign.manage");
  if (!guard.ok) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await guard.supabase.from("campaigns").update({ deleted_at: new Date().toISOString(), status: "archived" }).eq("id", id);
  revalidatePath("/campaigns");
}
