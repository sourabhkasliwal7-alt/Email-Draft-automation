import { describe, expect, it } from "vitest";
import { EMAIL_DOMAIN_MISMATCH, emailDomainMismatch, isNeverFetched, isNotASourceHost, isOwnHost, normalizeEmailStatus, searchHitSource } from "../src";

const company = { name: "Quadrant", domain: "quadrant.com" };
const hit = (url: string, title = "", snippet = "") => ({ url, title, snippet });

describe("research may only use pages about this company (SRS R10)", () => {
  it("never fetches LinkedIn or Crunchbase (LinkedIn only when the admin turned it on)", () => {
    for (const u of ["https://www.linkedin.com/company/quadrant", "https://uk.linkedin.com/in/x", "https://crunchbase.com/organization/quadrant", "https://www.crunchbase.com/organization/quadrant"]) expect(isNeverFetched(u), u).toBe(true);
    expect(isNeverFetched("https://www.linkedin.com/company/q", { linkedinEnabled: true })).toBe(false);
    expect(isNeverFetched("https://www.crunchbase.com/organization/q", { linkedinEnabled: true })).toBe(true); // Crunchbase is never on
    expect(isNeverFetched("https://quadrant.com/about")).toBe(false);
    expect(isNeverFetched("linkedin.com/company/q")).toBe(true); // a bare "website" field value
    expect(isNeverFetched("not a url")).toBe(true);
    expect(isNeverFetched("https://notlinkedin.com/")).toBe(false); // only the real site and its sub-domains
  });

  it("knows the company's own site: its domain or a sub-domain, never a similar name", () => {
    expect(isOwnHost("https://quadrant.com/careers", "quadrant.com")).toBe(true);
    expect(isOwnHost("https://www.quadrant.com/", "quadrant.com")).toBe(true);
    expect(isOwnHost("https://blog.quadrant.com/post", "quadrant.com")).toBe(true);
    expect(isOwnHost("https://quadrantinc.com/", "quadrant.com")).toBe(false);
    expect(isOwnHost("https://notquadrant.com/", "quadrant.com")).toBe(false);
    expect(isOwnHost("https://quadrant.com.evil.example/", "quadrant.com")).toBe(false);
    expect(isOwnHost("garbage", "quadrant.com")).toBe(false);
  });

  it("keeps a hit on the company's own domain", () => {
    expect(searchHitSource(hit("https://quadrant.com/news/funding", "Funding"), company)).toBe("own");
    expect(searchHitSource(hit("https://www.quadrant.com/careers"), company)).toBe("own");
  });

  it("keeps press that names the exact company AND its domain", () => {
    expect(searchHitSource(hit("https://news.example.org/a", "Quadrant (quadrant.com) raises a seed round", "The health-data startup..."), company)).toBe("press");
    expect(searchHitSource(hit("https://news.example.org/b", "Funding news", "Quadrant, which runs quadrant.com, is hiring"), company)).toBe("press");
  });

  it("drops other companies' domains, even when the name is similar (the look-alikes from the reports)", () => {
    for (const [url, title] of [
      ["https://quadrantinc.com/about", "Quadrant Inc - About"],
      ["https://vitalizepsych.com/", "Quadrant partners with Vitalize"],
      ["https://hyphen.group/portfolio", "Quadrant is a Hyphen portfolio company"],
      ["https://nexusfundingsolutions.com/", "Quadrant funding solutions"],
    ] as const) expect(searchHitSource(hit(url, title, "Quadrant news"), company), url).toBeNull();
  });

  it("drops press that names the company but not its domain, or the domain but not the exact name", () => {
    expect(searchHitSource(hit("https://news.example.org/c", "Quadrant raises money", "no site named"), company)).toBeNull();
    expect(searchHitSource(hit("https://news.example.org/d", "Quadrantis (quadrant.com)", ""), company)).toBeNull(); // not the whole name
    expect(searchHitSource(hit("https://news.example.org/e", "Something about quadrant.com", ""), company)).toBeNull(); // no name
  });

  it("drops LinkedIn, Crunchbase, job boards and directories, whatever they say", () => {
    const text = "Quadrant (quadrant.com) is hiring";
    for (const url of [
      "https://www.linkedin.com/company/quadrant",
      "https://www.crunchbase.com/organization/quadrant",
      "https://www.indeed.com/cmp/Quadrant",
      "https://www.glassdoor.com/Overview/Quadrant",
      "https://www.zoominfo.com/c/quadrant",
      "https://clutch.co/profile/quadrant",
      "https://www.facebook.com/quadrant",
    ]) expect(searchHitSource(hit(url, text, text), company), url).toBeNull();
    expect(searchHitSource(hit("https://uk.linkedin.com/in/x", text), company, { linkedinEnabled: true })).toBeNull(); // still not a company page source: LinkedIn is not scraped in this version
  });

  it("recognises directories and job boards", () => {
    expect(isNotASourceHost("https://www.indeed.com/jobs")).toBe(true);
    expect(isNotASourceHost("https://news.example.org/a")).toBe(false);
    expect(isNotASourceHost("nonsense")).toBe(true);
  });

  it("needs a usable company name for press", () => {
    expect(searchHitSource(hit("https://news.example.org/a", "quadrant.com is hiring", ""), { name: null, domain: "quadrant.com" })).toBeNull();
    expect(searchHitSource(hit("https://news.example.org/a", "AB (ab.io) news", ""), { name: "AB", domain: "ab.io" })).toBeNull(); // a 2-letter name is too weak to match on
  });
});

describe("email status and data problems", () => {
  it("has one vocabulary: catch-all and guessed are risky, only a checked address is valid, the rest is unknown", () => {
    for (const v of ["catch_all", "Catch-all", "accept all", "guessed", "unverified", "risky"]) expect(normalizeEmailStatus(v), v).toBe("risky");
    for (const v of ["valid", "Verified", "deliverable"]) expect(normalizeEmailStatus(v), v).toBe("valid");
    for (const v of ["invalid", "bounced"]) expect(normalizeEmailStatus(v), v).toBe("invalid");
    for (const v of ["", null, undefined, "unknown", "something else"]) expect(normalizeEmailStatus(v as string), String(v)).toBe("unknown");
  });

  it("flags an email at another website than the company's", () => {
    expect(EMAIL_DOMAIN_MISMATCH).toBe("email domain mismatch");
    expect(emailDomainMismatch("ann@triniumsystems.com", "elkview.com")).toBe(true);
    expect(emailDomainMismatch("ann@gmail.com", "elkview.com")).toBe(true);
    expect(emailDomainMismatch("ann@elkview.com", "https://www.elkview.com/about")).toBe(false);
    expect(emailDomainMismatch("ann@mail.elkview.com", "elkview.com")).toBe(false);
    expect(emailDomainMismatch("ann@elkview.com", "app.elkview.com")).toBe(false);
    expect(emailDomainMismatch(null, "elkview.com")).toBe(false);
    expect(emailDomainMismatch("ann@elkview.com", null)).toBe(false);
  });
});
