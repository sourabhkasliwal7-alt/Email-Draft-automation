import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_EXCLUDE_DOMAINS, campaignSchema, campaignToRow, icpSchema, leadSourceLabel, parseWorkflowConfig, sourcesOf } from "@outreach/core";
import { orderSources, previewWebQueries, sourceShort } from "../src/lib/web-queries";
import { ALWAYS_BLOCKED_DOMAINS, cleanDomainLine, missingBlocked, webExcludeFormSchema, webExcludeToPatch } from "../src/app/(app)/setup/schemas";

const form = { industries: "saas", countries: "India", keywordsInclude: "", webQueries: "", maxQueries: "10" };

describe("web query preview in the campaign form", () => {
  it("builds the queries from the target when nothing is typed", () => {
    expect(previewWebQueries(form)).toEqual(["saas agency India", "saas agency hiring react", "saas agency careers react developer"]);
  });
  it("uses the first word the company should mention as the developer keyword", () => {
    expect(previewWebQueries({ ...form, keywordsInclude: "python, django" })).toContain("saas agency hiring python");
  });
  it("typed lines win and the cap applies (a bad cap falls back to 10)", () => {
    expect(previewWebQueries({ ...form, webQueries: "fintech agency pune\n\n  logistics agency delhi  \nfintech agency pune" })).toEqual(["fintech agency pune", "logistics agency delhi"]);
    expect(previewWebQueries({ ...form, webQueries: "a\nb\nc", maxQueries: "2" })).toEqual(["a", "b"]);
    expect(previewWebQueries({ ...form, webQueries: Array.from({ length: 14 }, (_, i) => `q${i}`).join("\n"), maxQueries: "abc" })).toHaveLength(10);
  });
  it("still shows something when the target is empty", () => {
    expect(previewWebQueries({ ...form, industries: "", countries: "" }).length).toBeGreaterThan(0);
  });
});

describe("lead sources in the form", () => {
  it("orders the ticked sources and drops unknown ones", () => {
    expect(orderSources(["web", "csv", "bogus"])).toEqual(["csv", "web"]);
    expect(orderSources([])).toEqual([]);
    expect(sourceShort("web")).toBe("Web");
  });

  const base = { name: "Agencies", industries: "saas", countries: "IN", targetRoles: "Founder", dailyCap: "20", offerIds: ["00000000-0000-4000-8000-0000000000a1"], offerId: "00000000-0000-4000-8000-0000000000a1", status: "active", scoreDraftMin: "70", scoreReviewMin: "50", researchDepth: "standard", sendDays: ["1", "2"], sendStart: "10:00", sendEnd: "17:00" };

  it("a campaign form with three ticked sources saves the list, the old word and the web settings", () => {
    const v = campaignSchema.parse({ ...base, leadSources: ["csv", "apollo", "web"], webQueries: "saas agency pune\n\nsaas agency hiring react", webMaxQueries: "5", webMaxResults: "8" });
    const icp = campaignToRow(v).icp as { leadSources: string[]; leadSource: string; webQueries: string[]; webMaxQueries: number; webMaxResults: number; requireEmail: boolean };
    expect(icp.leadSources).toEqual(["csv", "apollo", "web"]);
    expect(icp.leadSource).toBe("mix");
    expect(icp.webQueries).toEqual(["saas agency pune", "saas agency hiring react"]);
    expect(icp).toMatchObject({ webMaxQueries: 5, webMaxResults: 8, requireEmail: false });
  });

  it("the saved campaign reads back the same way, and older campaigns still map to a list", () => {
    expect(sourcesOf(icpSchema.parse({ leadSources: ["web"], leadSource: "web" }))).toEqual(["web"]);
    expect(sourcesOf({ leadSource: "both" })).toEqual(["csv", "apollo"]);
    expect(sourcesOf({ leadSource: "apollo" })).toEqual(["apollo"]);
    expect(sourcesOf(null)).toEqual(["csv"]);
  });

  it("the lead list names each source in plain words", () => {
    expect(leadSourceLabel("web_discovery")).toBe("Web discovery (Google)");
    expect(leadSourceLabel("import:apollo-pull-2026")).toBe("Apollo search");
    expect(leadSourceLabel("import:leads.csv")).toBe("CSV file");
  });
});

describe("websites we never use as leads (Setup > Advanced)", () => {
  it("cleans what is typed and keeps LinkedIn and Crunchbase blocked", () => {
    expect(cleanDomainLine("  https://www.Clutch.co/agencies?x=1 ")).toBe("clutch.co");
    const patch = webExcludeToPatch(webExcludeFormSchema.parse({ web_exclude_domains: "Indeed.com\nhttps://medium.com/x, notadomain\nindeed.com" }));
    expect(patch.web_exclude_domains).toEqual(["indeed.com", "medium.com", ...ALWAYS_BLOCKED_DOMAINS]);
  });
  it("tells the person which always-blocked domains were removed", () => {
    expect(missingBlocked("clutch.co\nlinkedin.com")).toEqual(["crunchbase.com"]);
    expect(missingBlocked(DEFAULT_WEB_EXCLUDE_DOMAINS.join("\n"))).toEqual([]);
  });
  it("the saved config keeps the default list until it is changed", () => {
    const cfg = parseWorkflowConfig({});
    expect(cfg.web_exclude_domains).toEqual(DEFAULT_WEB_EXCLUDE_DOMAINS);
    expect(cfg.web_exclude_domains).toEqual(expect.arrayContaining(ALWAYS_BLOCKED_DOMAINS));
  });
});
