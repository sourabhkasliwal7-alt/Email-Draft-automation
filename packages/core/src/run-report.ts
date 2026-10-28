import { toCsv } from "./csv";
import { leadSourceLabel } from "./discovery";
import { SKIP_LABELS } from "./workflow";

/**
 * The run report: one row per lead of a run, skipped leads included. Pure functions; the web app loads the data (with the signed-in
 * person's permissions) and hands it over as `RunReportLead`.
 */

/** The step of a run where a lead stopped, from its skip reason (and the detail the step wrote). */
export function stepOfReason(reason: string | null | undefined, detail?: string | null): string {
  switch (reason) {
    case "screen-failed":
      return "quick check";
    case "no-data":
      return /homepage|company website/i.test(detail ?? "") ? "quick check" : "research";
    case "no-verified-fact":
    case "extraction-suspect":
      return "research";
    case "below-threshold":
    case "over-quota":
      return "approve";
    case "suppressed":
    case "excluded":
    case "same-company":
    case "no-email":
    case "no-contact":
      return "clean";
    case "bad-email":
    case "role-address":
    case "credit-cap":
    case "credit-uncertain":
    case "consent-risk":
      return "reveal and verify";
    case "draft-failed":
    case "gmail-failed":
      return "write";
    case "step-failed":
      return /^([a-z ]+):/i.exec(detail ?? "")?.[1]?.toLowerCase() ?? "";
    default:
      return "";
  }
}

export interface RunReportLead {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  emailStatus: string | null;
  profileUrl: string | null;

  companyName: string | null;
  domain: string | null;
  country: string | null;
  employeeCount: number | null;
  industry: string | null;
  /** from the quick check */
  businessType: string | null;

  /** campaign_leads.lead_source and source_detail */
  leadSource: string | null;
  sourceDetail: string | null;

  quickCheck: { fit: string; reason: string } | null;

  pagesVisited: string[];
  hiringRoles: string[];
  facts: { statement: string; url: string }[];
  /** how many facts the model gave and how many survived the exact-quote check; null when research did not run */
  factsGiven: number | null;
  factsKept: number | null;

  trigger: string | null;
  triggerDate: string | null;
  triggerUrl: string | null;

  score: number | null;
  components: { fit?: number; trigger?: number; role?: number; size?: number; data?: number } | null;
  cutoff: number | null;

  /** campaign_leads.status, reason_codes (first = reason, second = detail) */
  status: string;
  reasonCodes: string[];
  /** a test run leaves approved-to-be leads as "scored" */
  wouldApprove: boolean;

  offerName: string | null;
  caseStudy: string | null;

  draft: { subject: string; body: string; attempts: number | null } | null;
  gmailLink: string | null;
  mailbox: string | null;

  costUsd: number | null;
}

export const RUN_REPORT_COLUMNS = [
  "First name", "Last name", "Job title", "Email", "Email status", "Profile URL",
  "Company", "Website", "Country", "Employees", "Industry", "Business type",
  "Source", "Search query",
  "Quick check", "Quick check reason",
  "Pages visited", "Hiring roles found", "Verified facts", "Facts passed quote check", "Facts failed quote check",
  "Trigger", "Trigger date", "Trigger source",
  "Score", "Score: fit", "Score: trigger", "Score: role", "Score: size", "Score: data quality", "Cut-off", "Decision",
  "Skip reason", "Stopped at step",
  "Offer", "Case study",
  "Email subject", "Email body", "Email quality",
  "Gmail draft link", "Mailbox",
  "Cost (USD)",
] as const;
export type RunReportColumn = (typeof RUN_REPORT_COLUMNS)[number];

const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function decisionOf(l: Pick<RunReportLead, "status" | "wouldApprove">): string {
  if (l.status === "approved" || l.status === "draft_ready") return "approved";
  if (l.status === "disqualified") return "skipped";
  if (l.wouldApprove) return "would be approved (test run)";
  return "not decided yet";
}

/** "passed first time", "passed after a rewrite", or "failed: the rules that failed". Empty when no email was written. */
export function emailQualityOf(l: Pick<RunReportLead, "draft" | "reasonCodes">): string {
  if (l.draft) return l.draft.attempts != null && l.draft.attempts > 1 ? "passed after a rewrite" : "passed first time";
  if (l.reasonCodes[0] === "draft-failed") return `failed: ${text(l.reasonCodes[1])}`;
  return "";
}

export function reportRow(l: RunReportLead): Record<RunReportColumn, string> {
  const reason = l.status === "disqualified" ? (l.reasonCodes[0] ?? "") : "";
  const detail = l.reasonCodes[1] ?? "";
  const skipText = reason ? `${(SKIP_LABELS as Record<string, string>)[reason] ?? reason}${detail ? ` (${detail})` : ""}` : "";
  const c = l.components;
  return {
    "First name": text(l.firstName),
    "Last name": text(l.lastName),
    "Job title": text(l.jobTitle),
    "Email": text(l.email),
    "Email status": text(l.emailStatus),
    "Profile URL": text(l.profileUrl),
    "Company": text(l.companyName),
    "Website": text(l.domain),
    "Country": text(l.country),
    "Employees": text(l.employeeCount),
    "Industry": text(l.industry),
    "Business type": text(l.businessType),
    "Source": leadSourceLabel(l.leadSource),
    "Search query": l.leadSource === "web_discovery" ? text(l.sourceDetail) : "",
    "Quick check": text(l.quickCheck?.fit),
    "Quick check reason": text(l.quickCheck?.reason),
    "Pages visited": l.pagesVisited.join(" | "),
    "Hiring roles found": l.hiringRoles.join(" | "),
    "Verified facts": l.facts.map((f) => `${f.statement} [${f.url}]`).join(" | "),
    "Facts passed quote check": text(l.factsKept),
    "Facts failed quote check": l.factsGiven != null && l.factsKept != null ? String(Math.max(0, l.factsGiven - l.factsKept)) : "",
    "Trigger": text(l.trigger),
    "Trigger date": text(l.triggerDate),
    "Trigger source": text(l.triggerUrl),
    "Score": text(l.score),
    "Score: fit": text(c?.fit),
    "Score: trigger": text(c?.trigger),
    "Score: role": text(c?.role),
    "Score: size": text(c?.size),
    "Score: data quality": text(c?.data),
    "Cut-off": text(l.cutoff),
    "Decision": decisionOf(l),
    "Skip reason": skipText,
    "Stopped at step": reason ? stepOfReason(reason, detail) : "",
    "Offer": text(l.offerName),
    "Case study": text(l.caseStudy),
    "Email subject": text(l.draft?.subject),
    "Email body": text(l.draft?.body),
    "Email quality": emailQualityOf(l),
    "Gmail draft link": text(l.gmailLink),
    "Mailbox": text(l.mailbox),
    "Cost (USD)": l.costUsd == null ? "" : l.costUsd.toFixed(4),
  };
}

/** The CSV file: UTF-8 with a byte order mark (so Excel opens accents correctly), formula-injection protection, multi-line cells quoted. */
/** byte order mark: tells Excel the file is UTF-8 */
const BOM = String.fromCharCode(0xfeff);

export function runReportCsv(leads: RunReportLead[]): string {
  return `${BOM}${toCsv(leads.map(reportRow), [...RUN_REPORT_COLUMNS])}\r\n`;
}

export const runReportFileName = (runId: string, date = new Date()) => `run-report-${date.toISOString().slice(0, 10)}-${runId.slice(0, 8)}.csv`;
