import { describe, expect, it } from "vitest";
import {
  ATTENTION_REASONS,
  DEFAULT_WEB_EXCLUDE_DOMAINS,
  DEFAULT_WEB_MAX_QUERIES,
  SKIP_LABELS,
  buildDiscoveryQueries,
  campaignSchema,
  campaignToRow,
  companyDomainOf,
  companyNameFromResult,
  icpSchema,
  isExcludedDomain,
  leadSourceLabel,
  legacySourceWord,
  parseWorkflowConfig,
  pickBestContact,
  sourcesOf,
} from "../src";

const EX = DEFAULT_WEB_EXCLUDE_DOMAINS;

describe("lead sources", () => {
  it("reads the new list, and the old single word for campaigns saved before", () => {
    expect(sourcesOf({ leadSources: ["web", "csv", "web"] })).toEqual(["web", "csv"]);
    expect(sourcesOf({ leadSource: "apollo" })).toEqual(["apollo"]);
    expect(sourcesOf({ leadSource: "web" })).toEqual(["web"]);
    expect(sourcesOf({ leadSource: "both" })).toEqual(["csv", "apollo"]);
    expect(sourcesOf({ leadSource: "csv" })).toEqual(["csv"]);
    expect(sourcesOf({})).toEqual(["csv"]);
    expect(sourcesOf(null)).toEqual(["csv"]);
    expect(sourcesOf({ leadSources: ["nonsense"], leadSource: "apollo" })).toEqual(["apollo"]); // unknown values are ignored
    expect(sourcesOf(icpSchema.parse({ leadSource: "both" }))).toEqual(["csv", "apollo"]);
  });

  it("keeps the old single word in step with the list", () => {
    expect(legacySourceWord(["csv"])).toBe("csv");
    expect(legacySourceWord(["apollo"])).toBe("apollo");
    expect(legacySourceWord(["web"])).toBe("web");
    expect(legacySourceWord(["csv", "apollo"])).toBe("both");
    expect(legacySourceWord(["csv", "web"])).toBe("mix");
    expect(legacySourceWord(["csv", "apollo", "web"])).toBe("mix");
  });

  it("names where a lead came from", () => {
    expect(leadSourceLabel("web_discovery")).toBe("Web discovery (Google)");
    expect(leadSourceLabel("import:apollo-pull-1a2b3c4d")).toBe("Apollo search");
    expect(leadSourceLabel("import:leads.csv")).toBe("CSV file");
    expect(leadSourceLabel(null)).toBe("CSV file");
  });
});

describe("campaign form with lead sources", () => {
  const base = { name: "Agencies", industries: "saas", countries: "IN", employeeMin: "", employeeMax: "", targetRoles: "COO", regions: "", scoreDraftMin: "70", scoreReviewMin: "50", dailyCap: "10", offerId: "", tone: "plain", cta: "", inboxId: "", researchDepth: "standard", sendDays: ["1", "2", "3"], sendStart: "10:00", sendEnd: "17:00" };

  it("saves the ticked sources, the typed queries and the caps", () => {
    const row = campaignToRow(campaignSchema.parse({ ...base, leadSources: ["apollo", "web"], webQueries: "react agency india\n\n  nextjs agency hiring \n", webMaxQueries: "6", webMaxResults: "8" }));
    expect(row.icp.leadSources).toEqual(["apollo", "web"]);
    expect(row.icp.leadSource).toBe("mix");
    expect(row.icp.webQueries).toEqual(["react agency india", "nextjs agency hiring"]);
    expect(row.icp.webMaxQueries).toBe(6);
    expect(row.icp.webMaxResults).toBe(8);
    expect(row.icp.requireEmail).toBe(false); // a web or Apollo lead has no email until it is revealed
    expect(icpSchema.parse(row.icp)).toMatchObject({ leadSources: ["apollo", "web"], webMaxQueries: 6 });
  });

  it("insists on an email column only for a CSV-only campaign, and keeps the old one-word field working", () => {
    expect(campaignToRow(campaignSchema.parse({ ...base, leadSources: ["csv"] })).icp.requireEmail).toBe(true);
    expect(campaignToRow(campaignSchema.parse({ ...base, leadSources: ["csv", "web"] })).icp.requireEmail).toBe(false);
    const old = campaignToRow(campaignSchema.parse({ ...base, leadSource: "both" }));
    expect(old.icp.leadSources).toEqual(["csv", "apollo"]);
    expect(old.icp.leadSource).toBe("both");
    const none = campaignToRow(campaignSchema.parse(base));
    expect(none.icp).toMatchObject({ leadSources: ["csv"], leadSource: "csv", webMaxQueries: DEFAULT_WEB_MAX_QUERIES, webQueries: [] });
  });

  it("refuses caps that cannot work", () => {
    const r = campaignSchema.safeParse({ ...base, leadSources: ["web"], webMaxQueries: "0", webMaxResults: "50" });
    expect(r.success).toBe(false);
    if (r.success) return;
    const msgs = Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    expect(msgs["webMaxQueries"]).toMatch(/at least 1/);
    expect(msgs["webMaxResults"]).toMatch(/at most 20/);
  });
});

