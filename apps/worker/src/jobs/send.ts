import type { JobInfo, WorkerCtx } from "../ctx";
import { RetryLater } from "../ctx";
import { isSendingEnabled, leadEvent, loadLead, must } from "../pipeline/common";
import { suppressionHalt } from "./lead";

export interface SendPayload {
  draftId: string;
}

type Outcome = { sent: true; sendId: string } | { blocked: string } | { unknown: string } | { skipped: string };

/**
 * THE ONLY MODULE THAT SENDS. Every refusal below is also enforced by database triggers on email_sends, so a bug here
 * still cannot send an unapproved, suppressed, duplicate or over-cap email.
 *
 * A send happens only if: sending is switched on, the draft has a Gmail draft, a sender/admin recorded an approval of
 * this exact text, the contact is not do-not-contact / suppressed / invalid, no earlier send exists for this lead+step,
 * and the inbox is active and within its daily cap and minimum delay. Anything unclear after the Gmail call ends as
 * "unknown" for a human to check; it is never resent automatically.
 */
export async function sendJob(ctx: WorkerCtx, payload: SendPayload, _job: JobInfo): Promise<Outcome> {
  const { db } = ctx;
  const block = async (reason: string, lead?: { id: string; contact_id: string }): Promise<Outcome> => {
    if (lead) await leadEvent(db, lead, "send_blocked", { draft_id: payload.draftId, reason });
    ctx.log(`send blocked for draft ${payload.draftId}: ${reason}`);
    return { blocked: reason };
  };

  if (!(await isSendingEnabled(db))) return block("sending is switched off (SENDING_ENABLED)");

  const draft = must(await db.from("email_drafts").select("*").eq("id", payload.draftId).single(), "load draft");
  const lead = await loadLead(db, draft.campaign_lead_id);
  const contact = lead.contacts!;
  const ref = { id: lead.id, contact_id: lead.contact_id };

  if (draft.status === "sent") return { skipped: "already sent" };
  if (!draft.gmail_draft_id || draft.status !== "approved") return block("the draft has not been created in Gmail", ref);

  const { data: approval } = await db.from("send_approvals").select("id, body_hash").eq("draft_id", draft.id).maybeSingle();
  if (!approval) return block("no recorded send approval", ref);
  if (approval.body_hash !== draft.body_hash) return block("the draft changed after it was approved", ref);

  const halt = await suppressionHalt(ctx, lead);
  if (halt) return block(`recipient is ${halt}`, ref);
  if (!contact.email) return block("no recipient email", ref);

  const inboxId = draft.inbox_id;
  if (!inboxId) return block("no inbox", ref);
  const inbox = must(await db.from("inboxes").select("status, min_seconds_between_sends").eq("id", inboxId).single(), "load inbox");
  if (inbox.status !== "active") return block("the inbox is not active", ref);

  const sendKey = `send:${lead.campaign_id}:${lead.id}:${draft.step}:${draft.version}`;
  const { data: prior } = await db.from("email_sends").select("id, status").eq("send_key", sendKey).maybeSingle();
  if (prior) return { skipped: `a send already exists (${prior.status})` };

  // minimum delay between sends from one inbox (reputation protection): wait, do not fail
  const { data: last } = await db.from("email_sends").select("sent_at").eq("inbox_id", inboxId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.sent_at) {
    const readyAt = new Date(last.sent_at).getTime() + inbox.min_seconds_between_sends * 1000;
    if (readyAt > Date.now()) throw new RetryLater("minimum delay between sends", new Date(readyAt + Math.floor(Math.random() * 5000)));
  }

  // queue the send: the database trigger re-checks approval, suppression, duplicates, inbox and daily cap
  const { data: queued, error: queueError } = await db
    .from("email_sends")
    .insert({
      draft_id: draft.id, send_key: sendKey, inbox_id: inboxId, recipient_name: contact.full_name, recipient_email: contact.email, company: contact.companies?.name ?? contact.company_name,
      subject: draft.subject, body_text: draft.body_text, campaign_id: lead.campaign_id, status: "queued",
    })
    .select("id")
    .single();
  if (queueError) return block(queueError.message.replace(/^send blocked: /, ""), ref);

  const { error: sendingError } = await db.from("email_sends").update({ status: "sending", attempt: 1 }).eq("id", queued.id);
  if (sendingError) {
    await db.from("email_sends").update({ status: "cancelled", failure_reason: sendingError.message }).eq("id", queued.id);
    return block(sendingError.message, ref);
  }

  let result: { messageId: string; threadId: string };
  try {
    result = await ctx.adapters.gmailSender.sendDraft({ inboxId, draftId: draft.gmail_draft_id });
  } catch (e) {
    // We cannot know whether Gmail accepted it. Never resend automatically.
    const reason = e instanceof Error ? e.message : String(e);
    await db.from("email_sends").update({ status: "unknown", failure_reason: `send call failed: ${reason}` }).eq("id", queued.id);
    await leadEvent(db, lead, "send_unknown", { draft_id: draft.id, reason });
    return { unknown: reason };
  }

  const done = await db.from("email_sends").update({ status: "sent", sent_at: new Date().toISOString(), gmail_message_id: result.messageId, gmail_thread_id: result.threadId }).eq("id", queued.id);
  if (done.error) {
    await db.from("email_sends").update({ status: "unknown", failure_reason: `sent, but saving failed: ${done.error.message}` }).eq("id", queued.id);
    return { unknown: done.error.message };
  }
  await db.from("email_drafts").update({ status: "sent" }).eq("id", draft.id);
  await db.from("campaign_leads").update({ status: "sent", last_contact_date: new Date().toISOString().slice(0, 10), next_action: null }).eq("id", lead.id);
  await leadEvent(db, lead, "sent", { draft_id: draft.id, send_id: queued.id, gmail_message_id: result.messageId });
  return { sent: true, sendId: queued.id };
}
