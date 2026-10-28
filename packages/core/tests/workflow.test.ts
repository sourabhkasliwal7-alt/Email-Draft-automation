import { describe, expect, it } from "vitest";
import {
  senderIdentity,
  subjectHasOfferName,
  toolsFor,
  approveTop,
  canTransition,
  checkEmailCode,
  checkFacts,
  dailyTarget,
  emailCheckPasses,
  keepDate,
  leadsToFind,
  buildWritePrompt,
  explainFlag,
  mergeWorkflowConfig,
  parseWorkflowConfig,
  retryPatch,
  workflowConfigToForm,
  workflowFormSchema,
  workflowFormToConfig,
  revealDecision,
  scoreLead,
  shouldStartScheduledRun,
  validateWorkflowConfig,
  withFooter,
  type RawFact,
} from "../src";

const page = { url: "https://acme.example.com/careers", text: "Careers at Acme. We are hiring a Senior Python Developer to join our Pune team. Posted 12 October 2026." };
const fact = (over: Partial<RawFact> = {}): RawFact => ({ type: "hiring", statement: "Acme is hiring a Senior Python Developer", source_url: page.url, quote: "We are hiring a Senior Python Developer", date: null, ...over });

describe("facts: exact quote check (SRS 7.4 / E2 / E3)", () => {
  it("keeps a quote that is on the named page, word for word after tidying", () => {
    const r = checkFacts([fact({ quote: "we are  hiring a senior python developer" })], [page]);
    expect(r.kept).toHaveLength(1);
    expect(r.skipLead).toBe(false);
  });
  it("rejects a close but not exact quote, an unknown page, a long quote and anything with a link", () => {
    const r = checkFacts(
      [fact({ quote: "We are hiring a senior Python engineer" }), fact({ source_url: "https://other.example.com/" }), fact({ quote: Array.from({ length: 30 }, () => "word").join(" ") }), fact({ statement: "Visit https://evil.example.com now" })],
      [page],
    );
    expect(r.kept).toHaveLength(0);
    expect(r.failed.map((f) => f.reason)).toEqual(["quote_not_found", "source_not_given", "quote_too_long", "suspicious"]);
  });
  it("the limit is strictly more than 40%", () => {
    const good = fact();
    const bad = fact({ quote: "invented quote that is not there" });
    expect(checkFacts([good, good, good, bad, bad], [page]).failRate).toBeCloseTo(0.4);
    expect(checkFacts([good, good, good, bad, bad], [page]).skipLead).toBe(false);
    expect(checkFacts([good, good, bad, bad], [page]).skipLead).toBe(true);
    expect(checkFacts([], [page]).skipLead).toBe(true);
  });
  it("keeps a date only when it appears near the quote on the page", () => {
    expect(keepDate("2026-10-12", "We are hiring a Senior Python Developer", page.text)).toBe("2026-10-12");
    expect(keepDate("2025-01-05", "We are hiring a Senior Python Developer", page.text)).toBeNull();
  });
});

describe("score in code (E4) and the top-N approval (E5)", () => {
  const w = parseWorkflowConfig({}).rubric_weights;
  const base = { fit: "yes" as const, title: "CTO", targetRoles: [], employeeCount: 60, trigger: { type: "hiring-developers" as const, date: null }, hasDomain: true, hasCountry: true, hasProfileUrl: true, pagesRead: 3 };
  it("a strong lead scores high, a weak one low, and the score is bounded", () => {
    const strong = scoreLead(base, w).score;
    const weak = scoreLead({ ...base, fit: "uncertain", title: null, employeeCount: 5000, trigger: null, hasCountry: false, hasProfileUrl: false, pagesRead: 0 }, w).score;
    expect(strong).toBeGreaterThanOrEqual(85);
    expect(weak).toBeLessThan(40);
    expect(strong).toBeLessThanOrEqual(100);
  });
  it("a newer trigger scores at least as high as an old one", () => {
    const now = new Date("2026-10-27");
    const recent = scoreLead({ ...base, trigger: { type: "funding", date: "2026-10-01" } }, w, now).score;
    const old = scoreLead({ ...base, trigger: { type: "funding", date: "2026-01-01" } }, w, now).score;
    expect(recent).toBeGreaterThan(old);
  });
  it("approves the best leads at or above the cut-off, up to today's number", () => {
    const r = approveTop([{ id: "a", score: 90 }, { id: "b", score: 70 }, { id: "c", score: 54 }, { id: "d", score: 80 }, { id: "e", score: 55 }], 55, 3);
    expect(r.approved.map((x) => x.id)).toEqual(["a", "d", "b"]);
    expect(r.overQuota.map((x) => x.id)).toEqual(["e"]);
    expect(r.below.map((x) => x.id)).toEqual(["c"]);
  });
});

