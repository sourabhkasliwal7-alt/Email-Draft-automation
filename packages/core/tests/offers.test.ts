import { describe, expect, it } from "vitest";
import { chooseCaseStudyByRules, chooseOfferByRules, termMatches, wordsOf, type CaseStudyRule, type OfferRule } from "../src";

const whiteLabel: OfferRule = { id: "wl", name: "White-label for agencies", matchTerms: ["agency", "web design"], triggerTypes: [] };
const healthtech: OfferRule = { id: "ht", name: "Extra engineering capacity for healthtech", matchTerms: ["healthcare", "health tech", "SaaS"], triggerTypes: ["hiring-developers"] };
const fundedOnly: OfferRule = { id: "fu", name: "Scale-up squad", matchTerms: [], triggerTypes: ["funding"] };
const noRules: OfferRule = { id: "nr", name: "General development", matchTerms: [], triggerTypes: [] };

describe("term matching", () => {
  it("ignores capitals, punctuation and plural endings", () => {
    expect(wordsOf("Web-design Agencies")).toEqual(["web", "design", "agency"]);
    expect(termMatches("agency", "Digital Agencies")).toBe(true);
    expect(termMatches("web design", "Boutique WEB-DESIGN studio")).toBe(true);
    expect(termMatches("SaaS", "B2B saas platform")).toBe(true);
  });

  it("matches whole words in order, not parts of words", () => {
    expect(termMatches("it", "city planning")).toBe(false);
    expect(termMatches("health", "wealth management")).toBe(false);
    expect(termMatches("web design", "design for the web")).toBe(false);
    expect(termMatches("", "anything")).toBe(false);
    expect(termMatches("agency", null)).toBe(false);
  });
});

