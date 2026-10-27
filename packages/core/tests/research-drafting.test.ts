import { describe, expect, it } from "vitest";
import {
  buildDraftPrompt,
  checkDraft,
  classifyVerification,
  decideBand,
  guardExtracted,
  parseJsonLoose,
  qualifyV0,
  scoreV0,
  searchHitMatchesCompany,
  trimCompanySuffix,
  type DraftContext,
  type DraftOutput,
  type ExtractedItem,
} from "../src";

const sources = [
  { url: "https://acme.com/careers", text: "Careers at Acme. We are hiring: Senior Operations Analyst and Data Engineer." },
  { url: "https://news.example.com/acme", text: "Acme announced a seed funding round to expand." },
];

describe("no invented facts: the research guard", () => {
  const real: ExtractedItem = { type: "hiring", description: "hiring", source_url: "https://acme.com/careers", snippet: "We are hiring: Senior Operations Analyst" };
  it("keeps items whose snippet is in the fetched text of that URL", () => {
    expect(guardExtracted([real], sources).kept).toHaveLength(1);
  });
  it("drops an invented snippet", () => {
    const fake: ExtractedItem = { ...real, type: "funding", snippet: "raised $500M from a famous fund" };
    const r = guardExtracted([real, fake], sources);
    expect(r.kept).toEqual([real]);
    expect(r.dropped[0]).toMatchObject({ reason: "snippet_not_in_source" });
  });
  it("drops a real snippet attributed to a page that was never fetched, or to the wrong page", () => {
    expect(guardExtracted([{ ...real, source_url: "https://invented.example.com/" }], sources).dropped[0]!.reason).toBe("source_not_fetched");
    expect(guardExtracted([{ ...real, source_url: "https://news.example.com/acme" }], sources).dropped[0]!.reason).toBe("snippet_not_in_source");
  });
  it("matches regardless of case, whitespace and curly quotes", () => {
    const item: ExtractedItem = { ...real, snippet: "WE ARE   hiring: senior operations analyst" };
    expect(guardExtracted([item], sources).kept).toHaveLength(1);
  });
  it("rejects a search hit about a similarly named company", () => {
    const company = { name: "Acme Logistics", domain: "acmelogistics.com" };
    expect(searchHitMatchesCompany({ title: "Acme Logistics raises seed", snippet: "", url: "https://n.com/a" }, company)).toBe(true);
    expect(searchHitMatchesCompany({ title: "Acme Bakery opens", snippet: "bread", url: "https://n.com/b" }, company)).toBe(false);
  });
  it("hiring is verified only on the company's own careers page", () => {
    const now = new Date("2026-10-26");
    expect(classifyVerification(real, "acme.com", null, now)).toBe("verified");
    expect(classifyVerification({ ...real, source_url: "https://news.example.com/x" }, "acme.com", null, now)).toBe("possible");
    expect(classifyVerification(real, "acme.com", new Date("2026-06-01"), now)).toBe("stale"); // job post older than 60 days
    expect(classifyVerification({ ...real, type: "funding", source_url: "https://news.example.com/x" }, "acme.com", new Date("2024-01-01"), now)).toBe("stale");
  });
  it("parses JSON wrapped in code fences and rejects prose", () => {
    expect(parseJsonLoose('```json\n{"items":[]}\n```')).toEqual({ items: [] });
    expect(parseJsonLoose("sorry, I cannot")).toBeNull();
  });
});

const ctx: DraftContext = {
  firstName: "Asha",
  company: "Acme Logistics Pvt Ltd",
  jobTitle: "COO",
  offerName: "AI workflow audit",
  offerClaims: ["Fixed-scope, two-week audit"],
  caseStudy: { title: "Logistics audit", summary: null, allowedNumbers: { hours_saved: 12 } },
  cta: "Open to a quick call next week?",
  tone: null,
  signature: "Best regards, Sam",
  evidence: [{ id: "e1", snippet: "Acme announced a seed funding round to expand.", url: "https://news.example.com/acme", date: "2026-09-01" }],
};

const good: DraftOutput = {
  subject: "Quick idea for Acme",
  body_text:
    'Hi Asha,\n\nI saw this about Acme: "Acme announced a seed funding round to expand." We help operations teams cut manual reporting with a fixed-scope, two-week audit and I thought it could be relevant to a COO.\n\nOpen to a quick call next week?\n\nBest regards, Sam',
  facts_used: [{ claim: "Acme announced a seed funding round to expand.", evidence_id: "e1" }],
};

