/** The quick check as people read it: yes / maybe / no, and the leads a second check can help. */

/** A lead can be checked again when it was skipped as "not a good fit" or because its website could not be read. */
export const RECHECK_REASONS = ["screen-failed", "no-data"] as const;

export const isRecheckable = (l: { status: string; reason_codes?: string[] | null }): boolean => l.status === "disqualified" && (RECHECK_REASONS as readonly string[]).includes(l.reason_codes?.[0] ?? "");

/** How many leads of each campaign a re-check would cover. */
export function recheckCounts(leads: { campaign_id: string; status: string; reason_codes?: string[] | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of leads) if (isRecheckable(l)) out[l.campaign_id] = (out[l.campaign_id] ?? 0) + 1;
  return out;
}

export interface QuickCheckView {
  label: "Yes" | "Maybe" | "No";
  tone: "green" | "amber" | "red";
  businessType: string | null;
  reason: string | null;
}

/** The saved quick check of a lead (score_components.screen), or null when it has none yet. "uncertain" reads as "Maybe": it continues to research. */
export function quickCheckOf(scoreComponents: unknown): QuickCheckView | null {
  const sc = scoreComponents && typeof scoreComponents === "object" ? (scoreComponents as { screen?: { fit?: string; business_type?: string; reason?: string } }).screen : undefined;
  if (!sc?.fit) return null;
  const base = { businessType: sc.business_type || null, reason: sc.reason || null };
  if (sc.fit === "yes") return { label: "Yes", tone: "green", ...base };
  if (sc.fit === "uncertain") return { label: "Maybe", tone: "amber", ...base };
  if (sc.fit === "no") return { label: "No", tone: "red", ...base };
  return null;
}

/** The result of a re-check in plain words. */
export function recheckLine(r: { total?: number; passed?: number; stillNo?: number; stillUnreadable?: number; suppressed?: number; failed?: number; note?: string }): string {
  if (!r.total) return r.note ?? "No lead needed a re-check.";
  const parts = [`${r.passed ?? 0} now fit or may fit and wait for the next run`, `${r.stillNo ?? 0} still do not fit`, `${r.stillUnreadable ?? 0} websites still cannot be read`];
  if (r.suppressed) parts.push(`${r.suppressed} are on your do-not-contact list`);
  if (r.failed) parts.push(`${r.failed} hit an error and keep their earlier reason`);
  return `Checked ${r.total}: ${parts.join(", ")}.`;
}
