import {
  LLM_KEY_VAR,
  LlmProviderError,
  createLiveApollo,
  createLiveGmail,
  createLiveLlm,
  createLiveSearch,
  createLiveVerifier,
  createOpenRouterLlm,
  envValue,
  resolveLlmProvider,
  type Adapters,
  type ApolloAccessReport,
  type GmailAdapter,
  type LlmProvider,
  type Usage,
} from "@outreach/adapters";
import { PROVIDER_UNITS, providerIdFor } from "@outreach/core";
import type { JobInfo, WorkerCtx } from "../ctx";
import { createGmailTokenStore } from "../gmail-store";
import { loadWorkflowConfig } from "../pipeline/run-common";
import { makeSpender } from "../spend";

export const TEST_PROVIDERS = ["anthropic", "serper", "verifier", "gmail", "apollo"] as const;
export type TestProvider = (typeof TEST_PROVIDERS)[number];

export interface AdapterTestPayload {
  provider: TestProvider;
  /** gmail only: the mailbox to put the test draft in */
  inboxId?: string;
}

export interface AdapterTestResult {
  ok: boolean;
  provider: TestProvider;
  message: string;
  model?: string;
  /** which way the model was reached: anthropic or openrouter */
  llmProvider?: LlmProvider;
  units?: Usage["units"];
  costUsd?: number;
  /** the provider's own cost figure (OpenRouter), shown next to the cost computed from the price table */
  reportedCostUsd?: number;
  /** apollo only: what the free checks found */
  apollo?: { mode: "mock" | "live"; health: { ok: boolean; message: string }; search: { ok: boolean; message: string }; reveal: { ok: boolean; message: string } };
  /** gmail only */
  draftId?: string;
  mailbox?: string;
  labelNote?: string;
  finishedAt: string;
}

/** What the test needs from the outside world. Replaced in tests so no network call is made. */
export interface TestFactories {
  llm(apiKey: string, provider: LlmProvider, env: Record<string, string | undefined>): Adapters["llm"];
  search(apiKey: string): Adapters["search"];
  verifier(apiKey: string): Adapters["verifier"];
  apollo(apiKey: string): Adapters["apollo"];
  gmail(ctx: WorkerCtx, env: Record<string, string | undefined>): GmailAdapter;
}

export const liveFactories: TestFactories = {
  llm: (apiKey, provider, env) => (provider === "openrouter" ? createOpenRouterLlm({ apiKey, siteUrl: envValue(env, "NEXT_PUBLIC_SITE_URL") }) : createLiveLlm({ apiKey })),
  search: (apiKey) => createLiveSearch({ apiKey }),
  verifier: (apiKey) => createLiveVerifier({ apiKey }),
  apollo: (apiKey) => createLiveApollo({ apiKey }),
  gmail: (ctx, env) =>
    createLiveGmail({
      clientId: envValue(env, "GOOGLE_CLIENT_ID")!,
      clientSecret: envValue(env, "GOOGLE_CLIENT_SECRET")!,
      encryptionKey: envValue(env, "TOKEN_ENCRYPTION_KEY")!,
      tokens: createGmailTokenStore(ctx.db),
    }),
};

const KEY_VARS = { serper: "SERPER_API_KEY", verifier: "VERIFIER_API_KEY" } as const;
const ADAPTER_FOR = { anthropic: "llm", serper: "search", verifier: "verifier" } as const;

/**
 * "Test connection": one tiny LIVE call per provider, whatever ADAPTER_* says (this never changes a mode). The call goes
 * through the same spend guard as a real one: it needs a price row, respects the caps, and records its usage and cost.
 */
