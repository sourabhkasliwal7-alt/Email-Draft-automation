import { describe, expect, it } from "vitest";
import { createAdapters, createLiveApollo, employeeRange, toQuery, type ApolloRevealFlags } from "../src";

const KEY = "APOLLO-SECRET-KEY-123";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NO_FLAGS: ApolloRevealFlags = { revealPersonalEmails: false, revealPhoneNumber: false, waterfallEmail: false, waterfallPhone: false, webhookUrl: null };

interface Seen {
  method: string;
  url: URL;
  headers: Record<string, string>;
}
function apollo(route: (url: URL, method: string) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    seen.push({ method: String(init.method), url: u, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
    return route(u, String(init.method));
  }) as unknown as typeof fetch;
  return { adapter: createLiveApollo({ apiKey: KEY, fetchImpl }), seen };
}

const ORGS = {
  organizations: [
    { id: "org-1", name: "Acme Software, Inc.", primary_domain: "acme.io", estimated_num_employees: 80 },
    { id: "org-2", name: "Beta Labs", website_url: "https://www.betalabs.com/about", estimated_num_employees: 40 },
    { id: "org-3", name: "No Site Ltd" },
  ],
  pagination: { page: 1, per_page: 100, total_entries: 230, total_pages: 3 },
};
const PEOPLE = {
  total_entries: 4,
  people: [
    { id: "p1", first_name: "Asha", last_name_obfuscated: "Ra***", title: "Head of Engineering", organization: { name: "Acme Software" } },
    { id: "p2", first_name: "Ben", last_name_obfuscated: "Mi***", title: "CTO", organization: { name: "BETA LABS" } },
    { id: "p3", first_name: "Cleo", title: "Founder", organization: { name: "Unknown Co" } }, // company not in the list: left out
    { id: "p4", first_name: null, title: "CEO", organization: { name: "Acme Software" } }, // no first name: left out
  ],
};

