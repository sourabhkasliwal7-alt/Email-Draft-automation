import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  EnvError,
  assertAdapterEnv,
  createAdapters,
  createLiveFetcher,
  createLiveLlm,
  createLiveSearch,
  createLiveVerifier,
  htmlToText,
  isPrivateAddress,
  mapZeroBounceStatus,
  parseRobots,
  parseSerperDate,
  robotsAllows,
  requestJson,
  type MessagesClientLike,
} from "../src";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------- Claude
describe("live LLM (Anthropic SDK)", () => {
  function stub(reply: Partial<Anthropic.Message> & { content: Anthropic.Message["content"] }) {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClientLike = {
      messages: {
        async create(params) {
          calls.push(params);
          return { id: "msg_1", type: "message", role: "assistant", model: params.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 }, ...reply } as unknown as Anthropic.Message;
        },
      },
    };
    return { client, calls };
  }

  it("calls the model named in the request and reports raw usage units for the price table", async () => {
    const { client, calls } = stub({ content: [{ type: "text", text: '{"ok":true}', citations: null }] as never });
    const r = await createLiveLlm({ apiKey: "k", client }).complete({ tier: "cheap", model: "claude-haiku-5-5", system: "sys", prompt: "hello", maxTokens: 200 });
    expect(r.text).toBe('{"ok":true}');
    expect(r.usage.units).toEqual({ input_token: 120, output_token: 30 });
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", system: "sys", messages: [{ role: "user", content: "hello" }] });
    expect(calls[0]!.output_config).toEqual({ effort: "low" });
  });

  it("never lets a small max_tokens starve the answer, and sends no sampling parameters", async () => {
    const { client, calls } = stub({ content: [{ type: "text", text: "x", citations: null }] as never });
    await createLiveLlm({ apiKey: "k", client }).complete({ tier: "strong", prompt: "p", maxTokens: 200 });
    expect(calls[0]!.max_tokens).toBeGreaterThanOrEqual(1024);
    expect(calls[0]).not.toHaveProperty("temperature");
    expect(calls[0]).not.toHaveProperty("top_p");
    expect(calls[0]!.model).toBe("claude-sonnet-5-5"); // the strong default when the request names none
  });

  it("does not send effort to a model that does not take it", async () => {
    const { client, calls } = stub({ content: [{ type: "text", text: "x", citations: null }] as never });
    await createLiveLlm({ apiKey: "k", client }).complete({ tier: "cheap", model: "claude-haiku-4-5", prompt: "p" });
    expect(calls[0]).not.toHaveProperty("output_config");
  });

  it("surfaces a refusal and an empty answer as errors instead of returning blank text", async () => {
    const refusal = stub({ stop_reason: "refusal", content: [] });
    await expect(createLiveLlm({ apiKey: "k", client: refusal.client }).complete({ tier: "cheap", prompt: "p" })).rejects.toThrow(/declined/);
    const empty = stub({ content: [{ type: "thinking", thinking: "", signature: "s" }] as never });
    await expect(createLiveLlm({ apiKey: "k", client: empty.client }).complete({ tier: "cheap", prompt: "p" })).rejects.toThrow(/no text/);
  });
});

// ---------------------------------------------------------------- Serper
describe("live search (Serper)", () => {
  it("posts the query with the key in a header and counts one search", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return json(200, { organic: [{ title: "Acme raises seed", link: "https://news.example.com/acme", snippet: "Acme raised a seed round.", date: "2 days ago" }, { title: "no link" }] });
    }) as unknown as typeof fetch;
    const r = await createLiveSearch({ apiKey: "SERPER-KEY-123", fetchImpl }).search({ query: "Acme funding", num: 3 });
    expect(seen!.url).toBe("https://google.serper.dev/search");
    expect((seen!.init.headers as Record<string, string>)["x-api-key"]).toBe("SERPER-KEY-123");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ q: "Acme funding", num: 3 });
    expect(r.usage.units).toEqual({ search: 1 });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ url: "https://news.example.com/acme", snippet: "Acme raised a seed round." });
    expect(r.results[0]!.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("only returns dates it can read, so a bad date never reaches the staleness check", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    expect(parseSerperDate("3 days ago", now)).toBe("2026-10-24");
    expect(parseSerperDate("Sep 1, 2026", now)).toBe("2026-09-01");
    expect(parseSerperDate("sometime last spring", now)).toBeUndefined();
    expect(parseSerperDate(undefined, now)).toBeUndefined();
    expect(parseSerperDate("Dec 31, 2030", now)).toBeUndefined();
  });
  it("an HTTP error names the provider and never contains the key", async () => {
    const fetchImpl = (async () => new Response("bad key SERPER-KEY-123", { status: 403 })) as unknown as typeof fetch;
    const err = await createLiveSearch({ apiKey: "SERPER-KEY-123", fetchImpl }).search({ query: "x" }).then(() => new Error("no error"), (e: Error) => e);
    expect(err.message).toMatch(/Serper search failed \(403\)/);
    expect(err.message).not.toContain("SERPER-KEY-123");
  });
});

