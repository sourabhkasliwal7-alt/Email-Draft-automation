import { describe, expect, it } from "vitest";
import {
  EnvError,
  LlmProviderError,
  assertAdapterEnv,
  createAdapters,
  createOpenRouterLlm,
  modelFor,
  resolveLlmProvider,
  toAnthropicModel,
  toOpenRouterModel,
} from "../src";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (over: Record<string, unknown> = {}) => ({
  id: "gen-1",
  model: "anthropic/claude-haiku-5.5",
  choices: [{ finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}' } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.000027 },
  ...over,
});

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
function scripted(...replies: (Response | (() => Response))[]) {
  const seen: Seen[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: JSON.parse(String(init.body)) });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return typeof r === "function" ? r() : r.clone();
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("model names: Settings hold Anthropic ids, OpenRouter wants its own", () => {
  it("converts Claude ids to OpenRouter slugs, and keeps anything already written with a slash", () => {
    expect(toOpenRouterModel("claude-haiku-5-5")).toBe("anthropic/claude-haiku-5.5");
    expect(toOpenRouterModel("claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5.5");
    expect(toOpenRouterModel("claude-opus-5")).toBe("anthropic/claude-opus-5");
    expect(toOpenRouterModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4.6");
    expect(toOpenRouterModel("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(toOpenRouterModel("~anthropic/claude-sonnet-latest")).toBe("~anthropic/claude-sonnet-latest");
    expect(toOpenRouterModel("openai/gpt-6")).toBe("openai/gpt-6");
    expect(toOpenRouterModel("  claude-haiku-5-5 ")).toBe("anthropic/claude-haiku-5.5");
  });
  it("converts back, so a setting written for OpenRouter keeps working after switching to the Anthropic API", () => {
    expect(toAnthropicModel("anthropic/claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(toAnthropicModel("anthropic/claude-opus-5")).toBe("claude-opus-5");
    expect(toAnthropicModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(modelFor("anthropic", "anthropic/claude-haiku-5.5")).toBe("claude-haiku-5-5");
    expect(modelFor("openrouter", "claude-haiku-5-5")).toBe("anthropic/claude-haiku-5.5");
  });
  it("leaves ids it does not recognise alone instead of guessing", () => {
    expect(toOpenRouterModel("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
    expect(toAnthropicModel("openai/gpt-6")).toBe("openai/gpt-6");
  });
});

describe("LLM_PROVIDER", () => {
  it("defaults to anthropic, accepts either name in any case, and rejects anything else", () => {
    expect(resolveLlmProvider({})).toBe("anthropic");
    expect(resolveLlmProvider({ LLM_PROVIDER: "" })).toBe("anthropic");
    expect(resolveLlmProvider({ LLM_PROVIDER: " OpenRouter " })).toBe("openrouter");
    expect(resolveLlmProvider({ LLM_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(() => resolveLlmProvider({ LLM_PROVIDER: "openai" })).toThrow(LlmProviderError);
  });
  it("live Claude asks for the key of the selected provider, and only that one", () => {
    expect(() => assertAdapterEnv({ ADAPTER_LLM: "live", LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" })).not.toThrow();
    expect(() => assertAdapterEnv({ ADAPTER_LLM: "live", LLM_PROVIDER: "openrouter", ANTHROPIC_API_KEY: "k" })).toThrow(/OPENROUTER_API_KEY is required/);
    expect(() => assertAdapterEnv({ ADAPTER_LLM: "live", ANTHROPIC_API_KEY: "k" })).not.toThrow();
    expect(() => assertAdapterEnv({ ADAPTER_LLM: "live", OPENROUTER_API_KEY: "k" })).toThrow(/ANTHROPIC_API_KEY is required/);
    try {
      assertAdapterEnv({ ADAPTER_LLM: "live", LLM_PROVIDER: "openrouter" });
      throw new Error("expected EnvError");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as Error).message).not.toContain("ANTHROPIC_API_KEY");
    }
  });
  it("a typo in LLM_PROVIDER is reported even while the adapter is on mock", () => {
    expect(() => assertAdapterEnv({ LLM_PROVIDER: "openruter" })).toThrow(/LLM_PROVIDER must be/);
  });
  it("createAdapters reports which provider is in use and builds the matching adapter", () => {
    expect(createAdapters({}).llmProvider).toBe("anthropic");
    const a = createAdapters({ ADAPTER_LLM: "live", LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    expect(a.llmProvider).toBe("openrouter");
    expect(a.llm.complete).toBeTypeOf("function");
    expect(a.modes.llm).toBe("live");
  });
});

describe("OpenRouter adapter", () => {
  it("posts to the chat completions endpoint with a Bearer key, the converted model, the system prompt and a safe token limit", async () => {
    const { fetchImpl, seen } = scripted(json(200, ok()));
    const llm = createOpenRouterLlm({ apiKey: "OR-KEY-123", fetchImpl, siteUrl: "http://localhost:3000" });
    const r = await llm.complete({ tier: "cheap", model: "claude-haiku-5-5", system: "sys", prompt: "hello", maxTokens: 200 });
    expect(r.text).toBe('{"ok":true}');
    const s = seen[0]!;
    expect(s.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(s.headers.authorization).toBe("Bearer OR-KEY-123");
    expect(s.headers["http-referer"]).toBe("http://localhost:3000");
    expect(s.headers["x-openrouter-title"]).toBeTruthy();
    expect(s.body.model).toBe("anthropic/claude-haiku-5.5");
    expect(s.body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hello" }]);
    expect(Number(s.body.max_tokens)).toBeGreaterThanOrEqual(4096); // thinking tokens count toward it
    expect(s.body.reasoning).toEqual({ effort: "low" });
    expect(s.body).not.toHaveProperty("temperature");
  });

  it("uses a bit more reasoning for the strong model, and the tier default when the request names no model", async () => {
    const { fetchImpl, seen } = scripted(json(200, ok()));
    const llm = createOpenRouterLlm({ apiKey: "k", fetchImpl });
    await llm.complete({ tier: "strong", prompt: "p" });
    expect(seen[0]!.body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(seen[0]!.body.reasoning).toEqual({ effort: "medium" });
    await llm.complete({ tier: "cheap", prompt: "p" });
    expect(seen[1]!.body.model).toBe("anthropic/claude-haiku-5.5");
    expect(seen[1]!.body.messages).toEqual([{ role: "user", content: "p" }]);
  });

  it("counts tokens per model for the price table and passes OpenRouter's own cost along for display only", async () => {
    const { fetchImpl } = scripted(json(200, ok()));
    const r = await createOpenRouterLlm({ apiKey: "k", fetchImpl }).complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    expect(r.usage.units).toEqual({ "input_token@anthropic/claude-haiku-5.5": 120, "output_token@anthropic/claude-haiku-5.5": 30 });
    expect(r.reportedCostUsd).toBe(0.000027);
    expect(r.model).toBe("anthropic/claude-haiku-5.5");
  });

  it("reads text content given as parts, and tolerates a missing usage block", async () => {
    const parts = scripted(json(200, ok({ choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "he" }, { type: "text", text: "llo" }] } }], usage: undefined })));
    const r = await createOpenRouterLlm({ apiKey: "k", fetchImpl: parts.fetchImpl }).complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    expect(r.text).toBe("hello");
    expect(r.usage.units).toEqual({ "input_token@anthropic/claude-haiku-5.5": 0, "output_token@anthropic/claude-haiku-5.5": 0 });
    expect(r.reportedCostUsd).toBeUndefined();
  });

  it("a 200 that carries a failure is an error: top-level, inside the choice, finish_reason error, a refusal, no text", async () => {
    const run = (body: unknown) => createOpenRouterLlm({ apiKey: "k", fetchImpl: scripted(json(200, body)).fetchImpl }).complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    await expect(run({ error: { code: 502, message: "provider dropped the connection" } })).rejects.toThrow(/OpenRouter error 502: provider dropped/);
    await expect(run({ choices: [{ finish_reason: "error", error: { code: 500, message: "upstream failed" }, message: { content: "partial" } }] })).rejects.toThrow(/upstream failed/);
    await expect(run({ choices: [{ finish_reason: "error", message: { content: "partial" } }] })).rejects.toThrow(/provider failed/);
    await expect(run({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] })).rejects.toThrow(/declined/);
    await expect(run({ choices: [] })).rejects.toThrow(/no answer/);
    await expect(run({ choices: [{ finish_reason: "length", message: { content: "" } }] })).rejects.toThrow(/thinking and wrote no answer/);
    await expect(run({ choices: [{ finish_reason: "stop", message: { content: "  " } }] })).rejects.toThrow(/no text/);
  });

  it("explains the common HTTP failures in plain words, and never prints the key", async () => {
    const KEY = "sk-or-v1-SECRET-KEY-123";
    const run = (status: number, body: string) => createOpenRouterLlm({ apiKey: KEY, fetchImpl: scripted(new Response(body, { status })).fetchImpl }).complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" }).then(() => new Error("no error"), (e: Error) => e);
    const e401 = await run(401, `{"error":{"code":401,"message":"No auth credentials found ${KEY}"}}`);
    expect(e401.message).toMatch(/rejected the API key.*OPENROUTER_API_KEY/);
    const e402 = await run(402, '{"error":{"code":402,"message":"This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 120."}}');
    expect(e402.message).toMatch(/too few credits/);
    expect(e402.message).toContain("can only afford 120"); // OpenRouter's own explanation is kept
    const e404 = await run(404, '{"error":{"code":404,"message":"No endpoints found for anthropic/claude-haiku-9"}}');
    expect(e404.message).toMatch(/does not know the model "anthropic\/claude-haiku-5.5".*Settings/);
    const e400 = await run(400, '{"error":{"code":400,"message":"anthropic/x is not a valid model ID"}}');
    expect(e400.message).toMatch(/does not know the model/);
    for (const e of [e401, e402, e404, e400]) expect(e.message).not.toContain(KEY);
  });

  it("retries a 429 (honouring Retry-After) and a 502, then succeeds", async () => {
    const { fetchImpl, seen } = scripted(json(429, { error: { code: 429, message: "slow down" } }, { "retry-after": "0" }), json(502, { error: { code: 502, message: "bad gateway" } }), json(200, ok()));
    const r = await createOpenRouterLlm({ apiKey: "k", fetchImpl }).complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    expect(r.text).toBe('{"ok":true}');
    expect(seen).toHaveLength(3);
  });

  it("does not retry a rejected key or an empty account", async () => {
    for (const status of [401, 402]) {
      const { fetchImpl, seen } = scripted(json(status, { error: { code: status, message: "no" } }));
      await expect(createOpenRouterLlm({ apiKey: "k", fetchImpl }).complete({ tier: "cheap", prompt: "p" })).rejects.toThrow();
      expect(seen).toHaveLength(1);
    }
  });

  it("a model that refuses the reasoning setting is retried once without it, and remembered", async () => {
    const refuse = () => json(400, { error: { code: 400, message: "Model does not support parameter: reasoning.effort" } });
    const { fetchImpl, seen } = scripted(refuse(), json(200, ok()), json(200, ok()));
    const llm = createOpenRouterLlm({ apiKey: "k", fetchImpl });
    await llm.complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.body).toHaveProperty("reasoning");
    expect(seen[1]!.body).not.toHaveProperty("reasoning");
    await llm.complete({ tier: "cheap", model: "claude-haiku-5-5", prompt: "p" });
    expect(seen).toHaveLength(3);
    expect(seen[2]!.body).not.toHaveProperty("reasoning"); // no second failed attempt
  });
});
