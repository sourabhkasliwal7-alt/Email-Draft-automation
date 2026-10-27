import { describe, expect, it } from "vitest";
import { mergeWorkflowConfig, parseWorkflowConfig } from "@outreach/core";
import {
  creditsFormSchema,
  creditsToPatch,
  footerFormSchema,
  footerToPatch,
  lines,
  modelsFormSchema,
  parseTools,
  runRulesFormSchema,
  runRulesToPatch,
  scheduleFormSchema,
  scheduleToPatch,
  writingRulesFormSchema,
  writingRulesToForm,
  writingRulesToPatch,
} from "../src/app/(app)/setup/schemas";

const base = () => parseWorkflowConfig({ postal_address: "1 Main St, Pune", optout_line: "Reply STOP.", white_label_line: "White-label work for agencies." });

describe("Setup sections save only their own keys", () => {
  it("the footer changes the footer and nothing else", () => {
    const f = footerFormSchema.parse({ postal_address: "9 New Road, Delhi 110001", optout_line: "Reply STOP and I stop.", white_label_line: "We do white-label work." });
    const next = mergeWorkflowConfig(base(), footerToPatch(f));
    expect(next.postal_address).toBe("9 New Road, Delhi 110001");
    expect(next.model_write).toBe(base().model_write);
    expect(next.daily_reveal_cap).toBe(base().daily_reveal_cap);
    expect(next.skip_verification).toBe(false);
  });

  it("the footer needs a real address and opt-out line", () => {
    const r = footerFormSchema.safeParse({ postal_address: "", optout_line: "x", white_label_line: "We do white-label work." });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message).join(" | ");
      expect(msgs).toContain("postal address");
      expect(msgs).toContain("opt-out line");
    }
  });

  it("the schedule checks the time and turns the schedule on and off", () => {
    expect(scheduleFormSchema.safeParse({ schedule_enabled: true, run_time_ist: "25:99" }).success).toBe(false);
    const f = scheduleFormSchema.parse({ schedule_enabled: true, run_time_ist: "07:15" });
    expect(mergeWorkflowConfig(base(), scheduleToPatch(f))).toMatchObject({ schedule_enabled: true, run_time_ist: "07:15", postal_address: "1 Main St, Pune" });
    expect(scheduleFormSchema.parse({ run_time_ist: "06:30" }).schedule_enabled).toBe(false);
  });

  it("credit limits are whole non-negative numbers", () => {
    expect(creditsFormSchema.safeParse({ daily_reveal_cap: "-3", monthly_credit_cap: "10" }).success).toBe(false);
    expect(creditsFormSchema.safeParse({ daily_reveal_cap: "1.5", monthly_credit_cap: "10" }).success).toBe(false);
    const f = creditsFormSchema.parse({ daily_reveal_cap: "3", monthly_credit_cap: "60" });
    expect(mergeWorkflowConfig(base(), creditsToPatch(f))).toMatchObject({ daily_reveal_cap: 3, monthly_credit_cap: 60 });
  });

  it("models cannot be empty", () => {
    expect(modelsFormSchema.safeParse({ model_screen: "claude-haiku-5-5", model_extract: "claude-haiku-5-5", model_write: "" }).success).toBe(false);
  });

  it("skip email verification and always-test are OFF unless ticked, and ticking one does not change the other settings", () => {
    const off = runRulesFormSchema.parse({ approve_threshold: "55", same_company_cooldown_days: "30", run_limit_minutes: "120" });
    expect(off).toMatchObject({ skip_verification: false, dry_run: false, allow_risky: false });
    const on = runRulesFormSchema.parse({ approve_threshold: "60", same_company_cooldown_days: "30", run_limit_minutes: "120", skip_verification: true });
    const next = mergeWorkflowConfig(base(), runRulesToPatch(on));
    expect(next).toMatchObject({ skip_verification: true, approve_threshold: 60, dry_run: false, white_label_line: "White-label work for agencies." });
    expect(runRulesFormSchema.safeParse({ approve_threshold: "101", same_company_cooldown_days: "30", run_limit_minutes: "120" }).success).toBe(false);
    expect(runRulesFormSchema.safeParse({ approve_threshold: "55", same_company_cooldown_days: "30", run_limit_minutes: "2" }).success).toBe(false);
  });

  it("writing rules round-trip through the form text", () => {
    const cfg = mergeWorkflowConfig(base(), { tools_by_industry: { saas: "We build in React.", default: "We build in Node." }, banned_phrases: ["synergy", "leverage"], reference_emails: ["Hi A", "Hi B"], excluded_domains: ["bad.com"] });
    const form = writingRulesToForm(cfg);
    const back = mergeWorkflowConfig(cfg, writingRulesToPatch(writingRulesFormSchema.parse(form), cfg));
    expect(back.tools_by_industry).toEqual(cfg.tools_by_industry);
    expect(back.banned_phrases).toEqual(["synergy", "leverage"]);
    expect(back.reference_emails).toEqual(["Hi A", "Hi B"]);
    expect(back.excluded_domains).toEqual(["bad.com"]);
  });

  it("helpers: one entry per line or comma, default tools sentence is always present", () => {
    expect(lines("a, b\nb\n\n c ")).toEqual(["a", "b", "c"]);
    expect(parseTools("saas: React\n").default).toContain("React or Django".slice(0, 5) ? "We usually build" : "");
    expect(parseTools("default: Custom")).toEqual({ default: "Custom" });
  });
});