describe("daily number, search size and schedule (A1, A4, B1)", () => {
  it("the target is the mailbox limit, never more than the monthly credits left", () => {
    expect(dailyTarget([{ id: "m1", dailyLimit: 25 }], 2000).total).toBe(25);
    expect(dailyTarget([{ id: "m1", dailyLimit: 25 }], 10).total).toBe(10);
    expect(dailyTarget([{ id: "m1", dailyLimit: 25 }, { id: "m2", dailyLimit: 25 }], 30).total).toBe(30);
    expect(dailyTarget([{ id: "m1", dailyLimit: 25 }], 0).total).toBe(0);
  });
  it("searches for about 1.33 times the target", () => {
    expect(leadsToFind(40, 0.75)).toBe(54);
    expect(leadsToFind(6, 0.75)).toBe(8);
  });
  it("starts on weekdays at 06:30 IST, once a day, and skips holidays", () => {
    const cfg = parseWorkflowConfig({ schedule_enabled: true, run_time_ist: "06:30", holidays: ["2026-10-27"] });
    expect(shouldStartScheduledRun(new Date("2026-10-26T01:00:00Z"), cfg, false)).toBe(true); // Monday 06:30 IST
    expect(shouldStartScheduledRun(new Date("2026-10-26T00:59:00Z"), cfg, false)).toBe(false); // 06:29 IST
    expect(shouldStartScheduledRun(new Date("2026-10-26T01:00:00Z"), cfg, true)).toBe(false); // already ran today
    expect(shouldStartScheduledRun(new Date("2026-10-27T02:00:00Z"), cfg, false)).toBe(false); // holiday
    expect(shouldStartScheduledRun(new Date("2026-10-31T02:00:00Z"), cfg, false)).toBe(false); // Saturday
    expect(shouldStartScheduledRun(new Date("2026-11-01T02:00:00Z"), cfg, false)).toBe(false); // Sunday
    expect(shouldStartScheduledRun(new Date("2026-10-26T02:00:00Z"), { ...cfg, schedule_enabled: false }, false)).toBe(false);
  });
  it("blocks draft creation without a postal address and opt-out line", () => {
    expect(validateWorkflowConfig(parseWorkflowConfig({}), { forDraftCreation: true }).length).toBe(2);
    expect(validateWorkflowConfig(parseWorkflowConfig({ postal_address: "x", optout_line: "y" }), { forDraftCreation: true })).toEqual([]);
  });
  it("lead status only moves along the allowed path", () => {
    expect(canTransition("imported", "researching")).toBe(true);
    expect(canTransition("scored", "sent")).toBe(false);
    expect(canTransition("draft_ready", "sent")).toBe(true);
  });
});

