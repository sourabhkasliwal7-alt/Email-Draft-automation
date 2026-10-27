import { describe, expect, it, vi } from "vitest";
import { createMockAdapters, type ApolloAccessReport, type GmailAdapter } from "@outreach/adapters";
import type { WorkerCtx } from "../src/ctx";
import { runAdapterTest, type TestFactories } from "../src/jobs/adapter-test";

/** A database that answers only what "Test connection" asks, and a Postgres stub for the spend-cap functions. No network, no real DB. */
function fakeCtx(o: { prices?: { provider: string; unit: string; usd_per_unit: number }[]; reserveOk?: boolean; inbox?: { email: string; status: string } | null } = {}) {
  const pgCalls: { fn: string; params: unknown[] }[] = [];
  const inserts: { table: string; row: unknown }[] = [];
  let settledCost = 0;
  const rows = (table: string): unknown[] =>
    table === "price_table" ? (o.prices ?? []).map((p) => ({ ...p, effective_from: "2026-01-01T00:00:00Z" })) : [];
  const one = (table: string): unknown => {
    if (table === "usage_records") return { cost_usd: settledCost };
    if (table === "inboxes") return o.inbox === undefined ? { email: "me@gmail.com", status: "active" } : o.inbox;
    return null; // settings: defaults
  };
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit", "in"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: one(table), error: null });
    q.insert = async (row: unknown) => {
      inserts.push({ table, row });
      return { error: null };
    };
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(table), error: null });
    return q;
  };
  const pg = {
    query: async (sql: string, params: unknown[]) => {
      const fn = /private\.(\w+)/.exec(sql)![1]!;
      pgCalls.push({ fn, params });
      if (fn === "reserve_spend") return { rows: [{ r: o.reserveOk === false ? { ok: false, scope: "global", period: "daily" } : { ok: true, usage_id: "usage-1" } }] };
      if (fn === "settle_spend") settledCost = Number(params[2]);
      return { rows: [] };
    },
  };
  const ctx = { db: { from: query }, pg, adapters: createMockAdapters(), modes: { llm: "mock", search: "mock", fetcher: "mock", crunchbase: "mock", apollo: "mock", verifier: "mock", gmail: "mock" }, log: () => undefined, workerId: "t" } as unknown as WorkerCtx;
  return { ctx, pgCalls, inserts };
}

