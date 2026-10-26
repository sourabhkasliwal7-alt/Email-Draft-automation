import type { CampaignRules, NormalizedRow } from "./normalize";
import { validateRow } from "./normalize";

export type ImportMode = "add_new" | "update_existing" | "skip_duplicates";
export type RowStatus = "invalid" | "duplicate" | "suppressed" | "skipped" | "imported" | "updated";

/** Accent- and case-insensitive text for name matching. */
export function foldName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface DedupeKeys {
  email: string | null;
  profile: string | null;
  /** company domain + folded full name */
  nameCompany: string | null;
}

export function dedupeKeys(n: NormalizedRow): DedupeKeys {
  return {
    email: n.email_lower,
    profile: n.profile_url,
    nameCompany: n.company_domain && n.full_name ? `${n.company_domain}|${foldName(n.full_name)}` : null,
  };
}

export type MatchedBy = "email" | "profile_url" | "company_and_name";

/** In-memory index used both for the rows already seen in this file and for contacts already in the database. */
export class KeyIndex<T = true> {
  private email = new Map<string, T>();
  private profile = new Map<string, T>();
  private nameCompany = new Map<string, T>();

  add(keys: DedupeKeys, value: T): void {
    if (keys.email) this.email.set(keys.email, value);
    if (keys.profile) this.profile.set(keys.profile, value);
    if (keys.nameCompany) this.nameCompany.set(keys.nameCompany, value);
  }

  /** Order of precedence: email, then profile URL, then company domain + full name. */
  find(keys: DedupeKeys): { by: MatchedBy; value: T } | null {
    if (keys.email && this.email.has(keys.email)) return { by: "email", value: this.email.get(keys.email)! };
    if (keys.profile && this.profile.has(keys.profile)) return { by: "profile_url", value: this.profile.get(keys.profile)! };
    if (keys.nameCompany && this.nameCompany.has(keys.nameCompany)) return { by: "company_and_name", value: this.nameCompany.get(keys.nameCompany)! };
    return null;
  }
}

export interface ExistingContact {
  id: string;
  dnc: boolean;
  inCampaign: boolean;
}

/** Do-not-contact data already resolved for ONE campaign (global rows + that campaign's rows). */
export interface SuppressionIndex {
  emails: Set<string>;
  domains: Set<string>;
}

export function suppressionReason(n: NormalizedRow, s: SuppressionIndex): string | null {
  if (n.email_lower && s.emails.has(n.email_lower)) return `${n.email_lower} is on the suppression list.`;
  const domain = n.email_lower ? n.email_lower.split("@")[1]! : n.company_domain;
  if (domain && s.domains.has(domain)) return `Domain ${domain} is on the suppression list.`;
  if (n.company_domain && s.domains.has(n.company_domain)) return `Domain ${n.company_domain} is on the suppression list.`;
  return null;
}

export interface PlanContext {
  mode: ImportMode;
  rules: CampaignRules;
  suppression: SuppressionIndex;
  /** rows accepted earlier in this file (updated by classifyRow) */
  seen: KeyIndex<number>;
  /** contacts that already exist in the database, looked up by the caller for this chunk */
  existing: KeyIndex<ExistingContact>;
}

export interface RowOutcome {
  status: RowStatus;
  /** human-readable reason shown in the summary and the error CSV */
  messages: string[];
  matchedBy?: MatchedBy;
  existing?: ExistingContact;
  /** true when a contact row must be created */
  createContact?: boolean;
  /** row number (index into the file) of the earlier row this duplicates */
  duplicateOf?: number;
}

/**
 * Decides what happens to one row. Order matters: validation, then do-not-contact (checked here at import, as
 * required), then duplicates inside the file, then contacts that already exist, then the chosen mode.
 */
export function classifyRow(n: NormalizedRow, rowNumber: number, ctx: PlanContext): RowOutcome {
  const errors = validateRow(n, ctx.rules);
  if (errors.length) return { status: "invalid", messages: errors };

  const keys = dedupeKeys(n);
  const existing = ctx.existing.find(keys);

  const sup = suppressionReason(n, ctx.suppression);
  if (sup) return { status: "suppressed", messages: [sup] };
  if (existing?.value.dnc) return { status: "suppressed", messages: ["This contact is marked do-not-contact."], matchedBy: existing.by, existing: existing.value };

  const inFile = ctx.seen.find(keys);
  if (inFile) {
    return { status: "duplicate", messages: [`Duplicate of row ${inFile.value} in this file (same ${inFile.by.replace(/_/g, " ")}).`], matchedBy: inFile.by, duplicateOf: inFile.value };
  }

  if (!existing) {
    ctx.seen.add(keys, rowNumber);
    return { status: "imported", messages: [], createContact: true };
  }

  const ex = existing.value;
  if (ex.inCampaign && ctx.mode !== "update_existing") {
    return { status: "duplicate", messages: ["Already in this campaign."], matchedBy: existing.by, existing: ex };
  }
  if (ctx.mode === "skip_duplicates") {
    return { status: "skipped", messages: ["Contact already exists; skipped because the mode is skip duplicates."], matchedBy: existing.by, existing: ex };
  }
  ctx.seen.add(keys, rowNumber);
  if (ctx.mode === "update_existing") {
    return { status: "updated", messages: [], matchedBy: existing.by, existing: ex };
  }
  return { status: "imported", messages: ["Existing contact added to this campaign."], matchedBy: existing.by, existing: ex };
}

export interface ImportTotals {
  total: number;
  imported: number;
  updated: number;
  duplicate: number;
  invalid: number;
  suppressed: number;
  skipped: number;
  failed: number;
  blank: number;
}

export const emptyTotals = (): ImportTotals => ({ total: 0, imported: 0, updated: 0, duplicate: 0, invalid: 0, suppressed: 0, skipped: 0, failed: 0, blank: 0 });
