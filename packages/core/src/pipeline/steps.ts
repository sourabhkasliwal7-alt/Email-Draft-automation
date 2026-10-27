/** The eight steps every lead goes through, in order. Rows in job_steps use these names. */
export const PIPELINE_STEPS = ["suppressionCheck", "qualify", "research", "score", "enrich", "draft", "qualityCheck", "awaitReview"] as const;
export type StepName = (typeof PIPELINE_STEPS)[number];

/** Lead status written when a step starts or finishes (see the step handlers). */
export const STEP_LEAD_STATUS = {
  researchStart: "researching",
  researchDone: "researched",
  scoreDone: "scored",
  draftStart: "drafting",
  qualityCheckDone: "draft_ready",
  awaitReviewDone: "needs_review",
} as const;

export const HALT_REASONS = ["suppressed", "dnc", "invalid_email", "not_qualified", "low_score", "needs_review_band", "missing_data"] as const;
export type HaltReason = (typeof HALT_REASONS)[number];

export const HALT_LABELS: Record<HaltReason, string> = {
  suppressed: "Suppressed",
  dnc: "Do not contact",
  invalid_email: "Invalid email",
  not_qualified: "Not qualified",
  low_score: "Score too low",
  needs_review_band: "Manual review (score band)",
  missing_data: "Missing data",
};

export function isStepName(v: string): v is StepName {
  return (PIPELINE_STEPS as readonly string[]).includes(v);
}
