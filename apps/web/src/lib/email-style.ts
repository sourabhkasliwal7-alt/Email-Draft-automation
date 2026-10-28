import { normalizeEmailStatus, senderIdentity, toolsFor } from "@outreach/core";

/**
 * Helpers for Setup > Email style: the "Tools by industry" rows, the sample emails, the sender check on a mailbox, and the plain words
 * for an email's status. Pure, so they are tested without a browser.
 */

// ---------------------------------------------------------------- tools by industry
export const DEFAULT_TOOLS_SENTENCE = "We usually build those in React with a Node or Django back end and Postgres.";

export interface ToolRow {
  /** one or more keywords, separated by commas: "health, medical" */
  keywords: string;
  sentence: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** "Health , medical;  health" -> ["health", "medical"] (lower case, no repeats, no colons: a colon would end the keyword in the saved text) */
export const splitKeywords = (s: string): string[] => [...new Set(s.split(/[,;|\n]/).map((k) => oneLine(k.replace(/:/g, " ")).toLowerCase()).filter(Boolean))];

/** The saved table -> editor rows (the fallback is kept apart because it can never be removed). */
export function toolRowsFromConfig(tools: Record<string, string>): { rows: ToolRow[]; fallback: string } {
  const rows = Object.entries(tools)
    .filter(([k]) => k !== "default")
    .map(([k, v]) => ({ keywords: k, sentence: v }));
  return { rows, fallback: tools.default ?? DEFAULT_TOOLS_SENTENCE };
}

/** Editor rows -> the saved text format, one `keywords: sentence` line each, `default: ...` last. Blank rows are dropped. */
export function toolRowsToText(rows: ToolRow[], fallback: string): string {
  const lines = rows
    .map((r) => ({ k: splitKeywords(r.keywords).join(", "), s: oneLine(r.sentence) }))
    .filter((r) => r.k && r.s)
    .map((r) => `${r.k}: ${r.s}`);
  lines.push(`default: ${oneLine(fallback) || DEFAULT_TOOLS_SENTENCE}`);
  return lines.join("\n");
}

/** Plain-words problems with the rows, keyed by row number; a half-filled row would be dropped silently otherwise. */
export function toolRowProblems(rows: ToolRow[]): Record<number, string> {
  const out: Record<number, string> = {};
  rows.forEach((r, i) => {
    const hasK = splitKeywords(r.keywords).length > 0;
    const hasS = oneLine(r.sentence).length > 0;
    if (hasK && !hasS) out[i] = "Add the tools sentence for this industry, or remove the row.";
    else if (!hasK && hasS) out[i] = "Add at least one industry or keyword, or remove the row.";
  });
  return out;
}

/** Which row a lead would use: the row number, or "default". Same rule the writer uses (the most specific keyword in the business type or industry wins). */
export function matchToolRow(businessType: string, industry: string, rows: ToolRow[]): { row: number | "default"; sentence: string | null } {
  const table: Record<string, string> = {};
  rows.forEach((r, i) => {
    const k = splitKeywords(r.keywords).join(", ");
    if (k && oneLine(r.sentence)) table[k] = String(i);
  });
  table.default = "default";
  const hit = toolsFor(businessType, table, industry);
  if (hit === "default" || hit === "") return { row: "default", sentence: null };
  const i = Number(hit);
  return { row: i, sentence: oneLine(rows[i]!.sentence) };
}

// ---------------------------------------------------------------- sample emails
export const MIN_SAMPLES = 3;
export const MAX_SAMPLES = 5;
const SEPARATOR = "\n---\n";

/** The saved text (samples separated by a line with only ---) -> the list. */
export const splitSamples = (text: string): string[] => text.split(/\r?\n-{3,}\r?\n/).map((s) => s.trim()).filter(Boolean);

/** The list -> the saved text. A line made only of dashes inside a sample would split it, so it is removed. */
export const joinSamples = (samples: string[]): string =>
  samples
    .map((s) => s.split(/\r?\n/).filter((line) => !/^\s*-{3,}\s*$/.test(line)).join("\n").trim())
    .filter(Boolean)
    .join(SEPARATOR);

export function sampleCountNote(n: number): string {
  return `${n} of ${MIN_SAMPLES}-${MAX_SAMPLES} recommended`;
}

/** Fewer than 3 is only a warning; more than 5 is refused. */
export function sampleStatus(n: number): { level: "ok" | "warn" | "error"; message: string | null } {
  if (n > MAX_SAMPLES) return { level: "error", message: `Use at most ${MAX_SAMPLES} sample emails. Remove ${n - MAX_SAMPLES}.` };
  if (n < MIN_SAMPLES) return { level: "warn", message: `Three to five good samples work best. You have ${n}.` };
  return { level: "ok", message: null };
}

// ---------------------------------------------------------------- mailbox display name
/** The warning for a mailbox whose display name would make a bad sign-off, or null. */
export function mailboxNameWarning(i: { displayName: string | null | undefined; email: string | null | undefined; company: string }): string | null {
  if (!(i.displayName ?? "").trim()) return "This mailbox has no display name, so emails would be signed with the start of the email address. Use a person's name, for example 'Sam Rivera'.";
  if (senderIdentity({ displayName: i.displayName, email: i.email, company: i.company }).displayNameIsCompany) {
    return "The display name is the company name, so emails would be signed with the company only. Use a person's name, for example 'Sam Rivera'.";
  }
  return null;
}

// ---------------------------------------------------------------- email status in plain words
export type EmailStatusTone = "green" | "amber" | "red" | "neutral";

/** "valid" is shown as Verified only when it really is; catch-all and guessed addresses are Risky, anything unchecked is Not checked. */
export function emailStatusWords(status: string | null | undefined): { label: string; tone: EmailStatusTone } {
  switch (normalizeEmailStatus(status)) {
    case "valid":
      return { label: "Verified", tone: "green" };
    case "risky":
      return { label: "Risky (catch-all or unverified)", tone: "amber" };
    case "invalid":
      return { label: "Invalid", tone: "red" };
    default:
      return { label: "Not checked", tone: "neutral" };
  }
}

// ---------------------------------------------------------------- data problems found on a lead
export const EMAIL_MISMATCH_LABEL = "Email domain mismatch";

/** Data problems saved on a lead (score_components.data_flags), defensively read. */
export function dataFlagsOf(scoreComponents: unknown): string[] {
  const v = (scoreComponents as { data_flags?: unknown } | null)?.data_flags;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export const hasEmailMismatch = (scoreComponents: unknown): boolean => dataFlagsOf(scoreComponents).includes("email domain mismatch");

// ---------------------------------------------------------------- failed drafts
/** The leads "Retry all failed drafts" applies to: skipped with the reason draft-failed (the writing step only). */
export function failedDraftIds(leads: { id: string; status: string; reason_codes: string[] | null }[]): string[] {
  return leads.filter((l) => l.status === "disqualified" && l.reason_codes?.[0] === "draft-failed").map((l) => l.id);
}