describe("Apollo live adapter: search", () => {
  const filters = { titles: ["Head of Engineering", "CTO"], seniorities: ["head", "c_suite"], keywords: ["software", "agency"], locations: ["United States"], employeeMin: 10, employeeMax: 200, hiringTitles: ["developer"], minOpenJobs: 2 };

  it("finds the companies first (that is where the website is), then the people at them, and returns people with a website", async () => {
    const { adapter, seen } = apollo((u) => (u.pathname.endsWith("/mixed_companies/search") ? json(200, ORGS) : json(200, PEOPLE)));
    const r = await adapter.searchPeople(filters, 2);

    expect(seen.map((s) => s.url.pathname)).toEqual(["/api/v1/mixed_companies/search", "/api/v1/mixed_people/api_search"]);
    expect(seen.every((s) => s.method === "POST" && s.headers["x-api-key"] === KEY)).toBe(true);
    expect(seen.every((s) => !s.url.toString().includes(KEY))).toBe(true); // the key travels in a header only

    const org = seen[0]!.url.searchParams;
    expect(org.getAll("q_organization_keyword_tags[]")).toEqual(["software", "agency"]);
    expect(org.getAll("organization_locations[]")).toEqual(["United States"]);
    expect(org.getAll("organization_num_employees_ranges[]")).toEqual(["10,200"]);
    expect(org.getAll("q_organization_job_titles[]")).toEqual(["developer"]);
    expect(org.get("organization_num_jobs_range[min]")).toBe("2");
    expect(org.get("page")).toBe("2");
    expect(org.get("per_page")).toBe("100");

    const ppl = seen[1]!.url.searchParams;
    expect(ppl.getAll("organization_ids[]")).toEqual(["org-1", "org-2"]); // only companies with a website
    expect(ppl.getAll("person_titles[]")).toEqual(["Head of Engineering", "CTO"]);
    expect(ppl.getAll("person_seniorities[]")).toEqual(["head", "c_suite"]);

    expect(r.people).toEqual([
      { id: "p1", firstName: "Asha", lastName: "Ra***", title: "Head of Engineering", linkedinUrl: null, country: null, organization: { name: "Acme Software, Inc.", domain: "acme.io", industry: null, employeeCount: 80 } },
      { id: "p2", firstName: "Ben", lastName: "Mi***", title: "CTO", linkedinUrl: null, country: null, organization: { name: "Beta Labs", domain: "betalabs.com", industry: null, employeeCount: 40 } },
    ]);
    expect(r).toMatchObject({ page: 2, totalPages: 3, totalEntries: 4 });
    // the company page costs 1 credit; the people search is free
    expect(r.usage.units).toEqual({ credit: 1 });
  });

  it("refuses a search with no company filter instead of listing random companies", async () => {
    const { adapter, seen } = apollo(() => json(200, {}));
    await expect(adapter.searchPeople({ titles: ["CEO"], seniorities: [], keywords: [], locations: [] }, 1)).rejects.toThrow(/at least one company filter/);
    expect(seen).toHaveLength(0);
  });

  it("returns nothing (and asks nothing more) when no company has a website", async () => {
    const { adapter, seen } = apollo(() => json(200, { organizations: [{ id: "o", name: "No Site" }], pagination: { total_pages: 1, total_entries: 1 } }));
    const r = await adapter.searchPeople({ ...filters }, 1);
    expect(r.people).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("builds Apollo's query text: lists as key[]=v, ranges as lower,upper", () => {
    expect(toQuery({ a: ["x", "y"], b: 3, c: false, d: undefined })).toBe("a%5B%5D=x&a%5B%5D=y&b=3&c=false");
    expect(employeeRange(10, 200)).toBe("10,200");
    expect(employeeRange(50, null)).toBe("50,1000000");
    expect(employeeRange(null, 20)).toBe("1,20");
    expect(employeeRange(null, null)).toBeNull();
  });
});

describe("Apollo live adapter: revealing an email (the only call that costs a credit)", () => {
  it("asks for the work email only: personal emails, phone, waterfall off, no webhook; 1 credit when an email comes back", async () => {
    const { adapter, seen } = apollo(() => json(200, { person: { email: "Asha.Rao@Acme.io", email_status: "verified" } }));
    const r = await adapter.revealEmail({ personId: "p1", flags: NO_FLAGS });
    expect(r).toEqual({ email: "asha.rao@acme.io", usage: { units: { credit: 1 } } });
    const q = seen[0]!.url.searchParams;
    expect(seen[0]!.url.pathname).toBe("/api/v1/people/match");
    expect(q.get("id")).toBe("p1");
    for (const flag of ["reveal_personal_emails", "reveal_phone_number", "run_waterfall_email", "run_waterfall_phone"]) expect(q.get(flag), flag).toBe("false");
    expect(q.has("webhook_url")).toBe(false);
    expect(q.has("poll_only")).toBe(false);
  });

  it("no email, or Apollo's 'not unlocked' placeholder, means no email and no credit", async () => {
    for (const person of [{ email: null }, {}, { email: "email_not_unlocked@acme.io" }]) {
      const { adapter } = apollo(() => json(200, { person }));
      expect(await adapter.revealEmail({ personId: "p1", flags: NO_FLAGS })).toEqual({ email: null, usage: { units: { credit: 0 } } });
    }
    const gone = apollo(() => json(200, { person: null }));
    expect((await gone.adapter.revealEmail({ personId: "p1", flags: NO_FLAGS })).email).toBeNull();
  });

  it("refuses to reveal anything but the email, even if a caller asks", async () => {
    const { adapter, seen } = apollo(() => json(200, { person: { email: "a@b.co" } }));
    const bad = [{ ...NO_FLAGS, revealPhoneNumber: true }, { ...NO_FLAGS, revealPersonalEmails: true }, { ...NO_FLAGS, waterfallEmail: true }, { ...NO_FLAGS, waterfallPhone: true }, { ...NO_FLAGS, webhookUrl: "https://x.test" }];
    for (const flags of bad) await expect(adapter.revealEmail({ personId: "p1", flags: flags as unknown as ApolloRevealFlags })).rejects.toThrow(/work email/);
    expect(seen).toHaveLength(0);
  });
});

describe("Apollo live adapter: errors are sentences, and never contain the key", () => {
  const status = (code: number, body = "") => apollo(() => new Response(body, { status: code }));
  it("explains 401, 403 (plan), 422 and 429", async () => {
    const f = { titles: [], seniorities: [], keywords: ["x"], locations: [] };
    const e401 = await status(401, `bad key ${KEY}`).adapter.searchPeople(f, 1).then(() => new Error("none"), (e: Error) => e);
    expect(e401.message).toMatch(/rejected the API key.*APOLLO_API_KEY/);
    const e403 = await status(403, "not allowed").adapter.searchPeople(f, 1).then(() => new Error("none"), (e: Error) => e);
    expect(e403.message).toMatch(/paid Apollo plan with API access, or a master API key/);
    const e422 = await status(422, "bad params").adapter.revealEmail({ personId: "p", flags: NO_FLAGS }).then(() => new Error("none"), (e: Error) => e);
    expect(e422.message).toMatch(/did not accept/);
    const e429 = await status(429).adapter.revealEmail({ personId: "p", flags: NO_FLAGS }).then(() => new Error("none"), (e: Error) => e);
    expect(e429.message).toMatch(/rate limiting/);
    for (const e of [e401, e403, e422, e429]) expect(e.message).not.toContain(KEY);
  });
});

describe("Apollo live adapter: Test connection checks (no credit is used)", () => {
  it("all good: key valid, people search works, reveal reachable", async () => {
    const { adapter, seen } = apollo((u) => (u.pathname.endsWith("/auth/health") ? json(200, { healthy: true, is_logged_in: true }) : u.pathname.endsWith("/api_search") ? json(200, { total_entries: 1234, people: [] }) : json(200, { person: null })));
    const r = await adapter.checkAccess();
    expect(r.health.ok && r.search.ok && r.reveal.ok).toBe(true);
    expect(r.search.message).toContain("1234");
    expect(r.usage.units).toEqual({ credit: 0 });
    // the reveal probe uses an id that cannot exist and never the real flags on a real person
    const probe = seen.find((s) => s.url.pathname.endsWith("/people/match"))!;
    expect(probe.url.searchParams.get("id")).toBe("000000000000000000000000");
    expect(probe.url.searchParams.get("reveal_phone_number")).toBe("false");
  });

  it("a plan without API access: search and reveal are refused with a plain message", async () => {
    const { adapter } = apollo((u) => (u.pathname.endsWith("/auth/health") ? json(200, { healthy: true, is_logged_in: true }) : new Response("only paid", { status: 403 })));
    const r = await adapter.checkAccess();
    expect(r.health.ok).toBe(true);
    expect(r.search.ok).toBe(false);
    expect(r.search.message).toMatch(/paid Apollo plan with API access/);
    expect(r.reveal.ok).toBe(false);
  });

  it("a bad key stops after the key check", async () => {
    const { adapter, seen } = apollo(() => new Response("nope", { status: 401 }));
    const r = await adapter.checkAccess();
    expect(r.health.ok).toBe(false);
    expect(r.health.message).toMatch(/rejected the API key/);
    expect(seen).toHaveLength(1);
  });

  it("an unhealthy key says what to check", async () => {
    const { adapter } = apollo(() => json(200, { healthy: false, is_logged_in: false }));
    expect((await adapter.checkAccess()).health.message).toMatch(/extra spaces or line breaks/);
  });
});

describe("Apollo wiring", () => {
  it("ADAPTER_APOLLO=live needs APOLLO_API_KEY and builds the real adapter; mock stays the default", () => {
    expect(() => createAdapters({ ADAPTER_APOLLO: "live" })).toThrow(/APOLLO_API_KEY is required/);
    expect(createAdapters({ ADAPTER_APOLLO: "live", APOLLO_API_KEY: "k" }).apollo.checkAccess).toBeTypeOf("function");
    expect(createAdapters({}).modes.apollo).toBe("mock");
  });
  it("the demo adapter answers the access check without a key", async () => {
    const r = await createAdapters({}).apollo.checkAccess();
    expect(r.health.ok && r.search.ok && r.reveal.ok).toBe(true);
    expect(r.health.message).toMatch(/Demo mode/);
  });
});
