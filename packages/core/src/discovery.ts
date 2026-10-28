/**
 * Web discovery (Google): find company websites with a search engine, keep only real company sites, and pick the best person to write to.
 * Pure functions. Safety rules (docs/SRS.docx): no logins, no LinkedIn or Crunchbase scraping, nothing is fetched past a block,
 * robots.txt is honoured by the page fetcher. Search results are only ever read through the search API.
 */
import { normalizeDomain } from "./normalize";

export const LEAD_SOURCES = ["csv", "apollo", "web"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = { csv: "CSV file", apollo: "Apollo search", web: "Web discovery (Google)" };

/** The sources of a campaign. Older campaigns stored one word ("csv", "apollo", "both"): they keep working. */
export function sourcesOf(icp: { leadSources?: string[]; leadSource?: string } | null | undefined): LeadSource[] {
  const listed = (icp?.leadSources ?? []).filter((s): s is LeadSource => (LEAD_SOURCES as readonly string[]).includes(s));
  if (listed.length) return [...new Set(listed)];
  switch (icp?.leadSource) {
    case "apollo":
      return ["apollo"];
    case "web":
      return ["web"];
    case "both":
    case "mix":
      return ["csv", "apollo"];
    default:
      return ["csv"];
  }
}

/** The single word saved next to the list (older screens and exports read it). */
export function legacySourceWord(sources: LeadSource[]): "csv" | "apollo" | "web" | "both" | "mix" {
  if (sources.length === 1) return sources[0]!;
  if (sources.length === 2 && sources.includes("csv") && sources.includes("apollo")) return "both";
  return "mix";
}

/** Where a lead came from, for the lead list: "CSV file", "Apollo search" or "Web discovery (Google)". */
export function leadSourceLabel(leadSource: string | null | undefined): string {
  const s = (leadSource ?? "").toLowerCase();
  if (s === "web_discovery" || s.startsWith("web")) return LEAD_SOURCE_LABELS.web;
  if (s.includes("apollo")) return LEAD_SOURCE_LABELS.apollo;
  return LEAD_SOURCE_LABELS.csv;
}

// ---------------------------------------------------------------- what is never a company website
/**
 * Directories, job boards, social sites, news sites and big platforms. A result on one of these (or on a sub-domain of one) is not a
 * company's own website. Editable in Setup > Advanced. Never scraped: LinkedIn and Crunchbase stay on this list on purpose.
 */
export const DEFAULT_WEB_EXCLUDE_DOMAINS: string[] = [
  // social and communities
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com", "discord.com", "t.me", "threads.net", "snapchat.com", "tumblr.com", "behance.net", "dribbble.com", "producthunt.com", "slack.com",
  // directories, reviews and marketplaces for agencies
  "clutch.co", "goodfirms.co", "designrush.com", "sortlist.com", "themanifest.com", "upwork.com", "fiverr.com", "freelancer.com", "toptal.com", "g2.com", "capterra.com", "trustpilot.com", "yelp.com", "yellowpages.com", "justdial.com", "sulekha.com", "indiamart.com", "crunchbase.com", "zoominfo.com", "dnb.com", "owler.com", "tracxn.com", "pitchbook.com", "angel.co", "wellfound.com", "bbb.org", "glassdoor.com", "ambitionbox.com", "comparably.com", "builtin.com", "sortlist.co.uk",
  // job boards
  "indeed.com", "naukri.com", "monster.com", "ziprecruiter.com", "simplyhired.com", "careerbuilder.com", "lever.co", "greenhouse.io", "workable.com", "ashbyhq.com", "smartrecruiters.com", "weworkremotely.com", "remoteok.com", "remote.co", "dice.com", "hired.com", "jobs.lever.co", "apply.workable.com", "boards.greenhouse.io", "recruitee.com", "breezy.hr", "jobvite.com", "hirist.tech", "instahyre.com", "foundit.in", "shine.com", "timesjobs.com",
  // news, blogs and reference
  "wikipedia.org", "medium.com", "substack.com", "wordpress.com", "blogspot.com", "tumblr.com", "forbes.com", "bloomberg.com", "reuters.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "theguardian.com", "wsj.com", "ft.com", "techcrunch.com", "wired.com", "theverge.com", "businessinsider.com", "inc.com", "entrepreneur.com", "fastcompany.com", "economictimes.com", "livemint.com", "hindustantimes.com", "timesofindia.com", "yourstory.com", "inc42.com", "dev.to", "hashnode.com", "stackoverflow.com", "stackexchange.com", "news.ycombinator.com", "hackernoon.com", "smashingmagazine.com", "dzone.com", "geeksforgeeks.org", "w3schools.com",
  // big platforms and tools
  "google.com", "google.co.in", "apple.com", "microsoft.com", "amazon.com", "amazon.in", "aws.amazon.com", "github.com", "github.io", "gitlab.com", "bitbucket.org", "wix.com", "wixsite.com", "squarespace.com", "shopify.com", "myshopify.com", "webflow.io", "notion.so", "notion.site", "figma.com", "canva.com", "atlassian.com", "salesforce.com", "hubspot.com", "mailchimp.com", "zapier.com", "oracle.com", "ibm.com", "accenture.com", "deloitte.com", "capgemini.com", "cognizant.com", "infosys.com", "tcs.com", "wipro.com", "hcltech.com",
];

/** Government, education and military domains are never prospects. */
const BLOCKED_TLD = /(^|\.)(gov|edu|mil|ac)(\.[a-z]{2})?$/i;

const normList = (l: string[]) => l.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean);