const job = { jobId: "job-1", attempts: 1 };
const env = { ANTHROPIC_API_KEY: "sk-ant-x", SERPER_API_KEY: "serper-x", ZEROBOUNCE_API_KEY: "zb-x", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", TOKEN_ENCRYPTION_KEY: "c" };
const PRICES = [
  { provider: "anthropic", unit: "input_token", usd_per_unit: 0.000001 },
  { provider: "anthropic", unit: "output_token", usd_per_unit: 0.000005 },
  { provider: "serper", unit: "search", usd_per_unit: 0.001 },
  { provider: "verifier", unit: "verification", usd_per_unit: 0.008 },
];

function factories() {
  const calls = { llm: 0, search: 0, verifier: 0 };
  const f: TestFactories = {
    llm: () => ({ complete: async () => (calls.llm++, { text: "ok", model: "claude-haiku-5-5", usage: { units: { input_token: 12, output_token: 3 } } }) }),
    search: () => ({ search: async () => (calls.search++, { results: [{ title: "t", url: "https://e.test", snippet: "s" }], usage: { units: { search: 1 } } }) }),
    verifier: () => ({ verify: async () => (calls.verifier++, { status: "invalid" as const, usage: { units: { verification: 1 } } }) }),
    gmail: () => createMockAdapters().gmail,
    apollo: () => createMockAdapters().apollo,
  };
  return { f, calls };
}

describe("Settings > Test connection", () => {
  it("makes one live call, records the usage and computes the cost from the price table", async () => {
    const { ctx, pgCalls } = fakeCtx({ prices: PRICES });
    const { f, calls } = factories();
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, env, f);
    expect(r).toMatchObject({ ok: true, provider: "anthropic", model: "claude-haiku-5-5", units: { input_token: 12, output_token: 3 } });
    expect(r.costUsd).toBeCloseTo(12 * 0.000001 + 3 * 0.000005, 9);
    expect(calls.llm).toBe(1);
    // it went through the spend guard as a LIVE call: reserved, then settled with the raw units
    const reserve = pgCalls.find((c) => c.fn === "reserve_spend")!;
    expect(reserve.params[1]).toBe("anthropic");
    expect(reserve.params[8]).toBe(false); // is_mock
    expect(Number(reserve.params[3])).toBeGreaterThan(0);
    expect(JSON.parse(String(pgCalls.find((c) => c.fn === "settle_spend")!.params[1]))).toEqual({ input_token: 12, output_token: 3 });
  });

  it("covers Serper and the verifier the same way", async () => {
    const { ctx } = fakeCtx({ prices: PRICES });
    const { f } = factories();
    expect(await runAdapterTest(ctx, { provider: "serper" }, job, env, f)).toMatchObject({ ok: true, units: { search: 1 } });
    const v = await runAdapterTest(ctx, { provider: "verifier" }, job, env, f);
    expect(v).toMatchObject({ ok: true, units: { verification: 1 } });
    expect(v.message).toContain("invalid"); // the reserved test address, never a real lead
  });

  it("without a price row nothing is called and the message says which prices to add", async () => {
    const { ctx, pgCalls } = fakeCtx({ prices: [] });
    const { f, calls } = factories();
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, env, f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Price table/);
    expect(r.message).toContain("input_token, output_token");
    expect(calls.llm).toBe(0);
    expect(pgCalls).toEqual([]);
  });

  it("a reached spend cap stops the call before it is made", async () => {
    const { ctx } = fakeCtx({ prices: PRICES, reserveOk: false });
    const { f, calls } = factories();
    const r = await runAdapterTest(ctx, { provider: "serper" }, job, env, f);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/spend cap/i);
    expect(calls.search).toBe(0);
  });

  it("a missing key is reported without any call, and a provider error is reported without the key", async () => {
    const { ctx } = fakeCtx({ prices: PRICES });
    const { f, calls } = factories();
    const noKey = await runAdapterTest(ctx, { provider: "verifier" }, job, { ...env, ZEROBOUNCE_API_KEY: "" }, f);
    expect(noKey.ok).toBe(false);
    expect(noKey.message).toMatch(/VERIFIER_API_KEY.*ZEROBOUNCE_API_KEY.*not set/);
    expect(calls.verifier).toBe(0);

    const boom: TestFactories = { ...f, llm: () => ({ complete: async () => { throw new Error("401 invalid x-api-key"); } }) };
    const failed = await runAdapterTest(ctx, { provider: "anthropic" }, job, env, boom);
    expect(failed).toMatchObject({ ok: false, message: "401 invalid x-api-key" });
  });

  it("an unknown provider is refused", async () => {
    const { ctx } = fakeCtx();
    const r = await runAdapterTest(ctx, { provider: "apollo" as never }, job, env, factories().f);
    expect(r.ok).toBe(false);
  });
});

describe("Mailboxes > Create test draft", () => {
  const draftsTo: { to: string; label?: string }[] = [];
  const gmailStub: GmailAdapter = {
    createDraft: vi.fn(async (req) => {
      draftsTo.push({ to: req.to, label: req.label });
      return { draftId: "draft-9", messageIdHeader: "<x@y>", labelApplied: false, labelNote: 'label "AI-Outreach" not applied: needs gmail.modify' };
    }),
    listReplies: async () => [],
  };
  const f: TestFactories = { ...factories().f, gmail: () => gmailStub };

  it("creates a draft addressed to the mailbox itself (it can only land in the owner's Drafts), with the label requested, and says so", async () => {
    const { ctx, pgCalls } = fakeCtx({ inbox: { email: "me@gmail.com", status: "active" } });
    const r = await runAdapterTest(ctx, { provider: "gmail", inboxId: "inbox-1" }, job, env, f);
    expect(r).toMatchObject({ ok: true, provider: "gmail", draftId: "draft-9", mailbox: "me@gmail.com" });
    expect(r.message).toContain("Nothing was sent");
    expect(r.labelNote).toMatch(/gmail\.modify/);
    expect(draftsTo).toEqual([{ to: "me@gmail.com", label: "AI-Outreach" }]);
    expect(pgCalls).toEqual([]); // no paid call, no spend record
  });

  it("explains what is missing instead of calling Google", async () => {
    const { ctx } = fakeCtx();
    const missing = await runAdapterTest(ctx, { provider: "gmail", inboxId: "inbox-1" }, job, { ...env, GOOGLE_CLIENT_SECRET: "" }, f);
    expect(missing).toMatchObject({ ok: false });
    expect(missing.message).toContain("GOOGLE_CLIENT_SECRET");
    const noInbox = await runAdapterTest(fakeCtx({ inbox: null }).ctx, { provider: "gmail", inboxId: "gone" }, job, env, f);
    expect(noInbox.message).toMatch(/no longer exists/);
    expect((await runAdapterTest(ctx, { provider: "gmail" }, job, env, f)).message).toMatch(/No mailbox/);
  });

  it("a mailbox that needs reconnecting reports the reason from the adapter", async () => {
    const err = new Error("me@gmail.com needs to be reconnected to Google (Mailboxes > Reconnect).");
    const f2: TestFactories = { ...f, gmail: () => ({ createDraft: async () => { throw err; }, listReplies: async () => [] }) };
    const r = await runAdapterTest(fakeCtx().ctx, { provider: "gmail", inboxId: "inbox-1" }, job, env, f2);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("needs to be reconnected");
  });
});