describe("credit guard decision (SRS 4.3)", () => {
  const ok = { approved: true, alreadyRevealed: false, suppressed: false, creditsToday: 0, creditsThisMonth: 0, dailyCap: 70, monthlyCap: 2000, dryRun: false };
  it("allows one reveal for an approved lead under the caps", () => expect(revealDecision(ok)).toEqual({ allow: true }));
  it("refuses unapproved, repeat, suppressed, dry-run and over-cap reveals", () => {
    expect(revealDecision({ ...ok, approved: false })).toMatchObject({ allow: false, reason: "not_approved" });
    expect(revealDecision({ ...ok, alreadyRevealed: true })).toMatchObject({ allow: false, reason: "already_revealed" });
    expect(revealDecision({ ...ok, suppressed: true })).toMatchObject({ allow: false, reason: "suppressed" });
    expect(revealDecision({ ...ok, dryRun: true })).toMatchObject({ allow: false, reason: "dry_run" });
    expect(revealDecision({ ...ok, creditsToday: 70 })).toMatchObject({ allow: false, reason: "daily_cap" });
    expect(revealDecision({ ...ok, creditsThisMonth: 2000 })).toMatchObject({ allow: false, reason: "monthly_cap" });
    expect(revealDecision({ ...ok, creditsToday: 69, creditsThisMonth: 1999 })).toEqual({ allow: true });
  });
});