/** True when `domain` is, or is a sub-domain of, one of the listed domains. */
export function isExcludedDomain(domain: string, excludeList: string[]): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return normList(excludeList).some((x) => d === x || d.endsWith(`.${x}`));
}

/** A search-result address -> the company's domain, or null when it cannot be a company website. */
export function companyDomainOf(url: string, excludeList: string[]): string | null {
  const domain = normalizeDomain(url);
  if (!domain || !domain.includes(".")) return null;
  if (/^\d+(\.\d+){3}$/.test(domain)) return null; // an IP address
  if (BLOCKED_TLD.test(domain)) return null;
  if (isExcludedDomain(domain, excludeList)) return null;
  return domain;
}

/** "Brightworks Studio | Software agency in Pune" -> "Brightworks Studio"; falls back to the domain's name. */
export function companyNameFromResult(title: string | null | undefined, domain: string): string {
  const first = (title ?? "").split(/\s+[|\-–—:·•]\s+|\s*\|\s*/)[0]?.trim() ?? "";
  const ok = first.length >= 2 && first.length <= 60 && !/^(home|welcome|about|contact|careers?|jobs?)$/i.test(first);
  if (ok) return first;
  const label = domain.replace(/^www\./, "").split(".")[0] ?? domain;
  return label.split(/[-_]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") || domain;
}

// ---------------------------------------------------------------- the search queries
export interface DiscoveryQueryInput {
  industries: string[];
  countries: string[];
  /** words such as "react" or "python": the kind of developer the agency would hire */
  developerKeywords: string[];
  /** queries typed in the campaign: when there are any, they are used instead of the built ones */
  custom?: string[];
  max?: number;
}

export const DEFAULT_WEB_MAX_QUERIES = 10;
export const DEFAULT_WEB_MAX_RESULTS = 10;

/**
 * Queries built from the campaign target, most useful first:
 *   "<industry> agency <country>", "<industry> agency hiring <developer keyword>", "<industry> agency careers <developer keyword> developer".
 * Typed queries win. The list is capped (default 10 queries a run).
 */
export function buildDiscoveryQueries(input: DiscoveryQueryInput): string[] {
  const max = Math.max(1, input.max ?? DEFAULT_WEB_MAX_QUERIES);
  const clean = (q: string) => q.replace(/\s+/g, " ").trim();
  const typed = [...new Set((input.custom ?? []).map(clean).filter(Boolean))];
  if (typed.length) return typed.slice(0, max);

  const industries = input.industries.map(clean).filter(Boolean);
  const countries = input.countries.map(clean).filter(Boolean);
  const dev = clean(input.developerKeywords[0] ?? "react") || "react";
  const out: string[] = [];
  const push = (q: string) => {
    const c = clean(q);
    if (c && !out.includes(c)) out.push(c);
  };
  for (const industry of industries.length ? industries : ["software"]) {
    for (const c of countries.length ? countries : [""]) push(`${industry} agency ${c}`);
    push(`${industry} agency hiring ${dev}`);
    push(`${industry} agency careers ${dev} developer`);
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------- the best person at a company
export interface ContactCandidate {
  id: string;
  firstName: string | null | undefined;
  title: string | null | undefined;
}

const SENIOR = /\b(founder|co-?founder|owner|ceo|chief executive|managing director|md|president|principal|partner|cto|chief technology|head of|vp|vice president|director)\b/i;
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * The best match for the campaign's target titles. A person needs a first name (the email greets them). Exact title beats a title
 * that contains the target, which beats shared words; seniority breaks ties. Returns null when nobody fits at all.
 */
export function pickBestContact<T extends ContactCandidate>(people: T[], targetTitles: string[]): T | null {
  const targets = targetTitles.map((t) => t.trim().toLowerCase()).filter(Boolean);
  let best: { p: T; score: number } | null = null;
  for (const p of people) {
    if (!p.id || !p.firstName?.trim()) continue;
    const title = (p.title ?? "").toLowerCase();
    let score = 0;
    for (const t of targets) {
      if (title === t) score = Math.max(score, 100);
      else if (title && (title.includes(t) || t.includes(title))) score = Math.max(score, 80);
      else {
        const shared = words(t).filter((w) => words(title).includes(w)).length;
        if (shared) score = Math.max(score, 30 + shared * 10);
      }
    }
    if (!targets.length) score = 20; // no target titles: take the most senior person
    if (SENIOR.test(title)) score += 5;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best?.p ?? null;
}