describe("Test connection for Claude follows LLM_PROVIDER", () => {
  const orEnv = { ...env, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "sk-or-x", ANTHROPIC_API_KEY: "" };
  const ORPRICES = [
    { provider: "openrouter", unit: "input_token", usd_per_unit: 0.000002 },
    { provider: "openrouter", unit: "output_token", usd_per_unit: 0.00001 },
    { provider: "openrouter", unit: "input_token@anthropic/claude-haiku-5.5", usd_per_unit: 0.0000001 },
    { provider: "openrouter", unit: "output_token@anthropic/claude-haiku-5.5", usd_per_unit: 0.0000005 },
  ];
  function orFactories() {
    const seen: { provider: string; apiKey: string }[] = [];
    const f: TestFactories = {
      ...factories().f,
      llm: (apiKey, provider) => {
        seen.push({ provider, apiKey });
        return {
          complete: async () => ({
            text: "ok",
            model: "anthropic/claude-haiku-5.5",
            usage: { units: { "input_token@anthropic/claude-haiku-5.5": 1000, "output_token@anthropic/claude-haiku-5.5": 100 } },
            reportedCostUsd: 0.00015,
          }),
        };
      },
    };
    return { f, seen };
  }

  it("uses OpenRouter and its key, records usage under 'openrouter', and prices each model by its own row", async () => {
    const { ctx, pgCalls } = fakeCtx({ prices: ORPRICES });
    const { f, seen } = orFactories();
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, orEnv, f);
    expect(seen).toEqual([{ provider: "openrouter", apiKey: "sk-or-x" }]);
    expect(r).toMatchObject({ ok: true, llmProvider: "openrouter", model: "anthropic/claude-haiku-5.5", reportedCostUsd: 0.00015 });
    expect(r.message).toContain("via OpenRouter");
    // the cost is the price table's (model row), not OpenRouter's own figure
    expect(r.costUsd).toBeCloseTo(1000 * 0.0000001 + 100 * 0.0000005, 9);
    const reserve = pgCalls.find((c) => c.fn === "reserve_spend")!;
    expect(reserve.params[1]).toBe("openrouter");
    expect(reserve.params[8]).toBe(false);
    expect(Number(reserve.params[3])).toBeGreaterThan(0); // the cap check reserves an amount before the call
  });

  it("a spend cap still stops an OpenRouter call before it is made", async () => {
    const { ctx } = fakeCtx({ prices: ORPRICES, reserveOk: false });
    let called = 0;
    const f: TestFactories = { ...factories().f, llm: () => ({ complete: async () => (called++, { text: "ok", model: "m", usage: { units: {} } }) }) };
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, orEnv, f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/spend cap/i);
    expect(called).toBe(0);
  });

  it("asks for OPENROUTER_API_KEY (not the Anthropic key) and names the openrouter prices that are missing", async () => {
    const { ctx } = fakeCtx({ prices: ORPRICES });
    const noKey = await runAdapterTest(ctx, { provider: "anthropic" }, job, { ...orEnv, OPENROUTER_API_KEY: "" }, factories().f);
    expect(noKey).toMatchObject({ ok: false });
    expect(noKey.message).toContain("OPENROUTER_API_KEY");
    expect(noKey.message).not.toContain("ANTHROPIC_API_KEY");

    const { ctx: ctx2, pgCalls } = fakeCtx({ prices: PRICES }); // prices exist for anthropic, none for openrouter
    const { f, seen } = orFactories();
    const noPrice = await runAdapterTest(ctx2, { provider: "anthropic" }, job, orEnv, f);
    expect(noPrice.ok).toBe(false);
    expect(noPrice.message).toContain('"openrouter"');
    expect(noPrice.message).toContain("input_token, output_token");
    expect(seen).toHaveLength(1); // the factory is built, but no call and no spend record follow
    expect(pgCalls).toEqual([]);
  });

  it("with LLM_PROVIDER unset it is the Anthropic API and the Anthropic key, as before", async () => {
    const { ctx, pgCalls } = fakeCtx({ prices: PRICES });
    const seen: string[] = [];
    const f: TestFactories = { ...factories().f, llm: (_k, provider) => (seen.push(provider), factories().f.llm("k", provider, {})) };
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, env, f);
    expect(seen).toEqual(["anthropic"]);
    expect(r).toMatchObject({ ok: true, llmProvider: "anthropic" });
    expect(pgCalls.find((c) => c.fn === "reserve_spend")!.params[1]).toBe("anthropic");
  });

  it("a mistyped LLM_PROVIDER is reported instead of silently using the wrong provider", async () => {
    const { ctx, pgCalls } = fakeCtx({ prices: PRICES });
    const r = await runAdapterTest(ctx, { provider: "anthropic" }, job, { ...env, LLM_PROVIDER: "openruter" }, factories().f);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/LLM_PROVIDER must be/);
    expect(pgCalls).toEqual([]);
  });
});

