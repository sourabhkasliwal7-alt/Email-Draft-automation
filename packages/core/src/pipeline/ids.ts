/** Deterministic idempotency keys: the same logical unit of work always maps to the same key. */
export const pipelineJobKey = (batchId: string, campaignLeadId: string) => `pipeline:${batchId}:${campaignLeadId}`;
export const fanoutJobKey = (batchId: string) => `fanout:${batchId}`;
export const usageKey = (jobId: string, step: string, provider: string, operation: string, seq: number) =>
  `usage:${jobId}:${step}:${provider}:${operation}:${seq}`;
export const researchRunKey = (jobId: string) => `research:${jobId}`;
export const draftKey = (campaignLeadId: string, step = 0, version = 1) => `draft:${campaignLeadId}:${step}:${version}`;