describe("search queries", () => {
  it("are built from the target, most useful first", () => {
    expect(buildDiscoveryQueries({ industries: ["fintech"], countries: ["India", "UK"], developerKeywords: ["python"] })).toEqual([
      "fintech agency India",
      "fintech agency UK",
      "fintech agency hiring python",
      "fintech agency careers python developer",
    ]);
  });

  it("fall back to sensible words, and never repeat", () => {
    expect(buildDiscoveryQueries({ industries: [], countries: [], developerKeywords: [] })).toEqual(["software agency", "software agency hiring react", "software agency careers react developer"]);
    const q = buildDiscoveryQueries({ industries: ["saas", "saas"], countries: [], developerKeywords: ["react"] });
    expect(new Set(q).size).toBe(q.length);
  });

  it("use the typed queries instead when there are any, and respect the cap", () => {
    const custom = ["  react   agency  pune ", "react agency pune", "vue agency berlin", "angular agency"];
    expect(buildDiscoveryQueries({ industries: ["x"], countries: ["y"], developerKeywords: [], custom })).toEqual(["react agency pune", "vue agency berlin", "angular agency"]);
    expect(buildDiscoveryQueries({ industries: ["x"], countries: [], developerKeywords: [], custom, max: 2 })).toHaveLength(2);
    expect(buildDiscoveryQueries({ industries: ["a", "b", "c", "d", "e"], countries: ["1", "2", "3"], developerKeywords: [] })).toHaveLength(DEFAULT_WEB_MAX_QUERIES);
  });
});

describe("company websites", () => {
  it("drops directories, job boards, social, news and big platforms (and their sub-domains)", () => {
    for (const url of [
      "https://www.linkedin.com/company/acme",
      "https://clutch.co/profile/acme",
      "https://in.indeed.com/jobs?q=react",
      "https://uk.linkedin.com/in/x",
      "https://acme.github.io/",
      "https://medium.com/@acme/post",
      "https://www.crunchbase.com/organization/acme",
      "https://www.forbes.com/sites/x",
    ]) expect(companyDomainOf(url, EX), url).toBeNull();
  });

  it("drops government, education, IP addresses and nonsense", () => {
    for (const url of ["https://www.mit.edu/", "https://data.gov.uk/x", "http://192.168.0.1/", "https://localhost/", "not a url", ""]) expect(companyDomainOf(url, EX), url).toBeNull();
  });

  it("keeps a company site, once, without www", () => {
    expect(companyDomainOf("https://www.brightworks.studio/careers?ref=1", EX)).toBe("brightworks.studio");
    expect(companyDomainOf("https://BrightWorks.studio/", EX)).toBe("brightworks.studio");
    expect(companyDomainOf("https://notlinkedin.com/", EX)).toBe("notlinkedin.com"); // only the real domain and its sub-domains are excluded
  });

  it("uses the list it is given", () => {
    expect(companyDomainOf("https://acme.io/", ["acme.io"])).toBeNull();
    expect(companyDomainOf("https://shop.acme.io/", ["https://www.acme.io/path"])).toBeNull();
    expect(isExcludedDomain("acme.io", [])).toBe(false);
    // the two sites that must never be scraped are on the default list
    expect(EX).toEqual(expect.arrayContaining(["linkedin.com", "crunchbase.com"]));
  });

  it("names the company from the page title, or from the domain", () => {
    expect(companyNameFromResult("Brightworks Studio | Software agency in Pune", "brightworks.studio")).toBe("Brightworks Studio");
    expect(companyNameFromResult("Acme - Home", "acme.io")).toBe("Acme");
    expect(companyNameFromResult("Home", "bright-works.studio")).toBe("Bright Works");
    expect(companyNameFromResult("", "acme.io")).toBe("Acme");
    expect(companyNameFromResult(null, "acme.io")).toBe("Acme");
  });
});

describe("the person to write to", () => {
  const people = [
    { id: "1", firstName: "Ann", title: "Marketing Manager" },
    { id: "2", firstName: "Bo", title: "Head of Operations" },
    { id: "3", firstName: "Cy", title: "Operations Manager" },
    { id: "4", firstName: null, title: "COO" }, // no first name: the email could not greet them
  ];

  it("prefers the exact target title, then a title that contains it, then shared words", () => {
    expect(pickBestContact(people, ["Head of Operations"])?.id).toBe("2");
    expect(pickBestContact(people, ["COO", "Operations"])?.id).toBe("2"); // "Operations" is contained in "Head of Operations" and "Operations Manager"; seniority breaks the tie
    expect(pickBestContact([{ id: "x", firstName: "Di", title: "Senior Operations Lead" }, people[0]!], ["Head of Operations"])?.id).toBe("x");
  });

  it("returns nobody rather than a poor guess", () => {
    expect(pickBestContact([people[0]!], ["Head of Operations"])).toBeNull();
    expect(pickBestContact([people[3]!], ["COO"])).toBeNull();
    expect(pickBestContact([], ["COO"])).toBeNull();
  });

  it("takes the most senior person when no target title is set", () => {
    expect(pickBestContact([people[0]!, { id: "5", firstName: "Eve", title: "Founder & CEO" }], [])?.id).toBe("5");
  });
});

describe("no contact found", () => {
  it("is a reason that needs a person's attention, with a plain label", () => {
    expect(ATTENTION_REASONS).toContain("no-contact");
    expect(SKIP_LABELS["no-contact"]).toMatch(/No contact found/);
  });
  it("the workflow settings carry an editable exclude list that starts with the default one", () => {
    expect(parseWorkflowConfig({}).web_exclude_domains).toEqual(DEFAULT_WEB_EXCLUDE_DOMAINS);
    expect(parseWorkflowConfig({ web_exclude_domains: ["acme.io"] }).web_exclude_domains).toEqual(["acme.io"]);
  });
});