describe("Setup > Apollo account > Test connection", () => {
  const report = (over: Partial<ApolloAccessReport> = {}): ApolloAccessReport => ({
    health: { ok: true, message: "The key is valid." },
    search: { ok: true, message: "People search works." },
    reveal: { ok: true, message: "Email reveal is available." },
    usage: { units: { credit: 0 } },
    ...over,
  });
  const withApollo = (r: ApolloAccessReport): TestFactories => ({ ...factories().f, apollo: () => ({ ...createMockAdapters().apollo, checkAccess: async () => r }) });

  it("with a key and everything allowed: connected, no credit used, usage recorded as a real (not demo) call", async () => {
    const { ctx, inserts, pgCalls } = fakeCtx();
    const r = await runAdapterTest(ctx, { provider: "apollo" }, job, { ...env, APOLLO_API_KEY: "apollo-x" }, withApollo(report()));
    expect(r).toMatchObject({ ok: true, provider: "apollo", costUsd: 0, units: { credit: 0 }, apollo: { mode: "live" } });
    expect(r.message).toMatch(/No credit was used/);
    expect(inserts).toEqual([expect.objectContaining({ table: "usage_records", row: expect.objectContaining({ provider: "apollo", operation: "connection_test", is_mock: false, cost_usd: 0 }) })]);
    expect(pgCalls).toEqual([]); // no paid call, so no spend reservation
  });

  it("a plan without API access: not ready, in plain words, with each failed check", async () => {
    const { ctx } = fakeCtx();
    const denied = report({
      search: { ok: false, message: "Apollo says this key or plan cannot use people search (403). It needs a paid Apollo plan with API access, or a master API key." },
      reveal: { ok: false, message: "Apollo says this key or plan cannot use email reveal (403)." },
    });
    const r = await runAdapterTest(ctx, { provider: "apollo" }, job, { ...env, APOLLO_API_KEY: "apollo-x" }, withApollo(denied));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Apollo is not ready/);
    expect(r.message).toMatch(/paid Apollo plan with API access/);
    expect(r.apollo?.reveal.ok).toBe(false);
  });

  it("with no key it says Apollo is in demo mode instead of calling anything", async () => {
    const { ctx, inserts } = fakeCtx();
    let built = 0;
    const f: TestFactories = { ...factories().f, apollo: () => (built++, createMockAdapters().apollo) };
    const r = await runAdapterTest(ctx, { provider: "apollo" }, job, { ...env, APOLLO_API_KEY: "" }, f);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No Apollo key yet.*demo mode.*ADAPTER_APOLLO=live/);
    expect(r.apollo?.mode).toBe("mock");
    expect(built).toBe(0);
    expect((inserts[0]!.row as { is_mock: boolean }).is_mock).toBe(true);
  });
});