describe("email rules (SRS section 8: W1-W9, C4)", () => {
  const cfg = parseWorkflowConfig({});
  const facts = [{ id: "f1", type: "hiring", statement: "Acme is hiring a Senior Python Developer", quote: "We are hiring a Senior Python Developer", sourceUrl: "https://acme.example.com/careers" }];
  const good = [
    "Hi Asha,",
    "",
    'I read this on your careers page: "We are hiring a Senior Python Developer".',
    "",
    "How do you handle development work today when your own team is already at capacity?",
    "",
    "We work with small software teams that want extra delivery capacity without adding permanent headcount.",
    "We usually build those in React with a Node or Django back end and Postgres.",
    cfg.white_label_line,
    "",
    "Happy to share a short example if it is useful, just reply.",
    "",
    "Sam Rivera",
    "Nuance Infotech",
  ].join("\n");
  const ctx = { facts, firstName: "Asha", company: "Acme", caseStudyNumbers: [], whiteLabelLine: cfg.white_label_line, bannedPhrases: cfg.banned_phrases, offerName: "White-label web and app development for agencies", senderName: "Sam Rivera", senderCompany: "Nuance Infotech" };
  const write = (body: string, subject = "idea for Acme") => ({ subject, body, fact_ids_used: ["f1"] });

  it("a correct email passes every code check", () => expect(checkEmailCode(write(good), ctx)).toEqual([]));
  it("flags exclamation marks, links, banned phrases, invented numbers, a missing white-label line, two questions and a wrong greeting", () => {
    expect(checkEmailCode(write(good.replace("just reply.", "just reply!")), ctx).join()).toContain("W4: exclamation");
    expect(checkEmailCode(write(good.replace("Sam", "see https://x.example.com")), ctx).join()).toContain("W4: link");
    expect(checkEmailCode(write(good.replace("Happy to share", "Just following up. Happy to share")), ctx).join()).toContain("W3: banned phrase");
    expect(checkEmailCode(write(good.replace("our own team", "our own team of 45 people")), ctx).join()).toContain("W6: number 45");
    expect(checkEmailCode(write(good.replace(cfg.white_label_line, "We can help.")), ctx).join()).toContain("W7: white-label");
    expect(checkEmailCode(write(good.replace("at capacity?", "at capacity? And why?")), ctx).join()).toContain("W2: 2 question marks");
    expect(checkEmailCode(write(good.replace("Hi Asha", "Hi Ben")), ctx).join()).toContain("greeting");
    expect(checkEmailCode({ ...write(good), fact_ids_used: [] }, ctx).join()).toContain("W2: exactly one");
  });
  it("the subject never carries the internal offer name, or two words in a row from it", () => {
    for (const subject of ["web and app development for agencies", "for agencies", "white-label help for Acme", "app development at Acme"]) {
      expect(checkEmailCode(write(good, subject), ctx).join(), subject).toContain("W5: subject contains the internal offer name");
    }
    for (const subject of ["idea for Acme", "your careers page", "a python hire at Acme"]) expect(checkEmailCode(write(good, subject), ctx), subject).toEqual([]);
    expect(subjectHasOfferName("anything", null)).toBe(false);
  });
  it("the soft ask is reply-only: it must say reply, and never asks the lead to send, share, attach or fill in anything", () => {
    expect(checkEmailCode(write(good.replace("Happy to share a short example if it is useful, just reply.", "Happy to share a short example if it is useful.")), ctx).join()).toContain("W7: the soft ask must be reply-only");
    for (const ask of ["Please send me your requirements and I will reply.", "Could you forward your roadmap, just reply with it.", "Happy to talk, just share your brief.", "Fill in the form and I will reply."]) {
      expect(checkEmailCode(write(good.replace("Happy to share a short example if it is useful, just reply.", ask)), ctx).join(), ask).toContain("W7: asks the lead to send");
    }
    expect(checkEmailCode(write(good.replace("Happy to share a short example if it is useful, just reply.", "Happy to send a short example if it is useful, just reply.")), ctx)).toEqual([]); // WE send the example
  });
  it("the sign-off is the sender's name and the company once", () => {
    expect(checkEmailCode(write(good.replace("Sam Rivera\nNuance Infotech", "Nuance Infotech\nNuance Infotech")), ctx).join()).toContain("W9: the company name is written twice");
    expect(checkEmailCode(write(good.replace("Sam Rivera\nNuance Infotech", "Nuance Infotech, Nuance Infotech")), ctx).join()).toContain("W9: the company name is written twice");
    expect(checkEmailCode(write(good.replace("Sam Rivera\nNuance Infotech", "Best regards\nNuance Infotech")), ctx).join()).toContain("W9: the sign-off does not use the sender's name");
    // no person known (the display name was the company): only the company, once
    expect(checkEmailCode(write(good.replace("Sam Rivera\nNuance Infotech", "Nuance Infotech")), { ...ctx, senderName: "" })).toEqual([]);
  });
  it("finds who the sender is: a person's display name, never the company twice", () => {
    expect(senderIdentity({ displayName: "Sam Rivera", email: "sam@x.com", company: "Nuance Infotech" })).toMatchObject({ name: "Sam Rivera", firstName: "Sam", displayNameIsCompany: false });
    expect(senderIdentity({ displayName: "Nuance Infotech", email: "sam@x.com", company: "Nuance Infotech" })).toMatchObject({ name: "", firstName: "", displayNameIsCompany: true });
    expect(senderIdentity({ displayName: "nuance infotech pvt", email: null, company: "Nuance Infotech" }).displayNameIsCompany).toBe(true);
    expect(senderIdentity({ displayName: "", email: "sourabh.k@gmail.com", company: "Nuance Infotech" })).toMatchObject({ name: "Sourabh", firstName: "Sourabh" });
  });
  it("picks the tools row by the lead's business type OR industry, several keywords per row, the most specific wins, else the default", () => {
    const rows = { default: "React stack.", "health, medical": "FHIR and HIPAA-ready.", healthtech: "Healthtech stack.", fintech: "Payments stack." };
    expect(toolsFor("software agency", rows, "Hospital & Health Care")).toBe("FHIR and HIPAA-ready.");
    expect(toolsFor("healthtech platform", rows, null)).toBe("Healthtech stack."); // the longer keyword is more specific
    expect(toolsFor("saas", rows, "fintech")).toBe("Payments stack.");
    expect(toolsFor("logistics", rows, "transport")).toBe("React stack.");
    expect(toolsFor("logistics", { x: "y" })).toBe("");
  });
  it("tells the writer the sign-off, the reply-only ask, and puts the style guide and samples in the system text (the part that is the same for every lead)", () => {
    const wctx = { firstName: "Asha", title: "CTO", company: "Acme", businessType: "healthtech", senderFirstName: "Sam", senderName: "Sam Rivera", senderCompany: "Nuance Infotech", offerName: "White-label development", caseStudy: null, facts: facts, tools: "tools", config: { ...cfg, reference_emails: ["Hi A, sample one.", "Hi B, sample two."] } };
    const { system, prompt } = buildWritePrompt(wctx);
    expect(system).toContain("SAMPLE 1: Hi A, sample one.");
    expect(system).toContain("just reply");
    expect(system).toContain("never write the company name twice");
    expect(prompt).not.toContain("SAMPLE 1");
    expect(prompt).toContain("SENDER_NAME: Sam Rivera");
    expect(prompt).toContain("SENDER_COMPANY: Nuance Infotech");
    expect(prompt).toContain("OFFER (internal, never in the subject): White-label development");
  });
  it("flags a title-case or long subject and a too-short body", () => {
    expect(checkEmailCode(write(good, "Ideas For Acme Today"), ctx).join()).toContain("W5: subject in title case");
    expect(checkEmailCode(write("Hi Asha,\n\nShort.", "idea"), ctx).join()).toContain("W1");
  });
  it("the model check passes at 9 of 12 with no zero, not otherwise", () => {
    const s = (a: number[]) => ({ scores: { one_true_detail: a[0]!, process_question: a[1]!, tools_for_their_industry: a[2]!, white_label_line: a[3]!, soft_ask: a[4]!, human_tone: a[5]! }, problems: [] });
    expect(emailCheckPasses(s([2, 2, 2, 2, 2, 2]))).toBe(true);
    expect(emailCheckPasses(s([2, 2, 1, 1, 2, 1]))).toBe(true); // 9
    expect(emailCheckPasses(s([2, 2, 1, 1, 1, 1]))).toBe(false); // 8
    expect(emailCheckPasses(s([2, 2, 2, 2, 2, 0]))).toBe(false); // a zero
  });
  it("adds the footer from the settings", () => expect(withFooter("Hi", "1 Road", "Reply STOP")).toBe("Hi\n\n--\n1 Road\nReply STOP"));
});