describe("chooseOfferByRules", () => {
  const offers = [whiteLabel, healthtech];

  it("picks the offer whose business types match", () => {
    const a = chooseOfferByRules(offers, "ht", { businessType: "Web design agency" });
    expect(a).toMatchObject({ offerId: "wl", how: "rule" });
    expect(a.reason).toBe('Matched "agency", "web design" in the business type.');

    const b = chooseOfferByRules(offers, "wl", { businessType: "Healthcare software", industry: "hospital & health care" });
    expect(b).toMatchObject({ offerId: "ht", how: "rule" });
    expect(b.reason).toContain('"healthcare"');
  });

  it("matches on the industry when the business type says nothing", () => {
    const r = chooseOfferByRules(offers, "ht", { businessType: null, industry: "Marketing agency" });
    expect(r).toMatchObject({ offerId: "wl", how: "rule" });
    expect(r.reason).toContain("industry");
  });

  it("falls back to the default offer when no rule matches", () => {
    const r = chooseOfferByRules(offers, "ht", { businessType: "Logistics", industry: "transportation" });
    expect(r).toMatchObject({ offerId: "ht", how: "default" });
    expect(r.reason).toContain("No offer rule matched");
    expect(r.reason).toContain("the default offer");
    expect(chooseOfferByRules(offers, "wl", { businessType: "Logistics" }).offerId).toBe("wl");
  });

  it("falls back to the default when nothing is known about the lead", () => {
    expect(chooseOfferByRules(offers, "wl", {})).toMatchObject({ offerId: "wl", how: "default" });
  });

  it("falls back to the first offer when the default is not among the live offers", () => {
    const r = chooseOfferByRules(offers, "archived-offer", { businessType: "Logistics" });
    expect(r).toMatchObject({ offerId: "wl", how: "default" });
    expect(r.reason).toContain("no default offer is set");
    expect(chooseOfferByRules(offers, null, { businessType: "Logistics" }).offerId).toBe("wl");
  });

  it("uses a campaign's only offer without looking at rules", () => {
    expect(chooseOfferByRules([noRules], "nr", { businessType: "Logistics" })).toMatchObject({ offerId: "nr", how: "only-offer" });
    expect(chooseOfferByRules([healthtech], null, { businessType: "Agency" })).toMatchObject({ offerId: "ht", how: "only-offer" });
  });

  it("returns no offer when the campaign has none", () => {
    expect(chooseOfferByRules([], null, { businessType: "Agency" })).toMatchObject({ offerId: null, how: "none" });
  });

  it("an offer without any rule is never chosen by rules, only as the default", () => {
    const list = [noRules, whiteLabel];
    expect(chooseOfferByRules(list, "nr", { businessType: "Agency" }).offerId).toBe("wl");
    expect(chooseOfferByRules(list, "nr", { businessType: "Logistics" })).toMatchObject({ offerId: "nr", how: "default" });
  });

  it("the trigger type adds weight to an offer that matches by business type", () => {
    // both offers match "SaaS agency"; the hiring trigger tips it to the offer that fits hiring best
    const both = [whiteLabel, healthtech];
    const lead = { businessType: "SaaS agency" };
    expect(chooseOfferByRules(both, "wl", lead).offerId).toBe("wl"); // tie: the default offer is kept
    const hiring = chooseOfferByRules(both, "wl", { ...lead, triggerType: "hiring-developers" });
    expect(hiring.offerId).toBe("ht");
    expect(hiring.reason).toContain('trigger "Hiring developers" fits this offer');
  });

  it("a trigger alone does not select an offer that lists business types the lead does not match", () => {
    const r = chooseOfferByRules([whiteLabel, healthtech], "wl", { businessType: "Logistics", triggerType: "hiring-developers" });
    expect(r).toMatchObject({ offerId: "wl", how: "default" });
  });

  it("an offer that lists only trigger types is chosen by its trigger", () => {
    const list = [whiteLabel, fundedOnly];
    expect(chooseOfferByRules(list, "wl", { businessType: "Logistics", triggerType: "funding" })).toMatchObject({ offerId: "fu", how: "rule" });
    expect(chooseOfferByRules(list, "wl", { businessType: "Logistics", triggerType: "award" })).toMatchObject({ offerId: "wl", how: "default" });
    expect(chooseOfferByRules(list, "wl", { businessType: "Logistics", triggerType: "none" }).offerId).toBe("wl");
  });

  it("a stronger match wins: business type counts more than industry", () => {
    const a: OfferRule = { id: "a", name: "A", matchTerms: ["logistics"], triggerTypes: [] };
    const b: OfferRule = { id: "b", name: "B", matchTerms: ["freight"], triggerTypes: [] };
    const r = chooseOfferByRules([a, b], "a", { businessType: "Freight forwarder", industry: "Logistics" });
    expect(r.offerId).toBe("b");
  });

  it("on an equal tie the default offer wins, otherwise the first listed", () => {
    const a: OfferRule = { id: "a", name: "A", matchTerms: ["agency"], triggerTypes: [] };
    const b: OfferRule = { id: "b", name: "B", matchTerms: ["agency"], triggerTypes: [] };
    const tie = chooseOfferByRules([a, b], "b", { businessType: "Agency" });
    expect(tie.offerId).toBe("b");
    expect(tie.reason).toContain("2 offers fit equally");
    expect(chooseOfferByRules([a, b], null, { businessType: "Agency" }).offerId).toBe("a");
  });

  it("is deterministic: the same lead always gets the same offer", () => {
    const lead = { businessType: "Healthcare SaaS", industry: "software", triggerType: "hiring-developers" };
    const first = chooseOfferByRules(offers, "wl", lead);
    for (let i = 0; i < 5; i++) expect(chooseOfferByRules(offers, "wl", lead)).toEqual(first);
  });

  it("counts a repeated term once", () => {
    const a: OfferRule = { id: "a", name: "A", matchTerms: ["agency", "Agencies", "agency"], triggerTypes: [] };
    const b: OfferRule = { id: "b", name: "B", matchTerms: ["agency", "studio"], triggerTypes: [] };
    // both match "agency" once (3 points); with duplicates counted, A would win on points alone
    expect(chooseOfferByRules([a, b], "b", { businessType: "Design agency" }).offerId).toBe("b");
  });
});

describe("chooseCaseStudyByRules", () => {
  const logistics: CaseStudyRule = { id: "cs1", title: "Fleet tracking app", industries: ["logistics", "transportation"] };
  const agency: CaseStudyRule = { id: "cs2", title: "Agency overflow", industries: ["agency", "web design"] };

  it("picks the case study whose industries fit the lead", () => {
    expect(chooseCaseStudyByRules([logistics, agency], { businessType: "Digital agency" }).caseStudyId).toBe("cs2");
    expect(chooseCaseStudyByRules([logistics, agency], { industry: "Transportation" }).caseStudyId).toBe("cs1");
  });

  it("takes the first listed on a tie", () => {
    const twin: CaseStudyRule = { id: "cs3", title: "Another agency win", industries: ["agency"] };
    expect(chooseCaseStudyByRules([agency, twin], { businessType: "Agency" }).caseStudyId).toBe("cs2");
  });

  it("chooses none when nothing fits, and says why", () => {
    const r = chooseCaseStudyByRules([logistics, agency], { businessType: "Dental clinic", industry: "health" });
    expect(r.caseStudyId).toBeNull();
    expect(r.reason).toContain("No case study fits");
  });

  it("chooses none when the offer has no case study, or the case study lists no industries", () => {
    expect(chooseCaseStudyByRules([], { businessType: "Agency" })).toMatchObject({ caseStudyId: null, reason: "This offer has no case study." });
    expect(chooseCaseStudyByRules([{ id: "x", title: "Untargeted", industries: [] }], { businessType: "Agency" }).caseStudyId).toBeNull();
  });
});
