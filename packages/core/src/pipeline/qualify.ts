import type { Icp } from "../schemas";

/**
 * v0 qualification: deterministic ICP rules, no model call.
 * // replaced by Phase 5 (qualification and scoring)
 */
export interface QualifyInput {
  industry?: string | null;
  country?: string | null;
  employeeCount?: number | null;
  jobTitle?: string | null;
  companyName?: string | null;
  summary?: string | null;
  targetRoles?: string[] | null;
}

export interface QualifyResult {
  pass: boolean;
  reasonCodes: string[];
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const matchesAny = (value: string, needles: string[]) => needles.some((n) => norm(n) && (value.includes(norm(n)) || norm(n).includes(value)));

export function qualifyV0(icp: Partial<Icp> | null | undefined, input: QualifyInput): QualifyResult {
  const i = icp ?? {};
  const reasons: string[] = [];
  let pass = true;
  const fail = (code: string) => {
    pass = false;
    reasons.push(code);
  };

  const industry = norm(input.industry);
  const country = norm(input.country);
  const title = norm(input.jobTitle);

  // Excluded industries beat included ones.
  if (industry && matchesAny(industry, i.excludeIndustries ?? [])) fail("industry_excluded");
  else if ((i.industries ?? []).length) {
    if (!industry) reasons.push("industry_unknown");
    else if (matchesAny(industry, i.industries ?? [])) reasons.push("industry_match");
    else fail("industry_mismatch");
  }

  if ((i.countries ?? []).length) {
    if (!country) reasons.push("country_unknown");
    else if ((i.countries ?? []).some((c) => norm(c) === country)) reasons.push("country_match");
    else fail("country_mismatch");
  }

  const hasRange = i.employeeMin != null || i.employeeMax != null;
  if (hasRange) {
    const n = input.employeeCount;
    if (n == null) reasons.push("employee_unknown");
    else if ((i.employeeMin != null && n < i.employeeMin) || (i.employeeMax != null && n > i.employeeMax)) fail("employee_out_of_range");
    else reasons.push("employee_in_range");
  }

  const roles = (input.targetRoles ?? []).filter((r) => norm(r));
  if (roles.length) {
    if (!title) reasons.push("title_unknown");
    else if (roles.some((r) => title.includes(norm(r)))) reasons.push("role_match");
    else fail("role_mismatch");
  }

  const haystack = [input.industry, input.jobTitle, input.companyName, input.summary].map(norm).join(" ");
  if ((i.keywordsExclude ?? []).some((k) => norm(k) && haystack.includes(norm(k)))) fail("keyword_excluded");
  else if ((i.keywordsInclude ?? []).some((k) => norm(k) && haystack.includes(norm(k)))) reasons.push("keyword_match");

  return { pass, reasonCodes: reasons };
}