export async function runAdapterTest(
  ctx: WorkerCtx,
  payload: AdapterTestPayload,
  job: JobInfo,
  env: Record<string, string | undefined> = process.env,
  factories: TestFactories = liveFactories,
): Promise<AdapterTestResult> {
  const finishedAt = () => new Date().toISOString();
  const fail = (message: string): AdapterTestResult => ({ ok: false, provider: payload.provider, message, finishedAt: finishedAt() });
  if (!TEST_PROVIDERS.includes(payload.provider)) return fail(`Unknown provider "${String(payload.provider)}".`);

  try {
    if (payload.provider === "gmail") return await testGmail(ctx, payload, env, factories, finishedAt);
    if (payload.provider === "apollo") return await testApollo(ctx, job, env, factories, finishedAt);

    // Claude is reached through LLM_PROVIDER (anthropic or openrouter): the test uses whichever is selected
    const llmProvider = payload.provider === "anthropic" ? resolveLlmProvider(env) : undefined;
    const keyVar = llmProvider ? LLM_KEY_VAR[llmProvider] : KEY_VARS[payload.provider as "serper" | "verifier"];
    const apiKey = envValue(env, keyVar);
    if (!apiKey) return fail(`${keyVar}${keyVar === "VERIFIER_API_KEY" ? " (or ZEROBOUNCE_API_KEY)" : ""} is not set in .env.`);

    // the spender decides mock vs live (and the provider id) from ctx: for this test the provider is always live
    const adapter = ADAPTER_FOR[payload.provider];
    const liveCtx: WorkerCtx = { ...ctx, ...(llmProvider ? { llmProvider } : {}), modes: { ...ctx.modes, [adapter]: "live" } };
    const paid = makeSpender(liveCtx, { campaignId: null, leadId: null, jobId: job.jobId, step: "connection-test" });

    let model: string | undefined;
    let detail: string;
    let usage: Usage;
    let reportedCostUsd: number | undefined;
    if (payload.provider === "anthropic") {
      const cfg = await loadWorkflowConfig(ctx.db);
      const llm = factories.llm(apiKey, llmProvider!, env);
      const r = await paid("llm", "connection_test", () => llm.complete({ tier: "cheap", model: cfg.model_screen, prompt: "Reply with the single word: ok", maxTokens: 1024 }));
      model = r.model;
      usage = r.usage;
      reportedCostUsd = r.reportedCostUsd;
      detail = `${llmProvider === "openrouter" ? "via OpenRouter, " : ""}${r.model} answered "${r.text.trim().slice(0, 40)}"`;
    } else if (payload.provider === "serper") {
      const search = factories.search(apiKey);
      const r = await paid("search", "connection_test", () => search.search({ query: "example domain", num: 1 }));
      usage = r.usage;
      detail = `search returned ${r.results.length} result(s)`;
    } else {
      const verifier = factories.verifier(apiKey);
      const r = await paid("verifier", "connection_test", () => verifier.verify("connection-test@example.com"));
      usage = r.usage;
      detail = `the verifier answered "${r.status}" for a reserved test address`;
    }
    const { data: row } = await ctx.db.from("usage_records").select("cost_usd").eq("job_id", job.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { ok: true, provider: payload.provider, message: `Connected: ${detail}.`, model, llmProvider, units: usage.units, costUsd: row ? Number(row.cost_usd) : undefined, reportedCostUsd, finishedAt: finishedAt() };
  } catch (e) {
    const err = e as Error;
    if (err.name === "MissingPriceError") {
      const provider = payload.provider === "anthropic" ? providerIdFor("llm", llmProviderOf(env)) : payload.provider === "serper" ? "serper" : "verifier";
      return fail(`${err.message}. Add a price for every unit of "${provider}" (${PROVIDER_UNITS[provider].join(", ")}) under Settings > Price table, then test again.`);
    }
    if (err instanceof LlmProviderError) return fail(err.message);
    if (err.name === "CapReachedError") return fail(`A spend cap was reached, so no call was made (${err.message.slice(0, 200)}).`);
    return fail(err.message.slice(0, 400));
  }
}

/** the selected provider, or anthropic when LLM_PROVIDER is unusable (the test reports that problem itself) */
function llmProviderOf(env: Record<string, string | undefined>): LlmProvider {
  try {
    return resolveLlmProvider(env);
  } catch {
    return "anthropic";
  }
}

/**
 * Apollo: only free checks (the key, people search access, whether the email-reveal call is reachable). No credit is spent and no
 * email is unlocked. With no key the demo adapter answers, and the result says so.
 */
async function testApollo(ctx: WorkerCtx, job: JobInfo, env: Record<string, string | undefined>, factories: TestFactories, finishedAt: () => string): Promise<AdapterTestResult> {
  const apiKey = envValue(env, "APOLLO_API_KEY");
  const live = Boolean(apiKey);
  const report: ApolloAccessReport = await (live ? factories.apollo(apiKey!) : ctx.adapters.apollo).checkAccess();
  const apollo = { mode: (live ? "live" : "mock") as "mock" | "live", health: report.health, search: report.search, reveal: report.reveal };
  // the usage of the check is recorded like any other call (it costs no credits)
  await ctx.db.from("usage_records").insert({ provider: "apollo", operation: "connection_test", units: report.usage.units, cost_usd: 0, status: "recorded", is_mock: !live, step: "connection-test", job_id: job.jobId, idempotency_key: `usage:${job.jobId}:connection-test:apollo`, campaign_id: null });
  if (!live) {
    return { ok: false, provider: "apollo", message: "No Apollo key yet (APOLLO_API_KEY is not set in .env): Apollo is in demo mode and uses made-up people. Add the key and set ADAPTER_APOLLO=live, then restart.", apollo, units: report.usage.units, finishedAt: finishedAt() };
  }
  const ok = report.health.ok && report.search.ok && report.reveal.ok;
  const problems = [report.health, report.search, report.reveal].filter((c) => !c.ok).map((c) => c.message);
  return {
    ok,
    provider: "apollo",
    message: ok ? "Connected: the key works, people search works and email reveal is available. No credit was used." : `Apollo is not ready: ${problems.join(" ")}`,
    apollo,
    units: report.usage.units,
    costUsd: 0,
    finishedAt: finishedAt(),
  };
}

async function testGmail(ctx: WorkerCtx, payload: AdapterTestPayload, env: Record<string, string | undefined>, factories: TestFactories, finishedAt: () => string): Promise<AdapterTestResult> {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].filter((v) => !envValue(env, v));
  if (missing.length) return { ok: false, provider: "gmail", message: `${missing.join(", ")} not set in .env.`, finishedAt: finishedAt() };
  if (!payload.inboxId) return { ok: false, provider: "gmail", message: "No mailbox chosen.", finishedAt: finishedAt() };
  const { data: inbox } = await ctx.db.from("inboxes").select("email, status").eq("id", payload.inboxId).is("deleted_at", null).maybeSingle();
  if (!inbox) return { ok: false, provider: "gmail", message: "That mailbox no longer exists.", finishedAt: finishedAt() };
  const gmail = factories.gmail(ctx, env);
  // addressed to the mailbox itself: it can only ever land in the owner's own Drafts folder, and nothing is sent
  const r = await gmail.createDraft({
    inboxId: payload.inboxId,
    to: inbox.email,
    subject: "AI Outreach Engine: test draft (safe to delete)",
    bodyText: "This draft was created by the Test draft button in AI Outreach Engine.\n\nNothing was sent. You can delete this draft.",
    label: "AI-Outreach",
  });
  return { ok: true, provider: "gmail", message: `A test draft was created in the Drafts folder of ${inbox.email}. Nothing was sent.`, draftId: r.draftId, mailbox: inbox.email, labelNote: r.labelNote, finishedAt: finishedAt() };
}

/** Job handler: the result (including a failure) is stored on the job so Settings and Mailboxes can show it. */
export async function adapterTestJob(ctx: WorkerCtx, payload: AdapterTestPayload, job: JobInfo): Promise<AdapterTestResult> {
  return runAdapterTest(ctx, payload, job);
}
