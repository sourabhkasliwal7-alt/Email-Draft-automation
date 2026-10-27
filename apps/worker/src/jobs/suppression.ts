import type { HaltReason } from "@outreach/core";
import type { WorkerCtx } from "../ctx";
import type { LeadBundle } from "../pipeline/common";
import { loadSuppression } from "./import";

/** Do-not-contact check: at import, before research, before reveal, before drafting and right before every send. */
export async function suppressionHalt(ctx: WorkerCtx, lead: LeadBundle): Promise<HaltReason | null> {
  const c = lead.contacts!;
  if (c.dnc) return "dnc";
  if (c.email_status === "invalid") return "invalid_email";
  const sup = await loadSuppression(ctx.db, lead.campaign_id);
  const emailDomain = c.email_lower?.split("@")[1];
  if ((c.email_lower && sup.emails.has(c.email_lower)) || (emailDomain && sup.domains.has(emailDomain)) || (c.companies?.domain && sup.domains.has(c.companies.domain))) return "suppressed";
  return null;
}
