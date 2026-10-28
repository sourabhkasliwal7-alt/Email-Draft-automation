"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { WORKFLOW_SETTINGS_KEY, parseWorkflowConfig, retryPatch } from "@outreach/core";
import { startRun } from "@outreach/db";
import { guardAction, type ActionState } from "@/lib/auth";
import { failedDraftIds } from "@/lib/email-style";
import { NO_CONTACT_ADVICE } from "@/lib/plain";
import { createServiceDb } from "@/lib/supabase/service";

/** What a person has to do when a lead cannot be retried by pressing a button. */
const NEEDS_YOU: Record<string, string> = {
  "no-email": "This person has no email address. Add one to your file and upload it again (or find leads with Apollo), then it can go on.",
  "no-contact": NO_CONTACT_ADVICE,
  "credit-uncertain": "A reveal may have used an Apollo credit but the answer was lost. Check your Apollo account first. It is never retried automatically, so you cannot spend a second credit by mistake. You can skip it.",
};

/**
 * "Retry": puts the lead back at the step that failed and starts a run for its campaign. Earlier steps are kept, so nothing that was
 * already paid for runs again. Nothing is deleted.
 */
export async function retryLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const guard = await guardAction("lead.mark_dnc");
  if (!guard.ok) return guard.state;
  const leadId = String(formData.get("id") ?? "");
  if (!leadId) return { ok: false, message: "Missing lead." };
  const db = createServiceDb();
  const { data: lead } = await db.from("campaign_leads").select("id, status, next_action, reason_codes, campaign_id, contact_id, contacts(email)").eq("id", leadId).maybeSingle();
  if (!lead) return { ok: false, message: "That lead no longer exists." };

  const { count: draftCount } = await db.from("email_drafts").select("id", { count: "exact", head: true }).eq("campaign_lead_id", leadId);
  const patch = retryPatch(
    { status: lead.status, reason_codes: lead.reason_codes, next_action: lead.next_action },
    { hasEmail: Boolean(lead.contacts?.email), hasDraft: (draftCount ?? 0) > 0 },
  );
  if (!patch) return { ok: false, message: NEEDS_YOU[lead.reason_codes[0] ?? ""] ?? "This one needs a person to look at it. You can skip it." };

  const { error } = await db.from("campaign_leads").update({ status: patch.status, next_action: patch.next_action, reason_codes: [] }).eq("id", leadId);
  if (error) return { ok: false, message: error.message };
  await db.from("lead_events").insert({ campaign_lead_id: leadId, contact_id: lead.contact_id, type: "retry", payload: { from: lead.reason_codes, step: patch.step }, actor: guard.user.email });

  revalidatePath("/drafts");
  revalidatePath("/");
  const { data: active } = await db.from("pipeline_batches").select("id, status").eq("campaign_id", lead.campaign_id).in("status", ["running", "paused"]).maybeSingle();
  // the lead leaves the list once it is retried, so the answer is shown at the top of the page (the row, and a message inside it, would be gone)
  if (active?.status === "running") redirect("/drafts?tab=attention&notice=retry_running");
  if (active?.status === "paused") redirect("/drafts?tab=attention&notice=retry_paused");

  const { data: cfgRow } = await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  const test = parseWorkflowConfig(cfgRow?.value).dry_run;
  try {
    await startRun(db, lead.campaign_id, { startedBy: guard.user.id, dryRun: test, label: "retry" });
  } catch (e) {
    return { ok: false, message: `Back in line for ${patch.step}, but the run could not start: ${(e as Error).message}` };
  }
  redirect("/drafts?tab=attention&notice=retry_started");
}

/**
 * "Retry all failed drafts": every lead of Needs attention whose email did not pass the checks goes back to the writing step only (the
 * research, approval, email address and credits are kept, so nothing earlier runs or is paid for again), then one run per campaign starts.
 * Same person, same guards and same running/paused answers as the single Retry.
 */
export async function retryFailedDraftsAction(): Promise<ActionState> {
  const guard = await guardAction("lead.mark_dnc");
  if (!guard.ok) return guard.state;
  const db = createServiceDb();
  const { data: rows } = await db
    .from("campaign_leads")
    .select("id, status, next_action, reason_codes, campaign_id, contact_id, contacts(email)")
    .overlaps("reason_codes", ["draft-failed"])
    .limit(500);
  const failed = new Set(failedDraftIds(rows ?? []));
  const leads = (rows ?? []).filter((l) => failed.has(l.id));
  if (!leads.length) return { ok: false, message: "No email has failed its checks. Nothing to write again." };

  const { data: drafts } = await db.from("email_drafts").select("campaign_lead_id").in("campaign_lead_id", leads.map((l) => l.id));
  const hasDraft = new Set((drafts ?? []).map((d) => d.campaign_lead_id));
  const campaigns = new Set<string>();
  let n = 0;
  for (const lead of leads) {
    const patch = retryPatch({ status: lead.status, reason_codes: lead.reason_codes, next_action: lead.next_action }, { hasEmail: Boolean(lead.contacts?.email), hasDraft: hasDraft.has(lead.id) });
    if (!patch) continue;
    const { error } = await db.from("campaign_leads").update({ status: patch.status, next_action: patch.next_action, reason_codes: [] }).eq("id", lead.id);
    if (error) return { ok: false, message: `${n} written again before an error: ${error.message}` };
    await db.from("lead_events").insert({ campaign_lead_id: lead.id, contact_id: lead.contact_id, type: "retry", payload: { from: lead.reason_codes, step: patch.step, bulk: true }, actor: guard.user.email });
    campaigns.add(lead.campaign_id);
    n++;
  }
  revalidatePath("/drafts");
  revalidatePath("/");

  const { data: cfgRow } = await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
  const test = parseWorkflowConfig(cfgRow?.value).dry_run;
  let started = 0;
  let running = 0;
  let paused = 0;
  for (const campaignId of campaigns) {
    const { data: active } = await db.from("pipeline_batches").select("id, status").eq("campaign_id", campaignId).in("status", ["running", "paused"]).maybeSingle();
    if (active?.status === "running") running++;
    else if (active?.status === "paused") paused++;
    else {
      try {
        await startRun(db, campaignId, { startedBy: guard.user.id, dryRun: test, label: "retry" });
        started++;
      } catch (e) {
        return { ok: false, message: `${n} back in line for writing the email, but a run could not start: ${(e as Error).message}` };
      }
    }
  }
  const code = started ? "retry_drafts_started" : paused && !running ? "retry_drafts_paused" : "retry_drafts_running";
  redirect(`/drafts?tab=attention&notice=${code}&n=${n}`);
}
