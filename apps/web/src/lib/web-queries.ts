import { DEFAULT_WEB_MAX_QUERIES, LEAD_SOURCES, buildDiscoveryQueries, type LeadSource } from "@outreach/core";

const items = (s: string): string[] => [...new Set(s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean))];
const typedLines = (s: string): string[] => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

export interface WebQueryForm {
  industries: string;
  countries: string;
  /** the first "word the company should mention" is the kind of developer the agency would hire (default: react) */
  keywordsInclude: string;
  /** one query per line; empty means "build them from the target" */
  webQueries: string;
  maxQueries: string;
}

/** The queries the campaign form shows under "Queries that will be used": typed lines win, otherwise they are built from the target. */
export function previewWebQueries(f: WebQueryForm): string[] {
  const max = Number(f.maxQueries);
  return buildDiscoveryQueries({
    industries: items(f.industries),
    countries: items(f.countries),
    developerKeywords: items(f.keywordsInclude),
    custom: typedLines(f.webQueries),
    max: Number.isInteger(max) && max >= 1 ? Math.min(max, 50) : DEFAULT_WEB_MAX_QUERIES,
  });
}

/** Ticked lead sources from the form, in the fixed order csv, apollo, web, without anything unknown. */
export function orderSources(ticked: string[]): LeadSource[] {
  return LEAD_SOURCES.filter((s) => ticked.includes(s));
}

const SOURCE_SHORT: Record<LeadSource, string> = { csv: "CSV", apollo: "Apollo", web: "Web" };
export const sourceShort = (s: LeadSource): string => SOURCE_SHORT[s];
