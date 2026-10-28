import { describe, expect, it } from "vitest";
import {
  campaignSchema,
  campaignToRow,
  offerSchema,
  parseAllowedNumbers,
  protectCsvCell,
  settingsSchema,
  splitList,
  suppressionSchema,
  suppressionToRow,
  toCsv,
} from "../src";

const OFFER_A = "00000000-0000-4000-8000-0000000000a1";
const OFFER_B = "00000000-0000-4000-8000-0000000000a2";

const validCampaign = {
  name: "  Q4 SaaS  ",
  industries: "saas, fintech\nsaas",
  countries: "IN; US",
  employeeMin: "20",
  employeeMax: "500",
  targetRoles: "COO, Head of Operations",
  regions: "APAC",
  scoreDraftMin: "70",
  scoreReviewMin: "50",
  dailyCap: "20",
  offerIds: [OFFER_A, OFFER_B],
  offerId: OFFER_A,
  tone: " plain ",
  cta: "",
  inboxId: "",
  researchDepth: "standard",
  sendDays: ["1", "2", "3"],
  sendStart: "10:00",
  sendEnd: "17:00",
};

describe("campaignSchema", () => {
  it("accepts a valid form and maps it to a row", () => {
    const r = campaignSchema.safeParse(validCampaign);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const row = campaignToRow(r.data);
    expect(row.name).toBe("Q4 SaaS");
    expect(row.icp.industries).toEqual(["saas", "fintech"]);
    expect(row.icp.countries).toEqual(["IN", "US"]);
    expect(row.icp.employeeMin).toBe(20);
    expect(row.target_roles).toEqual(["COO", "Head of Operations"]);
    expect(row.tone).toBe("plain");
    expect(row.cta).toBeNull();
    expect(row.offer_ids).toEqual([OFFER_A, OFFER_B]);
    expect(row.offer_id).toBe(OFFER_A);
    expect(row.send_window).toEqual({ tz: "Asia/Kolkata", days: [1, 2, 3], start: "10:00", end: "17:00" });
  });

  it("gives clear messages for each mistake", () => {
    const r = campaignSchema.safeParse({
      ...validCampaign,
      name: " ",
      scoreDraftMin: "40",
      scoreReviewMin: "60",
      dailyCap: "-1",
      employeeMin: "100",
      employeeMax: "10",
      sendStart: "18:00",
      sendDays: [],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const msgs = Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    expect(msgs["name"]).toBe("Campaign name is required");
    expect(msgs["scoreReviewMin"]).toMatch(/cannot be higher than the draft threshold/);
    expect(msgs["dailyCap"]).toMatch(/cannot be negative/);
    expect(msgs["employeeMax"]).toMatch(/at least the minimum/);
    expect(msgs["sendEnd"]).toMatch(/end after it starts/);
    expect(msgs["sendDays"]).toMatch(/at least one send day/);
  });

  it("needs at least one offer, and a default that is one of the ticked offers", () => {
    const none = campaignSchema.safeParse({ ...validCampaign, offerIds: [], offerId: "" });
    expect(none.success).toBe(false);
    if (!none.success) expect(none.error.issues.find((i) => i.path[0] === "offerIds")?.message).toBe("Choose at least one offer");

    const outside = campaignSchema.safeParse({ ...validCampaign, offerIds: [OFFER_A], offerId: OFFER_B });
    expect(outside.success).toBe(false);
    if (!outside.success) expect(outside.error.issues.find((i) => i.path[0] === "offerId")?.message).toMatch(/default offer/);

    const noDefault = campaignSchema.safeParse({ ...validCampaign, offerId: "" });
    expect(noDefault.success).toBe(false);
  });

  it("saves each offer once", () => {
    const r = campaignSchema.parse({ ...validCampaign, offerIds: [OFFER_A, OFFER_A, OFFER_B] });
    expect(campaignToRow(r).offer_ids).toEqual([OFFER_A, OFFER_B]);
  });

  it("research-first campaigns do not require an email", () => {
    const r = campaignSchema.parse({ ...validCampaign, researchFirst: true });
    expect(campaignToRow(r).icp.requireEmail).toBe(false);
  });
});

describe("offer / case study helpers", () => {
  it("offer needs a name", () => {
    expect(offerSchema.safeParse({ name: "" }).success).toBe(false);
    expect(offerSchema.safeParse({ name: "Audit" }).success).toBe(true);
  });

  it("offer matching rules are optional and trigger types must be known", () => {
    const ok = offerSchema.parse({ name: "Audit", matchTerms: "agency, web design", triggerTypes: ["hiring-developers", "funding"] });
    expect(ok.matchTerms).toBe("agency, web design");
    expect(ok.triggerTypes).toEqual(["hiring-developers", "funding"]);
    expect(offerSchema.parse({ name: "Audit" }).triggerTypes).toEqual([]);
    expect(offerSchema.safeParse({ name: "Audit", triggerTypes: ["made-up"] }).success).toBe(false);
  });
  it("parses allowed numbers and reports the bad line", () => {
    expect(parseAllowedNumbers("hours saved = 12\nreply_rate: 3.5").value).toEqual({ "hours saved": 12, reply_rate: 3.5 });
    expect(parseAllowedNumbers("ok = 1\nbroken line").error).toMatch(/Line 2/);
    expect(parseAllowedNumbers("x = twelve").error).toMatch(/Line 1/);
  });
  it("splitList trims and de-duplicates", () => {
    expect(splitList(" a, b ;a\n c ,, ")).toEqual(["a", "b", "c"]);
  });
});

describe("suppressionSchema", () => {
  it("normalises email and domain entries", () => {
    const e = suppressionSchema.parse({ kind: "email", value: " Bob@Example.COM ", scope: "global", reason: "opt-out" });
    expect(suppressionToRow(e)).toMatchObject({ email_lower: "bob@example.com", domain: null, campaign_id: null });
    const d = suppressionSchema.parse({ kind: "domain", value: "https://www.Blocked.com/x", scope: "global", reason: "customer" });
    expect(suppressionToRow(d)).toMatchObject({ email_lower: null, domain: "blocked.com" });
  });
  it("rejects bad values and campaign scope without a campaign", () => {
    expect(suppressionSchema.safeParse({ kind: "email", value: "nope", scope: "global", reason: "x" }).success).toBe(false);
    expect(suppressionSchema.safeParse({ kind: "domain", value: "localhost", scope: "global", reason: "x" }).success).toBe(false);
    expect(suppressionSchema.safeParse({ kind: "email", value: "a@b.co", scope: "campaign", reason: "x" }).success).toBe(false);
    expect(suppressionSchema.safeParse({ kind: "email", value: "a@b.co", scope: "global", reason: "" }).success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("requires model names and defaults flags off", () => {
    const r = settingsSchema.parse({ modelExtraction: "a", modelClaimCheck: "b", modelDrafting: "c", researchDepth: "light" });
    expect(r.sendingEnabled).toBe(false);
    expect(r.crunchbaseEnabled).toBe(false);
    expect(settingsSchema.safeParse({ modelExtraction: "", modelClaimCheck: "b", modelDrafting: "c", researchDepth: "light" }).success).toBe(false);
  });
});

describe("csv export protection", () => {
  it("prefixes formula starters", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(protectCsvCell(bad)).toBe(`'${bad}`);
    expect(protectCsvCell("safe")).toBe("safe");
    expect(protectCsvCell(null)).toBe("");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(toCsv([{ a: 'x,"y"', b: "=cmd" }], ["a", "b"])).toBe('a,b\r\n"x,""y""",\'=cmd');
  });
});
