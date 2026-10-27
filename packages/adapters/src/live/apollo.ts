import type { ApolloAccessReport, ApolloAdapter, ApolloFilters, ApolloPerson, ApolloRevealFlags } from "../types";
import { HttpError, redactText, type FetchLike } from "./http";

/**
 * Apollo REST API, built from Apollo's published reference (docs.apollo.io):
 *  - Organization Search  POST /api/v1/mixed_companies/search   1 credit per page of up to 100 companies; returns the company website/domain
 *  - People API Search    POST /api/v1/mixed_people/api_search  0 credits; no emails; the last name is hidden; no company domain
 *  - People Enrichment    POST /api/v1/people/match             1 credit when an email is found; this is the ONLY call that reveals an email
 * Parameters travel in the query string (that is how Apollo documents them) and the key goes in the `x-api-key` header.
 * People search does not return a company website, so the search first finds the matching COMPANIES (with their domain),
 * then asks for the people at those companies. A person whose company cannot be matched is left out: no website, no research.
 */
export const APOLLO_BASE = "https://api.apollo.io/api/v1";

export interface ApolloOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
}

/** Apollo's own seniority names (people search `person_seniorities[]`). */
export const APOLLO_SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior"] as const;

type Params = Record<string, string | number | boolean | (string | number)[] | undefined>;

/** `key[]=a&key[]=b` for lists, plain `key=value` otherwise. */
export function toQuery(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) q.append(`${k}[]`, String(item));
    else q.append(k, String(v));
  }
  return q.toString();
}

/** "10 to 200 employees" -> Apollo's `lower,upper` range text. */
export function employeeRange(min?: number | null, max?: number | null): string | null {
  if (min == null && max == null) return null;
  return `${min ?? 1},${max ?? 1_000_000}`;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|plc)\b/g, " ").replace(/\s+/g, " ").trim();