describe("Settings form: the models", () => {
  const form = () => workflowConfigToForm(parseWorkflowConfig({ white_label_line: "We do white-label work for agencies." }));
  const parse = (over: Record<string, string> = {}) => workflowFormSchema.safeParse({ ...form(), ...over });
  it("shows the three model names and saves a change to each", () => {
    expect(form()).toMatchObject({ model_screen: "claude-haiku-5-5", model_extract: "claude-haiku-5-5", model_write: "claude-sonnet-5-5" });
    const r = parse({ model_screen: "anthropic/claude-haiku-5.5", model_write: " claude-opus-5-5 " });
    expect(r.success).toBe(true);
    if (r.success) {
      const c = workflowFormToConfig(r.data, parseWorkflowConfig({}));
      expect(c).toMatchObject({ model_screen: "anthropic/claude-haiku-5.5", model_extract: "claude-haiku-5-5", model_write: "claude-opus-5-5" });
    }
  });
  it("refuses an empty model name", () => {
    expect(parse({ model_write: "" }).success).toBe(false);
    expect(parse({ model_screen: "  " }).success).toBe(false);
  });
});

describe("the rewrite prompt names the exact rules that failed", () => {
  const wctx = {
    firstName: "Asha", title: "CTO", company: "Acme", businessType: "software", senderFirstName: "Sam", offerName: null, caseStudy: null, tools: "React and Node.",
    facts: [{ id: "f1", type: "hiring", statement: "Acme is hiring", quote: "We are hiring", sourceUrl: "https://acme.com/careers" }],
    config: { style_guide: "plain", reference_emails: [], white_label_line: "We do this as white-label work.", banned_phrases: ["synergy"] },
  } as unknown as Parameters<typeof buildWritePrompt>[0];

  it("quotes each failed rule next to what went wrong, and shows the last attempt", () => {
    const flags = ["W2: 2 question marks (needs exactly one)", "W7: soft ask missing", "C4: score 8/12 (needs 9 with no zero); weak: soft ask", "greeting does not use the contact's first name"];
    const { prompt } = buildWritePrompt(wctx, flags, { subject: "old subject", body: "Hi there, old body?" });
    expect(prompt).toContain("THE LAST ATTEMPT FAILED THESE RULES");
    expect(prompt).toContain("- FAILED W2: 2 question marks (needs exactly one)");
    expect(prompt).toContain("RULE W2: Use exactly ONE of the given verified facts");
    expect(prompt).toContain("RULE W7: Include the white-label line exactly as given");
    expect(prompt).toContain("RULE C4: A reviewer scores six items");
    expect(prompt).toContain("RULE (greeting): Start with the greeting");
    expect(prompt).toContain("LAST ATTEMPT BODY:\nHi there, old body?");
  });
  it("the first attempt carries no failure text", () => {
    expect(buildWritePrompt(wctx).prompt).not.toContain("FAILED");
  });
  it("a flag without a known rule is passed on as it is", () => {
    expect(explainFlag("the writer returned unreadable output")).toBe("the writer returned unreadable output");
  });
});

