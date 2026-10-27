/** What a run is expected to use, worked out on the server from the campaign and from what earlier runs cost. */
export interface RunEstimate {
  /** drafts the campaign may write today */
  drafts: number;
  /** email credits at most (0 when every lead already has an email) */
  credits: number;
  /** average cost of one draft in earlier real runs, in US dollars; null before the first real run */
  usdPerDraft: number | null;
  /** the campaign has a Gmail mailbox chosen */
  hasMailbox: boolean;
  /** how many people Apollo is searched for (0 for CSV-only campaigns) */
  apolloPeople: number;
}

const usd = (n: number) => (n < 0.01 ? "less than $0.01" : `$${n.toFixed(2)}`);

/** The one-line, honest estimate shown on the card and in the confirmation. */
export function describeEstimate(e: RunEstimate | undefined, test: boolean): string {
  if (!e) return "";
  if (test) return "Practice run: nothing is written and no email credits are used.";
  const parts = [`up to ${e.drafts} Gmail drafts today`, e.credits > 0 ? `about ${e.credits} email credits at most (one per approved lead)` : "no email credits (your CSV leads already have emails)"];
  parts.push(e.usdPerDraft != null ? `about ${usd(e.usdPerDraft * e.drafts)} for research and writing` : "the cost shows once you have done a first run");
  return `Estimate: ${parts.join(" · ")}.`;
}
