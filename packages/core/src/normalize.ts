/** Lowercase + trim an email for uniqueness checks. Returns null for empty / syntactically invalid input. */
export function normalizeEmail(input: string | null | undefined): string | null {
  const v = input?.trim().toLowerCase();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** Reduce a URL or host to a bare lowercase domain (no scheme, www., port, path). */
export function normalizeDomain(input: string | null | undefined): string | null {
  let v = input?.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#]/)[0]!.split(":")[0]!;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null;
}

export function emailDomain(email: string): string | null {
  const n = normalizeEmail(email);
  return n ? n.split("@")[1]! : null;
}

/**
 * True when an email address does not belong to the company website it is listed with: the two domains are different (a sub-domain either
 * way is fine). A personal address such as gmail.com is a mismatch too. Data problem, not a block: the lead is flagged "email domain mismatch".
 */
export function emailDomainMismatch(email: string | null | undefined, companyDomain: string | null | undefined): boolean {
  const e = email ? emailDomain(email) : null;
  const c = normalizeDomain(companyDomain);
  if (!e || !c) return false;
  return !(e === c || e.endsWith(`.${c}`) || c.endsWith(`.${e}`));
}

/** The note shown in the import preview, on the lead and in the run report. */
export const EMAIL_DOMAIN_MISMATCH = "email domain mismatch";

/**
 * One status vocabulary for an email: "valid" only when a source or the verifier checked it. A catch-all or guessed address is "risky"
 * (a catch-all domain accepts any address, so nothing proves this one exists); anything unchecked stays "unknown".
 */
export function normalizeEmailStatus(status: string | null | undefined): "unknown" | "valid" | "risky" | "invalid" {
  const v = (status ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (v === "valid" || v === "verified" || v === "deliverable") return "valid";
  if (v === "invalid" || v === "bounced" || v === "undeliverable") return "invalid";
  if (v === "risky" || v === "catch all" || v === "catchall" || v === "accept all" || v === "guessed" || v === "unverified") return "risky";
  return "unknown";
}
