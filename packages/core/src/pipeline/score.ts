/**
 * v0 scoring: deterministic, explainable, 0-100. // replaced by Phase 5 (qualification and scoring)
 * Components: icp_fit <= 30, trigger <= 25, role_fit <= 20, offer_fit <= 15, data_confidence <= 10.
 */
export interface ScoreInput {
  /** reason codes returned by qualifyV0 */
  qualifyReasons: string[];
  evidenceCount: number;
  jobTitle?: string | null;
  hasTargetRoles: boolean;
  hasOffer: boolean;
  emailStatus?: string | null;
  hasEmail: boolean;
  employeeKnown: boolean;
  industryKnown: boolean;
}

export interface ScoreResult {
  score: number;
  components: { icp_fit: number; trigger: number; role_fit: number; offer_fit: number; data_confidence: number };
  reasonCodes: string[];
}

export function scoreV0(input: ScoreInput): ScoreResult {
  const reasons: string[] = [];
  let icp = 30;
  for (const code of ["employee_unknown", "industry_unknown", "country_unknown"]) {
    if (input.qualifyReasons.includes(code)) {
      icp -= 8;
      reasons.push(code);
    }
  }
  icp = Math.max(0, icp);

  const trigger = Math.min(25, Math.max(0, input.evidenceCount) * 8);
  reasons.push(input.evidenceCount > 0 ? `evidence_${Math.min(input.evidenceCount, 3)}` : "no_evidence");

  let role = 10;
  if (input.hasTargetRoles) {
    if (input.qualifyReasons.includes("role_match")) {
      role = 20;
      reasons.push("role_match");
    } else if (input.qualifyReasons.includes("title_unknown") || !input.jobTitle) {
      role = 5;
      reasons.push("title_unknown");
    } else role = 0;
  }

  const offer = input.hasOffer ? 15 : 5;

  let data = 0;
  if (input.hasEmail) data += input.emailStatus === "valid" ? 6 : input.emailStatus === "risky" || input.emailStatus === "catch_all" ? 3 : 2;
  if (input.employeeKnown) data += 2;
  if (input.industryKnown) data += 2;
  data = Math.min(10, data);
  if (!input.employeeKnown) reasons.push("low_data_confidence");

  const components = { icp_fit: icp, trigger, role_fit: role, offer_fit: offer, data_confidence: data };
  const score = Math.max(0, Math.min(100, icp + trigger + role + offer + data));
  return { score, components, reasonCodes: [...new Set(reasons)] };
}

export type Band = "draft" | "review" | "skip";

/** >= draftMin drafts; >= reviewMin goes to a human first; below that is skipped. */
export function decideBand(score: number, draftMin: number, reviewMin: number): Band {
  if (score >= draftMin) return "draft";
  if (score >= reviewMin) return "review";
  return "skip";
}
