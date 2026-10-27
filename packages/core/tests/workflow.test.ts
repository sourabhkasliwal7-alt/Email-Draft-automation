import { describe, expect, it } from "vitest";
import {
  approveTop,
  canTransition,
  checkEmailCode,
  checkFacts,
  dailyTarget,
  emailCheckPasses,
  keepDate,
  leadsToFind,
  parseWorkflowConfig,
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
    "Happy to share an example of how that works if it is useful.",
    "",
    "Sam",
    "Nuance Infotech",
  ].join("\n");
  const ctx = { facts, firstName: "Asha", company: "Acme", caseStudyNumbers: [], whiteLabelLine: cfg.white_label_line, bannedPhrases: cfg.banned_phrases };
  const write = (body: string, subject = "idea for Acme") => ({ subject, body, fact_ids_used: ["f1"] });

  it("a correct email passes every code check", () => expect(checkEmailCode(write(good), ctx)).toEqual([]));
  it("flags exclamation marks, links, banned phrases, invented numbers, a missing white-label line, two questions and a wrong greeting", () => {
    expect(checkEmailCode(write(good.replace("useful.", "useful!")), ctx).join()).toContain("W4: exclamation");
    expect(checkEmailCode(write(good.replace("Sam", "see https://x.example.com")), ctx).join()).toContain("W4: link");
    expect(checkEmailCode(write(good.replace("Happy to share", "Just following up. Happy to share")), ctx).join()).toContain("W3: banned phrase");
    expect(checkEmailCode(write(good.replace("our own team", "our own team of 45 people")), ctx).join()).toContain("W6: number 45");
    expect(checkEmailCode(write(good.replace(cfg.white_label_line, "We can help.")), ctx).join()).toContain("W7: white-label");
    expect(checkEmailCode(write(good.replace("at capacity?", "at capacity? And why?")), ctx).join()).toContain("W2: 2 question marks");
    expect(checkEmailCode(write(good.replace("Hi Asha", "Hi Ben")), ctx).join()).toContain("greeting");
    expect(checkEmailCode({ ...write(good), fact_ids_used: [] }, ctx).join()).toContain("W2: exactly one");
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
