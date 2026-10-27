import Anthropic from "@anthropic-ai/sdk";
import type { LlmAdapter } from "../types";
import { DEFAULT_CHEAP_MODEL, DEFAULT_STRONG_MODEL, modelFor, modelUnit } from "./llm-models";

/** The slice of the SDK this adapter uses, so tests can pass a stub instead of making a network call. */
export interface MessagesClientLike {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface LiveLlmOptions {
  apiKey: string;
  /** used when the request names no model (the run always names one from the workflow settings) */
  cheapModel?: string;
  strongModel?: string;
  client?: MessagesClientLike;
}

/** Thinking tokens count toward max_tokens, so never go below this even when a step asks for a 200-token answer. */
const MIN_MAX_TOKENS = 1024;

/** The Claude 5 family takes `output_config.effort`; older models reject it. */
const supportsEffort = (model: string) => /^claude-(opus|sonnet|haiku|fable|mythos)-5/.test(model);

/**
 * Anthropic Messages API through the official SDK. The model comes from the request (Settings > models) and cost is
 * computed later from the usage units x the price table, never here. Retries and timeouts are the SDK's.
 */
export function createLiveLlm(opts: LiveLlmOptions): LlmAdapter {
  const client: MessagesClientLike = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    async complete(req) {
      // a setting written for OpenRouter ("anthropic/claude-sonnet-5.5") still works here
      const model = modelFor("anthropic", req.model ?? (req.tier === "cheap" ? (opts.cheapModel ?? DEFAULT_CHEAP_MODEL) : (opts.strongModel ?? DEFAULT_STRONG_MODEL)));
      const res = await client.messages.create({
        model,
        max_tokens: Math.max(req.maxTokens ?? MIN_MAX_TOKENS, MIN_MAX_TOKENS),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
        // checking and extraction need little reasoning; drafting gets a bit more
        ...(supportsEffort(model) ? { output_config: { effort: req.tier === "cheap" ? ("low" as const) : ("medium" as const) } } : {}),
      });
      if (res.stop_reason === "refusal") throw new Error(`${model} declined this request (refusal)`);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (!text.trim()) throw new Error(`${model} returned no text (stop reason: ${res.stop_reason ?? "unknown"})`);
      const u = res.usage;
      return {
        text,
        model: res.model,
        // cache tokens are billed as input; this adapter never asks for caching, so they are normally 0
        usage: { units: { [modelUnit("input_token", model)]: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), [modelUnit("output_token", model)]: u.output_tokens } },
      };
    },
  };
}
