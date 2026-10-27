import type { JobInfo, WorkerCtx } from "../ctx";
import { leadEvent, loadLead, must } from "../pipeline/common";
import { suppressionHalt } from "./lead";

export interface GmailDraftPayload {
  draftId: string;
}

/** Start of today in Asia/Kolkata, as an ISO instant (daily caps reset at IST midnight). */
export function istDayStart(now = new Date()): string {
  const istMs = now.getTime() + 330 * 60_000;
  const dayStartIst = Math.floor(istMs / 86_400_000) * 86_400_000;
  return new Date(dayStartIst - 330 * 60_000).toISOString();
}

/**
 * Runs after a reviewer approves a draft FOR GMAIL. Creates the Gmail draft (never sends anything) exactly once:
 * a draft that already has a gmail_draft_id is left alone, so a double click or a retry cannot create two.
 */
export async function gmailDraftJob(ctx: WorkerCtx, payload: GmailDraftPayload, _job: JobInfo) {
  const { db } = ctx;
  const draft = must(await db.from("email_drafts").select("*").eq("id", payload.draftId).single(), "load draft");
  if (draft.gmail_draft_id) return { skipped: "already_created" };
  if (draft.status !== "approved") return { skipped: `draft is ${draft.status}` };
  const lead = await loadLead(db, draft.campaign_lead_id);
  const contact = lead.contacts!;

  const halt = await suppressionHalt(ctx, lead);
  if (halt || !contact.email) {
    await db.from("email_drafts").update({ status: "rejected", warnings: [...draft.warnings, halt ? `blocked: ${halt}` : "blocked: no email"] }).eq("id", draft.id);
    await leadEvent(db, lead, "gmail_draft_blocked", { reason: halt ?? "no_email" });
    return { blocked: halt ?? "no_email" };
  }
  const inboxId = draft.inbox_id ?? lead.campaigns?.inbox_id;
  if (!inboxId) {
    await db.from("email_drafts").update({ status: "needs_review", warnings: [...draft.warnings, "choose an inbox on the campaign first"] }).eq("id", draft.id);
    return { blocked: "no_inbox" };
  }
  const inbox = must(await db.from("inboxes").select("daily_draft_cap").eq("id", inboxId).single(), "load inbox");
  const { count } = await db.from("email_drafts").select("id", { count: "exact", head: true }).eq("inbox_id", inboxId).not("gmail_draft_id", "is", null).gte("updated_at", istDayStart());
  if ((count ?? 0) >= inbox.daily_draft_cap) {
    await db.from("email_drafts").update({ status: "needs_review", warnings: [...draft.warnings, `inbox draft cap (${inbox.daily_draft_cap}/day) reached`] }).eq("id", draft.id);
    return { blocked: "inbox_draft_cap" };
  }

  const res = await ctx.adapters.gmail.createDraft({ inboxId, to: contact.email, subject: draft.subject, bodyText: draft.body_text });
  must(await db.from("email_drafts").update({ gmail_draft_id: res.draftId, gmail_message_id_header: res.messageIdHeader, inbox_id: inboxId }).eq("id", draft.id).is("gmail_draft_id", null), "save gmail draft id");
  must(await db.from("campaign_leads").update({ status: "approved", next_action: "Approve sending" }).eq("id", lead.id), "status approved");
  await leadEvent(db, lead, "gmail_draft_created", { draft_id: draft.id, gmail_draft_id: res.draftId, version: draft.version });
  return { created: res.draftId };
}