describe("no invented facts: the draft checker", () => {
  it("passes a draft whose claims are all in the evidence", () => {
    expect(checkDraft(good, ctx)).toEqual({ pass: true, flags: [] });
  });
  it("fails a planted fake number", () => {
    const fake = { ...good, body_text: good.body_text.replace("fixed-scope", "fixed-scope, 300% ROI") };
    expect(checkDraft(fake, ctx).flags).toContain("number_not_supported:300");
  });
  it("accepts a number that is in the evidence or the case study's allowed numbers", () => {
    const ok = { ...good, body_text: good.body_text.replace("fixed-scope", "fixed-scope, 12-hour") };
    expect(checkDraft(ok, ctx).flags.filter((f) => f.startsWith("number"))).toEqual([]);
  });
  it("fails a claim that points at evidence that does not exist, or does not contain it", () => {
    expect(checkDraft({ ...good, facts_used: [{ claim: "x", evidence_id: "nope" }] }, ctx).flags).toContain("claim_unknown_evidence:nope");
    expect(checkDraft({ ...good, facts_used: [{ claim: "Acme won an award", evidence_id: "e1" }] }, ctx).flags).toContain("claim_not_in_evidence:e1");
  });
  it("fails links, banned phrases, internal terms, missing CTA and wrong greeting name", () => {
    const bad = { ...good, body_text: "Hi Bob,\n\nGuaranteed results, risk-free! see https://x.com . Your lead score is high. " + "word ".repeat(30) };
    const flags = checkDraft(bad, ctx).flags;
    expect(flags).toEqual(expect.arrayContaining(["greeting_name_mismatch", "contains_link", "banned_phrase:risk-free", "internal_term:lead score", "cta_missing"]));
  });
  it("fails 'recently' on stale evidence", () => {
    const stale = { ...ctx, evidence: [{ ...ctx.evidence[0]!, date: "2025-01-01" }] };
    const d = { ...good, body_text: good.body_text.replace("I saw this", "I recently saw this") };
    expect(checkDraft(d, stale, { now: new Date("2026-10-26") }).flags).toContain("recency_claim_on_stale_evidence");
  });
  it("fails very short and very long drafts", () => {
    expect(checkDraft({ ...good, body_text: "Hi Asha, hello." }, ctx).flags.some((f) => f.startsWith("too_short"))).toBe(true);
    expect(checkDraft({ ...good, body_text: good.body_text + " word".repeat(200) }, ctx).flags.some((f) => f.startsWith("too_long"))).toBe(true);
  });
  it("trims company suffixes in prose and puts only given evidence in the prompt", () => {
    expect(trimCompanySuffix("Acme Logistics Pvt Ltd")).toBe("Acme Logistics");
    expect(trimCompanySuffix("Beta Inc.")).toBe("Beta");
    const p = buildDraftPrompt(ctx, ["too_short"]);
    expect(p.prompt).toContain("EVIDENCE e1: Acme announced");
    expect(p.prompt).toContain("COMPANY: Acme Logistics\n");
    expect(p.prompt).toContain("- too_short");
  });
});

describe("qualify and score (v0 rules)", () => {
  it("applies industry, country, employee and role rules and says why", () => {
    const icp = { industries: ["logistics"], countries: ["IN"], employeeMin: 20, employeeMax: 500 };
    expect(qualifyV0(icp, { industry: "logistics", country: "IN", employeeCount: 80, jobTitle: "COO", targetRoles: ["COO"] })).toMatchObject({ pass: true });
    expect(qualifyV0(icp, { industry: "retail", country: "IN", employeeCount: 80 }).reasonCodes).toContain("industry_mismatch");
    expect(qualifyV0(icp, { industry: "logistics", country: "IN", employeeCount: 5000 }).pass).toBe(false);
    expect(qualifyV0(icp, { industry: "logistics", country: "IN", employeeCount: null }).reasonCodes).toContain("employee_unknown");
    expect(qualifyV0({}, { jobTitle: "Intern", targetRoles: ["COO"] }).reasonCodes).toContain("role_mismatch");
  });
  it("scores 0-100 with components and decides the band at the thresholds", () => {
    const s = scoreV0({ qualifyReasons: ["role_match"], evidenceCount: 3, jobTitle: "COO", hasTargetRoles: true, hasOffer: true, emailStatus: "valid", hasEmail: true, employeeKnown: true, industryKnown: true });
    expect(s.score).toBeGreaterThan(80);
    expect(Object.values(s.components).reduce((a, b) => a + b, 0)).toBe(s.score);
    expect(decideBand(70, 70, 50)).toBe("draft");
    expect(decideBand(69, 70, 50)).toBe("review");
    expect(decideBand(50, 70, 50)).toBe("review");
    expect(decideBand(49, 70, 50)).toBe("skip");
  });
});