const domainOf = (org: { primary_domain?: string | null; website_url?: string | null }): string | null => {
  const raw = org.primary_domain || org.website_url;
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/** Apollo hands out a placeholder instead of an email it has not unlocked. */
const isPlaceholderEmail = (e: string) => /email_not_unlocked|not_unlocked|\*{3}/i.test(e);

interface ApolloOrg {
  id: string;
  name?: string;
  primary_domain?: string | null;
  website_url?: string | null;
  estimated_num_employees?: number | null;
  industry?: string | null;
}
interface ApolloPersonRow {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  organization?: { id?: string; name?: string } | null;
}

export function createLiveApollo(opts: ApolloOptions): ApolloAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const secret = [opts.apiKey];

  /** One Apollo call. Errors are turned into sentences a person can act on; the key never appears in them. */
  async function call<T>(method: "GET" | "POST", path: string, params: Params, what: string): Promise<T> {
    const url = `${APOLLO_BASE}${path}${Object.keys(params).length ? `?${toQuery(params)}` : ""}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers: { "x-api-key": opts.apiKey, "content-type": "application/json", "cache-control": "no-cache", accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(`Apollo ${what} failed: ${redactText((e as Error).message, secret)}`);
    }
    const text = await res.text();
    if (res.ok) return (text ? JSON.parse(text) : {}) as T;
    throw new HttpError(res.status, apolloMessage(res.status, what, text, secret), text);
  }

  return {
    async searchPeople(filters, page) {
      const orgFilters = organizationFilters(filters);
      if (!orgFilters.hasCompanyFilter) {
        throw new Error("Apollo search needs at least one company filter (industry or keywords, a country, an employee range, or hiring). Add one to the campaign.");
      }
      // 1) the companies (1 credit per page of up to 100): this is where the website comes from
      const orgs = await call<{ organizations?: ApolloOrg[]; accounts?: ApolloOrg[]; pagination?: { total_pages?: number; total_entries?: number } }>("POST", "/mixed_companies/search", { ...orgFilters.params, page, per_page: 100 }, "company search");
      const companies = [...(orgs.organizations ?? []), ...(orgs.accounts ?? [])].filter((o) => o.id && o.name);
      const byName = new Map<string, ApolloOrg>();
      for (const o of companies) if (domainOf(o)) byName.set(norm(o.name!), o);
      const totalPages = Math.max(1, orgs.pagination?.total_pages ?? 1);
      const usage = { units: { credit: 1 } };
      if (!byName.size) return { people: [], page, totalPages, totalEntries: orgs.pagination?.total_entries ?? 0, usage };

      // 2) the people at those companies (free), 25 companies per request so the address stays short
      const ids = [...new Map(companies.filter((o) => byName.has(norm(o.name!))).map((o) => [o.id, o])).keys()];
      const people: ApolloPerson[] = [];
      let totalEntries = 0;
      for (let i = 0; i < ids.length; i += 25) {
        const res = await call<{ people?: ApolloPersonRow[]; total_entries?: number }>(
          "POST",
          "/mixed_people/api_search",
          {
            "organization_ids": ids.slice(i, i + 25),
            person_titles: filters.titles.length ? filters.titles : undefined,
            person_seniorities: filters.seniorities.length ? filters.seniorities : undefined,
            per_page: Math.min(filters.perPage ?? 100, 100),
            page: 1,
          },
          "people search",
        );
        totalEntries += res.total_entries ?? 0;
        for (const p of res.people ?? []) {
          const org = p.organization?.name ? byName.get(norm(p.organization.name)) : undefined;
          if (!p.id || !p.first_name || !org) continue; // no first name or no matching company website: nothing to research or write to
          people.push({
            id: p.id,
            firstName: p.first_name,
            lastName: p.last_name ?? p.last_name_obfuscated ?? "",
            title: p.title ?? null,
            linkedinUrl: p.linkedin_url ?? null,
            country: null,
            organization: { name: org.name!, domain: domainOf(org), industry: org.industry ?? null, employeeCount: org.estimated_num_employees ?? null },
          });
        }
      }
      return { people, page, totalPages, totalEntries, usage };
    },

    async getOrganization(domain) {
      const res = await call<{ organization?: { name?: string; primary_domain?: string; industry?: string; estimated_num_employees?: number; country?: string } | null }>("GET", "/organizations/enrich", { domain }, "company lookup");
      const o = res.organization;
      return { org: o?.name ? { name: o.name, domain: o.primary_domain ?? domain, industry: o.industry ?? null, employeeCount: o.estimated_num_employees ?? null, country: o.country ?? null } : null, usage: { units: { credit: 0 } } };
    },

    async revealEmail({ personId, flags }) {
      assertEmailOnly(flags);
      // email only: personal emails, phone numbers and the waterfall are switched off explicitly, and no webhook is given
      const res = await call<{ person?: { email?: string | null } | null }>(
        "POST",
        "/people/match",
        { id: personId, reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false },
        "email reveal",
      );
      const email = res.person?.email?.trim().toLowerCase() ?? null;
      const usable = email && !isPlaceholderEmail(email) ? email : null;
      return { email: usable, usage: { units: { credit: usable ? 1 : 0 } } };
    },

    /** Free checks only: the key, people search access, and whether the reveal call is reachable on this plan (nothing is unlocked). */
    async checkAccess(): Promise<ApolloAccessReport> {
      const report: ApolloAccessReport = { health: { ok: false, message: "" }, search: { ok: false, message: "" }, reveal: { ok: false, message: "" }, usage: { units: { credit: 0 } } };
      try {
        const h = await call<{ healthy?: boolean; is_logged_in?: boolean }>("GET", "/auth/health", {}, "key check");
        report.health = h.healthy && h.is_logged_in ? { ok: true, message: "The key is valid." } : { ok: false, message: "Apollo does not accept this key (check APOLLO_API_KEY for extra spaces or line breaks)." };
      } catch (e) {
        report.health = { ok: false, message: (e as Error).message };
        return report; // nothing else can work without a valid key
      }
      try {
        const r = await call<{ total_entries?: number }>("POST", "/mixed_people/api_search", { person_titles: ["founder"], per_page: 1, page: 1 }, "people search");
        report.search = { ok: true, message: `People search works (${r.total_entries ?? "some"} matches for a test search; it costs no credits).` };
      } catch (e) {
        report.search = { ok: false, message: (e as Error).message };
      }
      try {
        // a person id that cannot exist: Apollo answers "no match" for free when the call is allowed, and refuses with 403 when the plan or key cannot reveal emails
        await call("POST", "/people/match", { id: "000000000000000000000000", reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false }, "email reveal");
        report.reveal = { ok: true, message: "Email reveal is available on this key (checked without using a credit)." };
      } catch (e) {
        if (e instanceof HttpError && (e.status === 404 || e.status === 422 || e.status === 400)) report.reveal = { ok: true, message: "Email reveal answered (no credit used). It is reachable on this key." };
        else report.reveal = { ok: false, message: (e as Error).message };
      }
      return report;
    },
  };
}

/** Company-level filters. `hasCompanyFilter` is false when nothing narrows the companies, so we refuse instead of listing random ones. */
function organizationFilters(f: ApolloFilters): { params: Params; hasCompanyFilter: boolean } {
  const range = employeeRange(f.employeeMin, f.employeeMax);
  const params: Params = {
    q_organization_keyword_tags: f.keywords.length ? f.keywords : undefined,
    organization_locations: f.locations.length ? f.locations : undefined,
    organization_num_employees_ranges: range ? [range] : undefined,
    q_organization_job_titles: f.hiringTitles?.length ? f.hiringTitles : undefined,
    "organization_num_jobs_range[min]": f.minOpenJobs != null ? f.minOpenJobs : undefined,
  };
  return { params, hasCompanyFilter: Object.values(params).some((v) => v !== undefined) };
}

/** The reveal call is for the email only. Anything else is refused here even if a caller asks for it. */
function assertEmailOnly(flags: ApolloRevealFlags) {
  if (flags.revealPersonalEmails !== false || flags.revealPhoneNumber !== false || flags.waterfallEmail !== false || flags.waterfallPhone !== false || flags.webhookUrl !== null) {
    throw new Error("Refusing to reveal anything but the work email (no personal email, phone, waterfall or webhook).");
  }
}

function apolloMessage(status: number, what: string, body: string, secrets: string[]): string {
  const detail = redactText(body.replace(/\s+/g, " ").slice(0, 200), secrets);
  if (status === 401) return `Apollo rejected the API key (401) during ${what}: check APOLLO_API_KEY.`;
  if (status === 403) return `Apollo says this key or plan cannot use ${what} (403). It needs a paid Apollo plan with API access, or a master API key. ${detail}`.trim();
  if (status === 422) return `Apollo did not accept the ${what} request (422): ${detail}`;
  if (status === 429) return `Apollo is rate limiting this key (429) during ${what}: wait a few minutes.`;
  return `Apollo ${what} failed (${status}): ${detail}`;
}
