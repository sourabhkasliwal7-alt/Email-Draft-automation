import { describe, expect, it } from "vitest";
import { createLiveApollo, mockApollo, mockApolloPeopleAt, mockQuerySlug, mockSearch } from "../src";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NO_FLAGS = { revealPersonalEmails: false, revealPhoneNumber: false, waterfallEmail: false, waterfallPhone: false, webhookUrl: null } as const;
const FILTERS = { titles: ["Head of Operations"], seniorities: ["head"], keywords: [], locations: [] };

describe("Apollo live adapter: people at known company websites (web discovery)", () => {
  function apollo(route: (u: URL) => Response) {
    const seen: URL[] = [];
    const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      seen.push(u);
      return route(u);
    }) as unknown as typeof fetch;
    return { adapter: createLiveApollo({ apiKey: "K", fetchImpl }), seen };
  }

  it("asks the free people search once per website, and never runs the paid company search", async () => {
    const { adapter, seen } = apollo((u) =>
      json(200, {
        total_entries: 1,
        people: u.searchParams.getAll("q_organization_domains_list[]")[0] === "acme.io"
          ? [{ id: "p1", first_name: "Asha", last_name_obfuscated: "Ra***", title: "Head of Operations", organization: { name: "Acme Software" } }, { id: "p2", first_name: null, title: "CEO" }]
          : [],
      }),
    );
    const r = await adapter.searchPeople({ ...FILTERS, domains: ["acme.io", "ghost.example"] }, 1);

    expect(seen.map((u) => u.pathname)).toEqual(["/api/v1/mixed_people/api_search", "/api/v1/mixed_people/api_search"]); // no /mixed_companies/search: that one costs a credit
    expect(seen.map((u) => u.searchParams.getAll("q_organization_domains_list[]"))).toEqual([["acme.io"], ["ghost.example"]]);
    expect(seen[0]!.searchParams.getAll("person_titles[]")).toEqual(["Head of Operations"]);
    expect(seen[0]!.searchParams.getAll("person_seniorities[]")).toEqual(["head"]);
    expect(seen[0]!.toString()).not.toContain("K&"); // the key travels in a header only
    expect(r.usage.units).toEqual({ credit: 0 });
    // the person belongs to the website that was asked for, a person without a first name is left out
    expect(r.people).toEqual([{ id: "p1", firstName: "Asha", lastName: "Ra***", title: "Head of Operations", linkedinUrl: null, country: null, organization: { name: "Acme Software", domain: "acme.io", industry: null, employeeCount: null } }]);
  });

  it("explains an Apollo refusal in plain words", async () => {
    const { adapter } = apollo(() => json(403, { error: "no" }));
    await expect(adapter.searchPeople({ ...FILTERS, domains: ["acme.io"] }, 1)).rejects.toThrow(/cannot use people search \(403\)/);
  });
});

describe("mock search: web discovery results", () => {
  it("answers a discovery query with company sites mixed with directories, job boards, social and news", async () => {
    const { results, usage } = await mockSearch.search({ query: "logistics agency india", num: 10 });
    expect(usage.units).toEqual({ search: 1 });
    expect(results).toHaveLength(10);
    const hosts = results.map((r) => new URL(r.url).hostname.replace(/^www\./, ""));
    expect(hosts).toEqual(expect.arrayContaining(["linkedin.com", "clutch.co", "indeed.com", "forbes.com"]));
    expect(hosts.filter((h) => h.startsWith("web-"))).toHaveLength(3); // two sites, one of them twice
    expect(hosts.some((h) => h.startsWith("nofit-"))).toBe(true);
    expect(hosts.some((h) => h.startsWith("nocontact-"))).toBe(true);
    expect(hosts.some((h) => h.startsWith("down-"))).toBe(true);
    expect((await mockSearch.search({ query: "logistics agency india", num: 3 })).results).toHaveLength(3);
  });

  it("is the same for the same query, and a company name never looks like a discovery query", async () => {
    expect(await mockSearch.search({ query: "x agency", num: 10 })).toEqual(await mockSearch.search({ query: "x agency", num: 10 }));
    expect(mockQuerySlug("Fintech Agency  India!")).toBe("fintech-india");
    const research = await mockSearch.search({ query: "Web Fintech India funding", num: 3 });
    expect(research.results[0]!.url).toMatch(/^https:\/\/news\.example\.com\//); // research queries keep their old answers
  });
});

describe("mock Apollo: people at company websites", () => {
  it("gives the same three people for a website, and nobody at a nocontact- website", async () => {
    expect(mockApolloPeopleAt("web-a.example.com").map((p) => p.title)).toEqual(["Head of Operations", "CTO", "Marketing Manager"]);
    expect(mockApolloPeopleAt("web-a.example.com")).toEqual(mockApolloPeopleAt("web-a.example.com"));
    expect(mockApolloPeopleAt("nocontact-a.example.com")).toEqual([]);
    const r = await mockApollo.searchPeople({ ...FILTERS, seniorities: [], domains: ["web-a.example.com", "nocontact-a.example.com"] }, 1);
    expect(r.people.map((p) => p.title)).toEqual(["Head of Operations"]); // narrowed to the target title
    expect(r.people[0]!.organization).toMatchObject({ domain: "web-a.example.com" });
    expect(r.usage.units).toEqual({ credit: 0 });
  });

  it("reveals made-up work emails only for these people, and nothing for a noemail- website", async () => {
    const [p] = mockApolloPeopleAt("web-a.example.com");
    const ok = await mockApollo.revealEmail({ personId: p!.id, flags: NO_FLAGS });
    expect(ok.email).toBe(`${p!.firstName}.${p!.lastName}@web-a.example.com`.toLowerCase());
    expect(ok.usage.units).toEqual({ credit: 1 });
    const [q] = mockApolloPeopleAt("noemail-a.example.com");
    expect((await mockApollo.revealEmail({ personId: q!.id, flags: NO_FLAGS })).email).toBeNull();
  });
});
