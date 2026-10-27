import { ATTENTION_REASONS, type SkipReason } from "@outreach/core";

/**
 * Plain-language wording for the main screens. Internal words (adapter, ledger, reveal, stage A/B ...) belong only in Setup > Advanced.
 */

/** Why a lead was skipped or needs a person, in words anyone understands. */
export const PLAIN_REASON: Record<SkipReason, string> = {
  "screen-failed": "Does not look like a good fit for your offer",
  "no-data": "We could not read their website",
  "no-verified-fact": "We found nothing about them that we could check word for word",
  "below-threshold": "Score too low to write to",
  "over-quota": "A good lead, but today's limit was already used",
  "no-email": "No email address. Add one in your file, or find leads with Apollo",
  "bad-email": "The email address did not pass the check",
  "role-address": "A shared address (info@, sales@ ...), not a person",
  suppressed: "On your do-not-contact list",
  duplicate: "Already in your list",
  "same-company": "We already wrote to this company recently",
  "draft-failed": "The email did not pass the quality checks, even after one rewrite",
  "extraction-suspect": "The research looked unreliable, so it was not used",
  "credit-cap": "Your Apollo credit limit was reached",
  "credit-uncertain": "An Apollo credit may have been used but the answer was lost. Check Apollo before trying again",
  "consent-risk": "Contacting this country needs extra care",
  manual: "Skipped by a person",
  excluded: "Excluded by your rules (company, job title or country)",
  "gmail-failed": "The draft could not be saved in Gmail. Check the mailbox in Setup",
  "dry-run": "Test run: nothing was done",
  "step-failed": "Something went wrong on one step. Retry tries it again",
};

export const plainReason = (code: string | undefined): string => (code ? (PLAIN_REASON[code as SkipReason] ?? code) : "");
export const isAttentionReason = (code: string | undefined): boolean => ATTENTION_REASONS.includes(code as SkipReason);

const STEP_WORDS: Record<string, string> = {
  write: "Writing the email",
  reveal: "Getting and checking the email address",
  "quick check": "The quick check",
  research: "The research",
};

/** The worker writes its notes with its own words; on the main screens they read as plain ones. */
function soften(text: string): string {
  return text
    .replace(/\brevealed\b/gi, "unlocked")
    .replace(/\brevealing\b/gi, "unlocking")
    .replace(/\breveal\b/gi, "unlock")
    .replace(/\bledger\b/gi, "credit record");
}

/** The saved detail ("write: OpenRouter says ...") with the step named in plain words. */
export function plainDetail(code: string | undefined, detail: string | undefined): string {
  if (!detail) return "";
  if (code === "step-failed") {
    const i = detail.indexOf(":");
    const step = i > 0 ? detail.slice(0, i).trim() : "";
    if (STEP_WORDS[step]) return `${STEP_WORDS[step]}: ${soften(detail.slice(i + 1).trim())}`;
  }
  return soften(detail);
}

/** One line for a lead's place in the process. */
export function plainLeadStatus(l: { status: string; next_action?: string | null; reason_codes?: string[] | null }): { label: string; tone: "green" | "amber" | "red" | "neutral" } {
  const code = l.reason_codes?.[0];
  if (code && isAttentionReason(code)) return { label: `Needs attention: ${plainReason(code)}`, tone: "red" };
  switch (l.status) {
    case "imported":
      return { label: "Found", tone: "neutral" };
    case "researching":
      return { label: "Checked", tone: "neutral" };
    case "researched":
    case "scored":
      return { label: "Researched", tone: "neutral" };
    case "approved":
      return { label: l.next_action === "deliver" ? "Approved, saving the draft" : "Approved, preparing the email", tone: "amber" };
    case "draft_ready":
      return { label: "Draft ready", tone: "green" };
    case "disqualified":
      return { label: `Skipped: ${plainReason(code)}`, tone: "neutral" };
    case "sent":
    case "replied":
    case "bounced":
    case "nurture":
    case "closed":
      return { label: "Done", tone: "green" };
    default:
      return { label: l.status, tone: "neutral" };
  }
}

/** The step name in a run log, in plain words (the log itself stays in the run details). */
export const PLAIN_STEP: Record<string, string> = {
  target: "working out today's number",
  search: "finding people",
  clean: "removing people we should not write to",
  "quick check": "the quick check",
  "research and score": "research and scoring",
  approve: "choosing the best leads",
  "approve (dry run)": "choosing the best leads (test)",
  "reveal and verify": "getting and checking email addresses",
  errors: "finishing up",
  done: "finishing up",
  stopped: "stopped",
  settings: "checking your settings",
};
export const plainStep = (step: string | undefined): string => (step ? (PLAIN_STEP[step] ?? step) : "starting");

/** Why a run is paused, in plain words. */
export const PLAIN_PAUSE: Record<string, string> = {
  time_limit: "it reached the time limit. Press Resume to continue (finished steps are not repeated)",
  cap: "a spending limit was reached",
  missing_price: "a price is missing in Setup > Advanced",
  manual: "it stopped: open the details to see why",
  campaign_paused: "the campaign was paused",
  worker_stopping: "the background worker was stopped",
};

// ---------------------------------------------------------------- Gmail links
/** The Drafts folder of a mailbox. */
export const gmailDraftsUrl = (email: string): string => `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#drafts`;

/** One draft: Gmail opens it by its message id; without one the Drafts folder is the best we can do. */
export const gmailDraftUrl = (email: string, messageId: string | null | undefined): string =>
  messageId ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#drafts?compose=${encodeURIComponent(messageId)}` : gmailDraftsUrl(email);