// ---------------------------------------------------------------- ZeroBounce
describe("live verifier (ZeroBounce)", () => {
  it("maps every ZeroBounce status to ours, and never to valid by accident", () => {
    expect(mapZeroBounceStatus("valid")).toBe("valid");
    for (const s of ["invalid", "spamtrap", "abuse", "do_not_mail"]) expect(mapZeroBounceStatus(s)).toBe("invalid");
    expect(mapZeroBounceStatus("catch-all")).toBe("catch_all");
    expect(mapZeroBounceStatus("unknown")).toBe("unknown");
    expect(mapZeroBounceStatus("something-new")).toBe("unknown");
    expect(mapZeroBounceStatus(undefined)).toBe("unknown");
  });
  it("validates one address and counts one verification", async () => {
    let url = "";
    const fetchImpl = (async (u: string) => {
      url = u;
      return json(200, { address: "a@b.com", status: "valid", sub_status: "" });
    }) as unknown as typeof fetch;
    const r = await createLiveVerifier({ apiKey: "ZB-KEY-999", fetchImpl }).verify("a@b.com");
    expect(r).toEqual({ status: "valid", usage: { units: { verification: 1 } } });
    expect(new URL(url).searchParams.get("email")).toBe("a@b.com");
  });
  it("an API-level error (bad key, no credits) is an error, not a verdict, and hides the key", async () => {
    const fetchImpl = (async () => json(200, { error: "Invalid API key ZB-KEY-999" })) as unknown as typeof fetch;
    const err = await createLiveVerifier({ apiKey: "ZB-KEY-999", fetchImpl }).verify("a@b.com").then(() => new Error("no error"), (e: Error) => e);
    expect(err.message).toMatch(/Invalid API key/);
    expect(err.message).not.toContain("ZB-KEY-999");
  });
  it("accepts the key under VERIFIER_API_KEY or ZEROBOUNCE_API_KEY", () => {
    expect(() => assertAdapterEnv({ ADAPTER_VERIFIER: "live", ZEROBOUNCE_API_KEY: "k" })).not.toThrow();
    expect(() => assertAdapterEnv({ ADAPTER_VERIFIER: "live", VERIFIER_API_KEY: "k" })).not.toThrow();
    expect(() => assertAdapterEnv({ ADAPTER_VERIFIER: "live" })).toThrow(EnvError);
    expect(() => assertAdapterEnv({ ADAPTER_VERIFIER: "live" })).toThrow(/ZEROBOUNCE_API_KEY/);
  });
});

