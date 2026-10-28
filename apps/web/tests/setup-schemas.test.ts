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
  styleFormSchema,
  styleToForm,
  styleToPatch,
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

  it("filtering rules round-trip through the form text and leave the email style alone", () => {
    const cfg = mergeWorkflowConfig(base(), { tools_by_industry: { saas: "We build in React.", default: "We build in Node." }, banned_phrases: ["synergy", "leverage"], reference_emails: ["Hi A", "Hi B"], excluded_domains: ["bad.com"], excluded_titles: ["intern"] });
    const form = writingRulesToForm(cfg);
    expect(Object.keys(form).sort()).toEqual(["countries_in_scope", "excluded_domains", "excluded_titles", "holidays"]);
    const back = mergeWorkflowConfig(cfg, writingRulesToPatch(writingRulesFormSchema.parse(form)));
    expect(back.excluded_domains).toEqual(["bad.com"]);
    expect(back.excluded_titles).toEqual(["intern"]);
    // the email style (tools, samples, banned phrases) is saved on its own tab and is not reset by this form
    expect(back.tools_by_industry).toEqual(cfg.tools_by_industry);
    expect(back.banned_phrases).toEqual(["synergy", "leverage"]);
    expect(back.reference_emails).toEqual(["Hi A", "Hi B"]);
  });

  it("email style round-trips through the form text, and saves only its own keys", () => {
    const cfg = mergeWorkflowConfig(base(), { tools_by_industry: { "health, medical": "FHIR.", default: "We build in Node." }, banned_phrases: ["synergy"], reference_emails: ["Hi A,\n\nOne.", "Hi B,\n\nTwo."], sender_company: "Acme Dev", excluded_domains: ["bad.com"] });
    const form = styleToForm(cfg);
    expect(form.reference_emails).toBe("Hi A,\n\nOne.\n---\nHi B,\n\nTwo.");
    expect(form.tools_by_industry).toContain("health, medical: FHIR.");
    const back = mergeWorkflowConfig(cfg, styleToPatch(styleFormSchema.parse(form), cfg));
    expect(back).toEqual(cfg);
    const edited = mergeWorkflowConfig(cfg, styleToPatch(styleFormSchema.parse({ ...form, sender_company: "New Co", banned_phrases: "a\nb", tools_by_industry: "saas: React." }), cfg));
    expect(edited).toMatchObject({ sender_company: "New Co", banned_phrases: ["a", "b"], excluded_domains: ["bad.com"], postal_address: "1 Main St, Pune" });
    expect(edited.tools_by_industry).toEqual({ saas: "React.", default: "We usually build those in React with a Node or Django back end and Postgres." }); // the default row always exists
  });

  it("email style needs a company, and refuses more than five samples", () => {
    const ok = { style_guide: "", sender_company: "Acme Dev", tools_by_industry: "", reference_emails: "", banned_phrases: "" };
    expect(styleFormSchema.safeParse({ ...ok, sender_company: "" }).success).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => `Sample ${i}`).join("\n---\n");
    const r = styleFormSchema.safeParse({ ...ok, reference_emails: six });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(/at most 5 sample emails \(you have 6\)/);
    expect(styleFormSchema.safeParse({ ...ok, reference_emails: "one\n---\ntwo" }).success).toBe(true); // fewer than three is only a warning in the form
  });

  it("helpers: one entry per line or comma, default tools sentence is always present", () => {
    expect(lines("a, b\nb\n\n c ")).toEqual(["a", "b", "c"]);
    expect(parseTools("saas: React\n").default).toContain("React or Django".slice(0, 5) ? "We usually build" : "");
    expect(parseTools("default: Custom")).toEqual({ default: "Custom" });
  });
});