describe("Retry puts a lead back at the step that failed", () => {
  const lead = (reason: string[], status = "approved", next: string | null = null) => ({ status, reason_codes: reason, next_action: next });
  const both = { hasEmail: true, hasDraft: false };
  it("a failed write goes back to writing, a failed Gmail save to saving (or writing if there is no text yet)", () => {
    expect(retryPatch(lead(["step-failed", "write: boom"], "approved", "draft"), both)).toMatchObject({ status: "approved", next_action: "draft" });
    expect(retryPatch(lead(["step-failed", "write: boom"]), { hasEmail: true, hasDraft: true })).toMatchObject({ status: "approved", next_action: "deliver" });
    expect(retryPatch(lead(["gmail-failed", "x"]), { hasEmail: true, hasDraft: true })).toMatchObject({ status: "approved", next_action: "deliver" });
    expect(retryPatch(lead(["gmail-failed", "x"]), both)).toMatchObject({ status: "approved", next_action: "draft" });
    expect(retryPatch(lead(["draft-failed", "W2"], "disqualified"), both)).toMatchObject({ status: "approved", next_action: "draft" });
  });
  it("earlier steps are never redone: a failed email check restarts at that check, a failed research at the research", () => {
    expect(retryPatch(lead(["step-failed", "reveal: ZeroBounce validate failed"]), both)).toMatchObject({ status: "approved", next_action: "reveal" });
    expect(retryPatch(lead(["step-failed", "research: x"], "researching"), both)).toMatchObject({ status: "researching", next_action: null });
    expect(retryPatch(lead(["step-failed", "quick check: x"], "imported"), both)).toMatchObject({ status: "imported" });
    expect(retryPatch(lead(["extraction-suspect", "x"], "disqualified"), both)).toMatchObject({ status: "researching" });
    expect(retryPatch(lead(["credit-cap", "x"], "disqualified"), both)).toMatchObject({ status: "approved", next_action: "reveal" });
  });
  it("a person has to act first when there is no email or a credit may have been spent", () => {
    expect(retryPatch(lead(["no-email", "x"], "disqualified"), { hasEmail: false, hasDraft: false })).toBeNull();
    expect(retryPatch(lead(["no-email", "x"], "disqualified"), both)).toMatchObject({ status: "imported" });
    expect(retryPatch(lead(["credit-uncertain", "x"], "disqualified"), both)).toBeNull();
    expect(retryPatch(lead(["below-threshold", "score 40"], "disqualified"), both)).toBeNull();
  });
});

describe("saving one Setup section keeps the rest", () => {
  it("merges only the given keys and still validates", () => {
    const base = parseWorkflowConfig({ postal_address: "1 Main St", optout_line: "Reply STOP." });
    const next = mergeWorkflowConfig(base, { schedule_enabled: true, run_time_ist: "07:15" });
    expect(next).toMatchObject({ postal_address: "1 Main St", optout_line: "Reply STOP.", schedule_enabled: true, run_time_ist: "07:15", skip_verification: false });
    expect(() => mergeWorkflowConfig(base, { run_time_ist: "25:99" })).toThrow();
  });
});
