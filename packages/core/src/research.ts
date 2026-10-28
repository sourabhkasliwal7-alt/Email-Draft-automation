import { z } from "zod";

export const SIGNAL_TYPES = ["funding", "hiring", "expansion", "launch", "leadership", "other"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const extractedItemSchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  description: z.string().min(1),
  source_url: z.string().min(1),
  snippet: z.string().min(8),
});
export const extractionSchema = z.object({ items: z.array(extractedItemSchema) });
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

export interface SourceText {
  url: string;
  text: string;
}

/** Lowercase, collapse whitespace and unify quotes/dashes so a snippet can be compared with page text. */
export function normText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips ```json fences and returns the first JSON object found, or null. */
export function parseJsonLoose(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function buildExtractPrompt(company: { name: string | null; domain: string }, sources: SourceText[]): { system: string; prompt: string } {
  const system =
    "[task:extract] You extract verifiable facts and buying signals about a company from the supplied sources only. " +
    'Return JSON {"items":[{"type":"funding|hiring|expansion|launch|leadership|other","description":string,"source_url":string,"snippet":string}]}. ' +
    "snippet MUST be copied verbatim from the source text. Never use outside knowledge. Return {\"items\":[]} if nothing qualifies.";
  const body = sources.map((s, i) => `SOURCE ${i + 1} url=${s.url}\n${s.text}\nEND SOURCE`).join("\n");
  return { system, prompt: `Company: ${company.name ?? company.domain} (${company.domain})\n${body}` };
}

/**
 * ANTI-HALLUCINATION GUARD: an extracted item survives only if its source_url was actually fetched AND its snippet
 * appears in that URL's text. Everything else is dropped and reported.
 */
export function guardExtracted(items: ExtractedItem[], sources: SourceText[]): { kept: ExtractedItem[]; dropped: { item: ExtractedItem; reason: string }[] } {
  const byUrl = new Map(sources.map((s) => [s.url, normText(s.text)]));
  const kept: ExtractedItem[] = [];
  const dropped: { item: ExtractedItem; reason: string }[] = [];
  for (const item of items) {
    const text = byUrl.get(item.source_url);
    if (text === undefined) dropped.push({ item, reason: "source_not_fetched" });
    else if (!text.includes(normText(item.snippet))) dropped.push({ item, reason: "snippet_not_in_source" });
    else kept.push(item);
  }
  return { kept, dropped };
}

/** A search hit counts only if it names the company (by name or domain label): protects against look-alike companies. */
export function searchHitMatchesCompany(hit: { title: string; snippet: string; url: string }, company: { name: string | null; domain: string }): boolean {
  const hay = normText(`${hit.title} ${hit.snippet} ${hit.url}`);
  const label = company.domain.replace(/^www\./, "").split(".")[0] ?? "";
  const names = [company.name, label.replace(/-/g, " ")].filter((n): n is string => Boolean(n && n.trim().length >= 3)).map(normText);
  return names.some((n) => hay.includes(n));
}

/** Hiring is "verified" only when it comes from the company's own careers page; everything else is "possible". */
export function classifyVerification(item: ExtractedItem, domain: string, signalDate: Date | null, now = new Date()): "verified" | "possible" | "stale" {
  const maxAgeDays = item.type === "hiring" ? 60 : 180;
  if (signalDate && now.getTime() - signalDate.getTime() > maxAgeDays * 86_400_000) return "stale";
  let host = "";
  let path = "";
  try {
    const u = new URL(item.source_url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname.toLowerCase();
  } catch {
    return "possible";
  }
  const own = host === domain || host.endsWith(`.${domain}`);
  if (item.type === "hiring") return own && /career|jobs|join/.test(path) ? "verified" : "possible";
  return own ? "verified" : "possible";
}

// ---------------------------------------------------------------- which sites research may read (SRS R10)
/** Never fetched, never used as a source: LinkedIn (unless the admin turned LinkedIn on) and Crunchbase (always). */
export const RESEARCH_NEVER_FETCH = ["linkedin.com", "crunchbase.com"] as const;

/**
 * Sites that can never be "news or press about the company": job boards, review and company-data directories, social networks and
 * contact-data sellers. A search hit on one of these says nothing checkable about the company, so it is dropped.
 */
export const RESEARCH_NOT_A_SOURCE = [
  "linkedin.com", "crunchbase.com",
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com", "naukri.com", "simplyhired.com", "careerbuilder.com", "wellfound.com", "angel.co", "ambitionbox.com", "comparably.com", "builtin.com",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "pinterest.com", "reddit.com", "quora.com", "youtube.com",
  "clutch.co", "goodfirms.co", "g2.com", "capterra.com", "trustpilot.com", "yelp.com", "yellowpages.com", "bbb.org", "mapquest.com",
  "zoominfo.com", "dnb.com", "owler.com", "tracxn.com", "pitchbook.com", "rocketreach.co", "apollo.io", "signalhire.com", "lusha.com", "cbinsights.com", "leadiq.com",
] as const;

const hostName = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const onList = (host: string, list: readonly string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** True when this address is the company's own site: its domain or a sub-domain of it (not a similar-looking name). */
export function isOwnHost(url: string, domain: string): boolean {
  const host = hostName(url);
  const own = domain.toLowerCase().replace(/^www\./, "");
  return host !== null && (host === own || host.endsWith(`.${own}`));
}

/** True for addresses that must not be fetched or used: Crunchbase always, LinkedIn unless `linkedinEnabled`. */
export function isNeverFetched(url: string, opts: { linkedinEnabled?: boolean } = {}): boolean {
  const host = hostName(url.includes("://") ? url : `https://${url}`);
  if (!host) return true;
  return onList(host, opts.linkedinEnabled ? ["crunchbase.com"] : RESEARCH_NEVER_FETCH);
}

/**
 * Whether a search result may be used as a source about THIS company:
 *  - "own": it is on the company's own domain;
 *  - "press": it is on another site that is not blocked or a directory, and its title or snippet names the exact company AND gives its domain
 *    (so a different company with a similar name, such as quadrantinc.com for quadrant.com, is never taken);
 *  - null: not usable.
 */
export function searchHitSource(
  hit: { title: string; snippet: string; url: string },
  company: { name: string | null; domain: string },
  opts: { linkedinEnabled?: boolean } = {},
): "own" | "press" | null {
  const host = hostName(hit.url);
  if (!host || isNeverFetched(hit.url, opts)) return null;
  if (isOwnHost(hit.url, company.domain)) return "own";
  if (onList(host, RESEARCH_NOT_A_SOURCE)) return null;
  const name = company.name?.trim() ?? "";
  if (name.length < 3) return null;
  const text = normText(`${hit.title} ${hit.snippet}`);
  const domain = company.domain.toLowerCase().replace(/^www\./, "");
  // the exact name as whole words (the name inside the domain does not count), and the domain written out
  const wholeName = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normText(name))}($|[^a-z0-9])`).test(text.split(domain).join(" "));
  return wholeName && text.includes(domain) ? "press" : null;
}

/** True for job boards, review and company-data directories, social networks and contact-data sellers: never a source about a company. */
export function isNotASourceHost(url: string): boolean {
  const host = hostName(url);
  return host === null || onList(host, RESEARCH_NOT_A_SOURCE);
}
