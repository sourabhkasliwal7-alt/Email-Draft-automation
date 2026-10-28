import { EMAIL_DOMAIN_MISMATCH, emailDomainMismatch, normalizeDomain, normalizeEmail } from "@outreach/core";
import type { CanonicalField, Mapping } from "./mapping";

export type EmailStatus = "unknown" | "valid" | "risky" | "invalid" | "catch_all";

export interface NormalizedRow {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  /** as typed (trimmed); kept for display. Uniqueness uses email_lower. */
  email: string | null;
  email_lower: string | null;
  profile_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  country: string | null;
  industry: string | null;
  employee_count: number | null;
  email_status: EmailStatus;
  lead_source: string | null;
  /** problems found while parsing a value (the value itself was dropped or repaired) */
  warnings: string[];
  /** email was present in the file but is not a valid address */
  emailInvalid: boolean;
  /** data problems found in the row, saved on the lead and shown in the run report (for example "email domain mismatch") */
  data_flags: string[];
}

/** Addresses that must never be treated as a company's domain. */
const NON_COMPANY_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com", "rediffmail.com",
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "crunchbase.com", "google.com", "github.com",
]);

export function isNonCompanyDomain(domain: string): boolean {
  return NON_COMPANY_DOMAINS.has(domain);
}

const ch = String.fromCharCode;
/** zero-width space/joiners (U+200B..U+200D) and the BOM (U+FEFF) */
const INVISIBLE = new RegExp(`[${ch(0x200b)}-${ch(0x200d)}${ch(0xfeff)}]`, "g");
/** any whitespace run, including the non-breaking space (U+00A0) */
const SPACES = new RegExp(`[\\s${ch(0xa0)}]+`, "g");

/** Trim, NFC-normalise, drop zero-width characters and collapse any run of whitespace (incl. NBSP) to one space. */
export function collapse(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(SPACES, " ")
    .trim();
}

const orNull = (s: string) => (s === "" ? null : s);

