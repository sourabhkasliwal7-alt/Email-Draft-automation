import { z } from "zod";
import type { WorkflowConfig } from "@outreach/core";

/**
 * Setup saves its sections separately. Each section has its own small form schema here and turns into a partial
 * WorkflowConfig that mergeWorkflowConfig() lays over what is already saved, so one section never overwrites another.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const num = (label: string, min: number, max: number) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

/** One entry per line or comma. */
export const lines = (s: string): string[] => [...new Set(s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean))];
/** One entry per line only (entries may contain commas). */
const onlyLines = (s: string): string[] => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

export const footerFormSchema = z.object({
  postal_address: z.string().trim().min(5, "Enter your postal address (it goes in the footer of every email)").max(300),
  optout_line: z.string().trim().min(5, "Enter the opt-out line (for example: Reply STOP and I will not write again)").max(300),
  white_label_line: z.string().trim().min(5, "Enter the white-label line").max(300),
});
export const footerToPatch = (f: z.infer<typeof footerFormSchema>): Partial<WorkflowConfig> => ({ postal_address: f.postal_address, optout_line: f.optout_line, white_label_line: f.white_label_line });

export const scheduleFormSchema = z.object({
  schedule_enabled: z.boolean().default(false),
  run_time_ist: z.string().trim().regex(HHMM, "Use HH:MM, for example 06:30"),
});
export const scheduleToPatch = (f: z.infer<typeof scheduleFormSchema>): Partial<WorkflowConfig> => ({ schedule_enabled: f.schedule_enabled, run_time_ist: f.run_time_ist });

export const modelsFormSchema = z.object({
  model_screen: z.string().trim().min(3, "Enter the quick-check model").max(100),
  model_extract: z.string().trim().min(3, "Enter the facts model").max(100),
  model_write: z.string().trim().min(3, "Enter the writing model").max(100),
});
export const modelsToPatch = (f: z.infer<typeof modelsFormSchema>): Partial<WorkflowConfig> => ({ ...f });

export const creditsFormSchema = z.object({
  daily_reveal_cap: num("Daily credit limit", 0, 100000),
  monthly_credit_cap: num("Monthly credit limit", 0, 1000000),
});
export const creditsToPatch = (f: z.infer<typeof creditsFormSchema>): Partial<WorkflowConfig> => ({ ...f });

export const runRulesFormSchema = z.object({
  approve_threshold: num("Approval cut-off", 0, 100),
  same_company_cooldown_days: num("Same-company days", 0, 365),
  run_limit_minutes: num("Run time limit", 5, 1440),
  dry_run: z.boolean().default(false),
  allow_risky: z.boolean().default(false),
  skip_verification: z.boolean().default(false),
});
export const runRulesToPatch = (f: z.infer<typeof runRulesFormSchema>): Partial<WorkflowConfig> => ({ ...f });

export const writingRulesFormSchema = z.object({
  style_guide: z.string().trim().max(2000).default(""),
  tools_by_industry: z.string().default(""),
  reference_emails: z.string().default(""),
  banned_phrases: z.string().default(""),
  excluded_domains: z.string().default(""),
  excluded_titles: z.string().default(""),
  countries_in_scope: z.string().default(""),
  holidays: z.string().default(""),
});

/** "keyword: sentence" per line; a line starting with default: is the fallback. */
export function parseTools(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(i + 1).trim()) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  if (!out.default) out.default = "We usually build those in React with a Node or Django back end and Postgres.";
  return out;
}

export const writingRulesToPatch = (f: z.infer<typeof writingRulesFormSchema>, existing: WorkflowConfig): Partial<WorkflowConfig> => ({
  style_guide: f.style_guide || existing.style_guide,
  tools_by_industry: parseTools(f.tools_by_industry),
  reference_emails: f.reference_emails.split(/\r?\n-{3,}\r?\n/).map((s) => s.trim()).filter(Boolean),
  banned_phrases: lines(f.banned_phrases),
  excluded_domains: lines(f.excluded_domains).map((d) => d.toLowerCase()),
  excluded_titles: lines(f.excluded_titles),
  countries_in_scope: lines(f.countries_in_scope),
  holidays: onlyLines(f.holidays),
});

/** The reverse, for filling the form. */
export function writingRulesToForm(c: WorkflowConfig): Record<string, string> {
  return {
    style_guide: c.style_guide,
    tools_by_industry: Object.entries(c.tools_by_industry).map(([k, v]) => `${k}: ${v}`).join("\n"),
    reference_emails: c.reference_emails.join("\n---\n"),
    banned_phrases: c.banned_phrases.join("\n"),
    excluded_domains: c.excluded_domains.join("\n"),
    excluded_titles: c.excluded_titles.join("\n"),
    countries_in_scope: c.countries_in_scope.join("\n"),
    holidays: c.holidays.join("\n"),
  };
}
