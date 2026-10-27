"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/auth";
import { createServiceDb } from "@/lib/supabase/service";

/** Takes the person off the list for good: do-not-contact on the contact and an address suppression. */
export async function markDncAction(formData: FormData): Promise<void> {
  const guard = await guardAction("lead.mark_dnc");
  if (!guard.ok) return;
  const leadId = String(formData.get("id") ?? "");
  if (!leadId) return;
  const db = createServiceDb();
  const { data: lead } = await db.from("campaign_leads").select("id, contact_id, contacts(email_lower)").eq("id", leadId).maybeSingle();
  if (!lead) return;
  await db.from("contacts").update({ dnc: true }).eq("id", lead.contact_id);
  const email = lead.contacts?.email_lower;
  if (email) await db.from("suppression").insert({ email_lower: email, scope: "global", reason: "marked do-not-contact from Needs attention", source: "manual" });
  await db.from("campaign_leads").update({ status: "disqualified", reason_codes: ["suppressed", "marked do-not-contact"], next_action: null }).eq("id", leadId);
  revalidatePath("/drafts");
}

/** "Skip": the lead is closed as a manual skip and leaves the list. */
export async function skipLeadAction(formData: FormData): Promise<void> {
  const guard = await guardAction("lead.mark_dnc");
  if (!guard.ok) return;
  const leadId = String(formData.get("id") ?? "");
  if (!leadId) return;
  await createServiceDb().from("campaign_leads").update({ status: "disqualified", reason_codes: ["manual"], next_action: null }).eq("id", leadId);
  revalidatePath("/drafts");
}
