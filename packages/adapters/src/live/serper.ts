import type { SearchAdapter } from "../types";
import { requestJson, type FetchLike } from "./http";

const URL_SEARCH = "https://google.serper.dev/search";

const UNIT_DAYS: Record<string, number> = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 };

/**
 * Serper dates are free text ("Sep 1, 2026", "3 days ago"). Only a date we can read with confidence is returned,
 * as YYYY-MM-DD; anything else is left out so a bad date can never make a fact look stale or fresh by accident.
 */
export function parseSerperDate(raw: unknown, now = new Date()): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const rel = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(raw.trim());
  if (rel) {
    const d = new Date(now.getTime() - Number(rel[1]) * UNIT_DAYS[rel[2]!.toLowerCase()]! * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (/^(yesterday)$/i.test(raw.trim())) return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const t = Date.parse(`${raw.trim()} UTC`);
  if (Number.isNaN(t)) return undefined;
  const iso = new Date(t).toISOString();
  return new Date(t).getTime() > now.getTime() + 86_400_000 ? undefined : iso.slice(0, 10);
}

export function createLiveSearch(opts: { apiKey: string; fetchImpl?: FetchLike }): SearchAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async search({ query, num = 5 }) {
      const json = await requestJson<{ organic?: { title?: string; link?: string; snippet?: string; date?: string }[] }>(
        fetchImpl,
        URL_SEARCH,
        { method: "POST", headers: { "x-api-key": opts.apiKey, "content-type": "application/json" }, body: JSON.stringify({ q: query, num: Math.min(Math.max(num, 1), 10) }) },
        { label: "Serper search", redact: [opts.apiKey] },
      );
      const results = (json.organic ?? [])
        .filter((r) => r.link && r.title)
        .slice(0, num)
        .map((r) => ({ title: r.title!, url: r.link!, snippet: r.snippet ?? "", publishedAt: parseSerperDate(r.date) }));
      // one search = one billing unit (num <= 10)
      return { results, usage: { units: { search: 1 } } };
    },
  };
}