// ---------------------------------------------------------------- page fetcher
describe("live fetcher: public pages only", () => {
  it("honours robots.txt: longest rule wins, wildcards and $ work, our own group beats *", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\n\nUser-agent: ai-outreach-engine\nDisallow: /careers-secret\n");
    expect(robotsAllows(rules, "/")).toBe(true);
    expect(robotsAllows(rules, "/private")).toBe(true); // the * group is ignored because our own group exists
    expect(robotsAllows(rules, "/careers-secret/x")).toBe(false);
    const star = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$");
    expect(robotsAllows(star, "/private/x")).toBe(false);
    expect(robotsAllows(star, "/private/open/y")).toBe(true);
    expect(robotsAllows(star, "/files/a.pdf")).toBe(false);
    expect(robotsAllows(star, "/files/a.pdf.html")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:"), "/anything")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /"), "/anything")).toBe(false);
  });

  it("turns HTML into readable text without scripts, styles or tags", () => {
    const t = htmlToText("<html><head><title>x</title><style>.a{}</style></head><body><script>evil()</script><h1>Acme &amp; Co</h1><p>We build&nbsp;software.</p><!-- hidden --><p>Hiring: Data Engineer</p></body></html>");
    expect(t).toContain("Acme & Co");
    expect(t).toContain("We build software.");
    expect(t).toContain("Hiring: Data Engineer");
    expect(t).not.toMatch(/evil|hidden|<|\.a\{/);
  });

  it("never reaches private or local addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1"]) expect(isPrivateAddress(ip)).toBe(false);
  });

  function site(pages: Record<string, { status?: number; type?: string; body?: string; location?: string }>, robots = "User-agent: *\nDisallow:") {
    const hits: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      hits.push(u.pathname);
      if (u.pathname === "/robots.txt") return new Response(robots, { status: 200 });
      const p = pages[u.host + u.pathname];
      if (!p) return new Response("", { status: 404 });
      const headers: Record<string, string> = { "content-type": p.type ?? "text/html; charset=utf-8" };
      if (p.location) headers.location = p.location;
      return new Response(p.body ?? "", { status: p.status ?? 200, headers });
    }) as unknown as typeof fetch;
    return { fetchImpl, hits };
  }
  const resolvePublic = async () => ["93.184.216.34"];

  it("reads a public page", async () => {
    const { fetchImpl } = site({ "acme.com/": { body: "<html><body><h1>Acme</h1><p>We build tools for logistics teams.</p></body></html>" } });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/");
    expect(r.status).toBe(200);
    expect(r.text).toContain("We build tools for logistics teams.");
  });
  it("does not fetch a page robots.txt forbids", async () => {
    const { fetchImpl, hits } = site({ "acme.com/careers": { body: "<p>jobs</p>" } }, "User-agent: *\nDisallow: /careers");
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/careers");
    expect(r).toMatchObject({ status: 403, text: "" });
    expect(hits).not.toContain("/careers");
  });
  it("reports logins, paywalls and CAPTCHAs as unreadable and does not try to get past them", async () => {
    const { fetchImpl } = site({
      "acme.com/login": { status: 401, body: "login" },
      "acme.com/wall": { body: "<html><body><h1>Verify you are human</h1><p>Complete the CAPTCHA to continue</p></body></html>" },
      "acme.com/file.pdf": { type: "application/pdf", body: "%PDF" },
    });
    const f = createLiveFetcher({ fetchImpl, resolve: resolvePublic });
    expect(await f.fetchPage("https://acme.com/login")).toMatchObject({ status: 401, text: "" });
    expect(await f.fetchPage("https://acme.com/wall")).toMatchObject({ status: 403, text: "" });
    expect(await f.fetchPage("https://acme.com/file.pdf")).toMatchObject({ status: 415, text: "" });
  });
  it("refuses local addresses, and a redirect that points at one", async () => {
    const { fetchImpl } = site({ "acme.com/go": { status: 302, location: "http://127.0.0.1/admin" } });
    const f = createLiveFetcher({ fetchImpl, resolve: async (h) => (h === "acme.com" ? ["93.184.216.34"] : ["127.0.0.1"]) });
    await expect(f.fetchPage("http://localhost/")).rejects.toThrow(/local/);
    await expect(f.fetchPage("http://intranet.corp/")).rejects.toThrow(/private/);
    await expect(f.fetchPage("https://acme.com/go")).rejects.toThrow(/private|local/);
    await expect(f.fetchPage("ftp://acme.com/")).rejects.toThrow(/protocol/);
  });
  it("follows a normal redirect and reports the final URL", async () => {
    const { fetchImpl } = site({ "acme.com/": { status: 301, location: "https://www.acme.com/" }, "www.acme.com/": { body: "<p>Welcome to Acme, we build tools.</p>" } });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/");
    expect(r).toMatchObject({ status: 200, url: "https://www.acme.com/" });
  });
});

// ---------------------------------------------------------------- shared HTTP helper
describe("requestJson", () => {
  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n < 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : json(200, { ok: true }))) as unknown as typeof fetch;
    await expect(requestJson(fetchImpl, "https://x.test", {}, { label: "T", retries: 2 })).resolves.toEqual({ ok: true });
    expect(n).toBe(2);
  });
  it("does not retry a 4xx", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n, new Response("nope", { status: 400 }))) as unknown as typeof fetch;
    await expect(requestJson(fetchImpl, "https://x.test", {}, { label: "T" })).rejects.toThrow(/T failed \(400\)/);
    expect(n).toBe(1);
  });
});

describe("adapter wiring", () => {
  it("live Claude, Serper, fetcher and ZeroBounce are real adapters now; Apollo and Crunchbase still fail loudly", () => {
    const a = createAdapters({ ADAPTER_LLM: "live", ANTHROPIC_API_KEY: "k", ADAPTER_SEARCH: "live", SERPER_API_KEY: "k", ADAPTER_FETCHER: "live", ADAPTER_VERIFIER: "live", ZEROBOUNCE_API_KEY: "k", ADAPTER_APOLLO: "live", APOLLO_API_KEY: "k" });
    expect(a.llm.complete).toBeTypeOf("function");
    expect(a.search.search).toBeTypeOf("function");
    expect(() => a.apollo.searchPeople({ titles: [], seniorities: [], keywords: [], locations: [] }, 1)).toThrow(/Phase 8/);
  });
  it("live Gmail needs a mailbox token store", () => {
    const env = { ADAPTER_GMAIL: "live", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") };
    expect(() => createAdapters(env)).toThrow(/token store/);
  });
});