export function normalizeProfileUrl(input: string): string | null {
  let v = collapse(input);
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

export function parseEmailStatus(input: string): EmailStatus {
  const v = collapse(input).toLowerCase().replace(/[\s_-]+/g, " ");
  if (!v) return "unknown";
  if (["verified", "valid", "deliverable", "ok", "good"].includes(v)) return "valid";
  // a catch-all domain accepts any address, so nothing proves this one exists: it is "risky", never "valid"
  if (["catch all", "catchall", "accept all", "accept_all"].includes(v)) return "risky";
  if (["guessed", "risky", "unknown", "likely to engage", "unverified"].includes(v)) return v === "unknown" ? "unknown" : "risky";
  if (["invalid", "bounced", "undeliverable", "bad", "hard bounce"].includes(v)) return "invalid";
  return "unknown";
}

/** "1,200" -> 1200, "1.2k" -> 1200, "50+" -> 50, "11-50" / "abc" -> null (with a warning). */
export function parseEmployeeCount(input: string): { value: number | null; warning?: string } {
  const v = collapse(input).toLowerCase().replace(/,/g, "");
  if (!v) return { value: null };
  if (/^\d+(\.\d+)?k$/.test(v)) return { value: Math.round(parseFloat(v) * 1000) };
  if (/^\d+(\.\d+)?\+?$/.test(v)) return { value: Math.round(parseFloat(v)) };
  return { value: null, warning: `Employee count "${input.trim()}" is not a single number and was ignored.` };
}

function splitName(full: string): { first: string | null; last: string | null } {
  // "Doe, Jane" -> Jane Doe
  const comma = /^([^,]+),\s*([^,]+)$/.exec(full);
  if (comma && !/\d/.test(full)) return { first: orNull(collapse(comma[2])), last: orNull(collapse(comma[1])) };
  const parts = full.split(" ");
  if (parts.length === 1) return { first: parts[0] ?? null, last: null };
  return { first: parts[0] ?? null, last: parts.slice(1).join(" ") };
}

/** One raw row (header -> text) + mapping -> a clean row. Never throws; problems become warnings. */
export function normalizeRow(raw: Record<string, string>, mapping: Mapping, defaults: { leadSource?: string } = {}): NormalizedRow {
  const get = (f: CanonicalField): string => {
    const header = mapping.fields[f];
    return header ? (raw[header] ?? "") : "";
  };
  const warnings: string[] = [];

  // email
  let emailRaw = collapse(get("email"));
  let emailInvalid = false;
  const angle = /<([^>]+)>/.exec(emailRaw);
  if (angle) emailRaw = angle[1]!;
  emailRaw = emailRaw.replace(/^mailto:/i, "");
  const multi = emailRaw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (multi.length > 1) {
    warnings.push(`Several emails in one cell; the first (${multi[0]}) was used.`);
    emailRaw = multi[0]!;
  }
  if (/\s/.test(emailRaw)) {
    emailRaw = emailRaw.replace(/\s+/g, "");
    warnings.push("Spaces were removed from the email address.");
  }
  const emailLower = normalizeEmail(emailRaw);
  if (emailRaw && !emailLower) emailInvalid = true;

  // names
  let first = orNull(collapse(get("first_name")));
  let last = orNull(collapse(get("last_name")));
  let full = orNull(collapse(get("full_name")));
  if (full && !first && !last) {
    const s = splitName(full);
    first = s.first;
    last = s.last;
    if (/^[^,]+,\s*[^,]+$/.test(full) && !/\d/.test(full)) full = [first, last].filter(Boolean).join(" ");
  }
  if (!full && (first || last)) full = [first, last].filter(Boolean).join(" ");

  // company
  const companyName = orNull(collapse(get("company_name")));
  let domain: string | null = null;
  const domainRaw = collapse(get("company_domain"));
  if (domainRaw) {
    domain = normalizeDomain(domainRaw);
    if (!domain) warnings.push(`Website "${domainRaw}" is not a usable domain and was ignored.`);
    else if (isNonCompanyDomain(domain)) {
      warnings.push(`"${domain}" is not a company website and was ignored.`);
      domain = null;
    }
  }
  // a work address that belongs to a different website than the one the company is listed with is a data problem (the lead is flagged, not dropped)
  const dataFlags: string[] = [];
  if (domain && emailLower && emailDomainMismatch(emailLower, domain)) {
    dataFlags.push(EMAIL_DOMAIN_MISMATCH);
    warnings.push(`Email domain mismatch: ${emailLower.split("@")[1]} is not the company website ${domain}.`);
  }
  if (!domain && emailLower) {
    const d = emailLower.split("@")[1]!;
    if (!isNonCompanyDomain(d)) domain = d;
  }

  // profile url
  const profileRaw = collapse(get("profile_url"));
  const profileUrl = profileRaw ? normalizeProfileUrl(profileRaw) : null;
  if (profileRaw && !profileUrl) warnings.push(`Profile URL "${profileRaw}" is not a valid URL and was ignored.`);

  // employees
  const emp = parseEmployeeCount(get("employee_count"));
  if (emp.warning) warnings.push(emp.warning);

  return {
    first_name: first,
    last_name: last,
    full_name: full,
    job_title: orNull(collapse(get("job_title"))),
    email: emailRaw || null,
    email_lower: emailLower,
    profile_url: profileUrl,
    company_name: companyName,
    company_domain: domain,
    country: orNull(collapse(get("country"))),
    industry: orNull(collapse(get("industry"))),
    employee_count: emp.value,
    email_status: parseEmailStatus(get("email_status")),
    lead_source: orNull(collapse(get("lead_source"))) ?? defaults.leadSource ?? null,
    warnings,
    emailInvalid,
    data_flags: dataFlags,
  };
}

export interface CampaignRules {
  /** false = research-first campaign: rows without an email are allowed */
  requireEmail: boolean;
}

/** Row-level validation against the campaign. Returns messages; empty = valid. */
export function validateRow(n: NormalizedRow, rules: CampaignRules): string[] {
  const errors: string[] = [];
  if (n.emailInvalid) errors.push(`"${n.email}" is not a valid email address.`);
  if (!n.email_lower && !n.emailInvalid) {
    if (rules.requireEmail) errors.push("Email is required for this campaign (turn on research-first to allow rows without one).");
    else if (!n.profile_url && !(n.full_name && (n.company_name || n.company_domain))) {
      errors.push("Without an email the row needs a profile URL, or a name plus a company.");
    }
  }
  if (!n.first_name && !n.full_name) errors.push("Name is missing.");
  if (n.email_status === "invalid") errors.push("The source marks this email as invalid or bounced.");
  return errors;
}
