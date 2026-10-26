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
