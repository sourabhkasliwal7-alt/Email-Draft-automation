import { z } from "zod";
import { normalizeDomain, normalizeEmail } from "./normalize";

/** Comma / newline separated text -> trimmed, de-duplicated list. */
export function splitList(input: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (input ?? "").split(/[\n,;]/)) {
    const v = part.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/** Newline separated text (items may contain commas) -> trimmed, de-duplicated list. */
export function splitLines(input: string | null | undefined): string[] {
  return [...new Set((input ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

const percent = (label: string) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(0, `${label} must be 0-100`).max(100, `${label} must be 0-100`);

const count = (label: string, max = 100000) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(0, `${label} cannot be negative`).max(max, `${label} is too large`);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const sendWindowSchema = z
  .object({
    tz: z.string().min(1).default("Asia/Kolkata"),
    days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one send day"),
    start: z.string().regex(HHMM, "Start must be HH:MM"),
    end: z.string().regex(HHMM, "End must be HH:MM"),
  })
  .refine((w) => w.start < w.end, { message: "Send window must end after it starts", path: ["end"] });

export const icpSchema = z.object({
  industries: z.array(z.string()).default([]),
  excludeIndustries: z.array(z.string()).default([]),
  countries: z.array(z.string()).default([]),
  employeeMin: z.number().int().min(0).nullable().default(null),
  employeeMax: z.number().int().min(0).nullable().default(null),
  keywordsInclude: z.array(z.string()).default([]),
  keywordsExclude: z.array(z.string()).default([]),
  requireEmail: z.boolean().default(true),
});
export type Icp = z.infer<typeof icpSchema>;

export const campaignSchema = z
  .object({
    name: requiredText("Campaign name", 120),
    industries: z.string().default(""),
    excludeIndustries: z.string().default(""),
    countries: z.string().default(""),
    employeeMin: z.string().default(""),
    employeeMax: z.string().default(""),
    keywordsInclude: z.string().default(""),
    keywordsExclude: z.string().default(""),
    researchFirst: z.coerce.boolean().default(false),
    targetRoles: z.string().default(""),
    regions: z.string().default(""),
    scoreDraftMin: percent("Draft threshold"),
    scoreReviewMin: percent("Review threshold"),
    dailyCap: count("Daily cap", 10000),
    offerId: z.string().uuid("Choose an offer").or(z.literal("")).default(""),
    tone: optionalText,
    cta: optionalText,
    inboxId: z.string().uuid().or(z.literal("")).default(""),
    researchDepth: z.enum(["light", "standard", "deep"]),
    sendDays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one send day"),
    sendStart: z.string().regex(HHMM, "Start must be HH:MM"),
    sendEnd: z.string().regex(HHMM, "End must be HH:MM"),
    status: z.enum(["draft", "active", "paused", "completed", "archived"]).default("draft"),
  })
  .superRefine((v, ctx) => {
    if (v.scoreReviewMin > v.scoreDraftMin)
      ctx.addIssue({ code: "custom", path: ["scoreReviewMin"], message: "Review threshold cannot be higher than the draft threshold" });
    if (v.sendStart >= v.sendEnd) ctx.addIssue({ code: "custom", path: ["sendEnd"], message: "Send window must end after it starts" });
    const min = v.employeeMin.trim() === "" ? null : Number(v.employeeMin);
    const max = v.employeeMax.trim() === "" ? null : Number(v.employeeMax);
    if (min !== null && (!Number.isInteger(min) || min < 0)) ctx.addIssue({ code: "custom", path: ["employeeMin"], message: "Minimum employees must be a whole number" });
    if (max !== null && (!Number.isInteger(max) || max < 0)) ctx.addIssue({ code: "custom", path: ["employeeMax"], message: "Maximum employees must be a whole number" });
    if (min !== null && max !== null && min > max) ctx.addIssue({ code: "custom", path: ["employeeMax"], message: "Maximum employees must be at least the minimum" });
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

/** Form values -> database columns. */
export function campaignToRow(v: CampaignInput) {
  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
  const icp: Icp = {
    industries: splitList(v.industries),
    excludeIndustries: splitList(v.excludeIndustries),
    countries: splitList(v.countries),
    employeeMin: toNum(v.employeeMin),
    employeeMax: toNum(v.employeeMax),
    keywordsInclude: splitList(v.keywordsInclude),
    keywordsExclude: splitList(v.keywordsExclude),
    requireEmail: !v.researchFirst,
  };
  return {
    name: v.name,
    icp,
    target_roles: splitList(v.targetRoles),
    regions: splitList(v.regions),
    score_draft_min: v.scoreDraftMin,
    score_review_min: v.scoreReviewMin,
    daily_cap: v.dailyCap,
    offer_id: v.offerId || null,
    tone: v.tone,
    cta: v.cta,
    inbox_id: v.inboxId || null,
    research_depth: v.researchDepth,
    send_window: { tz: "Asia/Kolkata", days: [...v.sendDays].sort(), start: v.sendStart, end: v.sendEnd },
    status: v.status,
  };
}

export const offerSchema = z.object({
  name: requiredText("Offer name", 160),
  description: optionalText,
  allowedClaims: z.string().default(""),
  ctaOptions: z.string().default(""),
});

export const caseStudySchema = z.object({
  offerId: z.string().uuid().or(z.literal("")).default(""),
  title: requiredText("Title", 160),
  summary: optionalText,
  industries: z.string().default(""),
  /** one "name = number" per line; only these numbers may be quoted in drafts */
  allowedNumbers: z.string().default(""),
});

/** "hours_saved = 12" lines -> {hours_saved: 12}. Returns an error message for the first bad line. */
export function parseAllowedNumbers(input: string): { value: Record<string, number>; error?: string } {
  const value: Record<string, number> = {};
  for (const [i, raw] of input.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_ .%-]+?)\s*[=:]\s*(-?\d+(?:\.\d+)?)$/.exec(line);
    if (!m) return { value, error: `Line ${i + 1}: use "name = number" (got "${line}")` };
    value[m[1]!.trim()] = Number(m[2]);
  }
  return { value };
}

export const suppressionSchema = z
  .object({
    kind: z.enum(["email", "domain"]),
    value: requiredText("Value", 320),
    scope: z.enum(["global", "campaign"]),
    campaignId: z.string().uuid().or(z.literal("")).default(""),
    reason: requiredText("Reason", 300),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "email" && !normalizeEmail(v.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid email address" });
    if (v.kind === "domain" && !normalizeDomain(v.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a valid domain, e.g. example.com" });
    if (v.scope === "campaign" && !v.campaignId) ctx.addIssue({ code: "custom", path: ["campaignId"], message: "Choose a campaign for a campaign-scoped entry" });
  });

export function suppressionToRow(v: z.infer<typeof suppressionSchema>, source = "manual") {
  return {
    email_lower: v.kind === "email" ? normalizeEmail(v.value) : null,
    domain: v.kind === "domain" ? normalizeDomain(v.value) : null,
    scope: v.scope,
    campaign_id: v.scope === "campaign" ? v.campaignId : null,
    reason: v.reason,
    source,
  };
}

export const priceSchema = z.object({
  provider: requiredText("Provider", 60),
  unit: requiredText("Unit", 60),
  usdPerUnit: z.coerce.number({ error: "Price must be a number" }).min(0, "Price cannot be negative").max(1_000_000),
});

export const spendCapSchema = z
  .object({
    scope: z.enum(["global", "campaign", "provider"]),
    period: z.enum(["daily", "monthly", "total"]),
    capUsd: z.coerce.number({ error: "Cap must be a number" }).min(0, "Cap cannot be negative").max(1_000_000),
    provider: z.string().trim().default(""),
    campaignId: z.string().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "provider" && !v.provider) ctx.addIssue({ code: "custom", path: ["provider"], message: "Provider is required for a provider cap" });
    if (v.scope === "campaign" && !z.string().uuid().safeParse(v.campaignId).success)
      ctx.addIssue({ code: "custom", path: ["campaignId"], message: "Choose a campaign" });
  });

export const MODEL_TASKS = ["extraction", "claim_check", "drafting"] as const;
export const settingsSchema = z.object({
  modelExtraction: requiredText("Extraction model", 100),
  modelClaimCheck: requiredText("Claim-check model", 100),
  modelDrafting: requiredText("Drafting model", 100),
  researchDepth: z.enum(["light", "standard", "deep"]),
  crunchbaseEnabled: z.coerce.boolean().default(false),
  replyTrackingEnabled: z.coerce.boolean().default(false),
  sendingEnabled: z.coerce.boolean().default(false),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

/** Defaults applied when a setting has never been saved. SENDING_ENABLED is OFF until an admin turns it on. */
export const DEFAULT_SETTINGS: SettingsInput = {
  modelExtraction: "claude-haiku-5-5",
  modelClaimCheck: "claude-haiku-5-5",
  modelDrafting: "claude-sonnet-5-5",
  researchDepth: "standard",
  crunchbaseEnabled: false,
  replyTrackingEnabled: false,
  sendingEnabled: false,
};

export const inboxLimitsSchema = z.object({
  displayName: optionalText,
  status: z.enum(["disconnected", "active", "paused", "error"]),
  dailyDraftCap: count("Daily draft cap", 10000),
  dailySendCap: count("Daily send cap", 10000),
  minSecondsBetweenSends: count("Delay between sends", 86400),
});
