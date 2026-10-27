import type { LlmAdapter } from "../types";
import { HttpError, requestJson, type FetchLike } from "./http";
import { DEFAULT_CHEAP_MODEL, DEFAULT_STRONG_MODEL, modelUnit, toOpenRouterModel } from "./llm-models";

/** POST https://openrouter.ai/api/v1/chat/completions, `Authorization: Bearer <key>` (OpenRouter API reference). */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  /** shown on openrouter.ai as the calling app (HTTP-Referer) */
  siteUrl?: string;
  appName?: string;
  cheapModel?: string;
  strongModel?: string;
}

interface ChatResponse {
  id?: string;
  model?: string;
  error?: { code?: number; message?: string };
  choices?: {
    finish_reason?: string | null;
    error?: { code?: number; message?: string };
    message?: { content?: string | { type?: string; text?: string }[] | null; refusal?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** Reasoning tokens count toward max_tokens, and OpenRouter keeps the reasoning budget below it, so never ask for less than this. */
const MIN_MAX_TOKENS = 4096;
const TIMEOUT_MS = 120_000;

/** OpenRouter's own words for an error: {"error":{"message":"..."}} */
const errorText = (body: string): string => {
  try {
    const m = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    return typeof m === "string" ? m.replace(/\s+/g, " ").slice(0, 200) : "";
  } catch {
    return "";
  }
};

const friendly = (status: number, model: string, detail: string): string => {
  if (status === 401) return "OpenRouter rejected the API key (401): check OPENROUTER_API_KEY";
  if (status === 402) return `OpenRouter says the account has too few credits for this call (402): add credits at openrouter.ai${errorText(detail) ? ` (${errorText(detail)})` : ""}`;
  if (status === 404 || (status === 400 && /model/i.test(detail) && /(not|invalid|unknown)/i.test(detail))) return `OpenRouter does not know the model "${model}" (${status}): change it under Settings > Daily run > models`;
  if (status === 429) return "OpenRouter is rate limiting this key (429)";
  return `OpenRouter failed (${status}): ${detail.slice(0, 240)}`;
};

/**
 * The language model through OpenRouter. Same interface as the Anthropic adapter: the model comes from the request
 * (Settings), token counts are the usage units for the price table, and 429/5xx are retried with backoff.
 * Cost is never taken from OpenRouter's answer (the price table decides); its own figure is only passed along for display.
 */
export function createOpenRouterLlm(opts: OpenRouterOptions): LlmAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  /** models for which OpenRouter refused the reasoning setting: it is left out from then on */
  const reasoningRefused = new Set<string>();

  return {
    async complete(req) {
      const requested = req.model ?? (req.tier === "cheap" ? (opts.cheapModel ?? DEFAULT_CHEAP_MODEL) : (opts.strongModel ?? DEFAULT_STRONG_MODEL));
      const model = toOpenRouterModel(requested);
      const headers: Record<string, string> = { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", "x-openrouter-title": opts.appName ?? "AI Outreach Engine" };
      if (opts.siteUrl) headers["http-referer"] = opts.siteUrl;

      const send = (withReasoning: boolean) =>
        requestJson<ChatResponse>(
          fetchImpl,
          OPENROUTER_URL,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              max_tokens: Math.max(req.maxTokens ?? 1024, MIN_MAX_TOKENS),
              messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }],
              // checking and extraction need little reasoning; drafting gets a bit more
              ...(withReasoning ? { reasoning: { effort: req.tier === "cheap" ? "low" : "medium" } } : {}),
            }),
          },
          { label: "OpenRouter", timeoutMs: TIMEOUT_MS, redact: [opts.apiKey] },
        );

      let json: ChatResponse;
      try {
        try {
          json = await send(!reasoningRefused.has(model));
        } catch (e) {
          // a model that does not accept the reasoning setting is retried once without it, and remembered
          if (e instanceof HttpError && e.status === 400 && /reasoning|thinking|effort/i.test(e.body) && !reasoningRefused.has(model)) {
            reasoningRefused.add(model);
            json = await send(false);
          } else throw e;
        }
      } catch (e) {
        if (e instanceof HttpError) throw new Error(friendly(e.status, model, e.body || e.message));
        throw e;
      }

      // a 200 can still carry a failure: top-level error, an error inside the choice, or finish_reason "error"
      if (json.error) throw new Error(`OpenRouter error${json.error.code ? ` ${json.error.code}` : ""}: ${String(json.error.message ?? "unknown").slice(0, 240)}`);
      const choice = json.choices?.[0];
      if (!choice) throw new Error(`OpenRouter returned no answer from ${model}`);
      if (choice.error || choice.finish_reason === "error") throw new Error(`OpenRouter error from ${model}: ${String(choice.error?.message ?? "the provider failed").slice(0, 240)}`);
      if (choice.message?.refusal) throw new Error(`${model} declined this request (refusal)`);

      const content = choice.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (p.type === "text" || p.type === undefined ? (p.text ?? "") : "")).join("") : "";
      if (!text.trim()) {
        throw new Error(
          choice.finish_reason === "length"
            ? `${model} used all ${Math.max(req.maxTokens ?? 1024, MIN_MAX_TOKENS)} tokens thinking and wrote no answer (finish reason: length)`
            : `${model} returned no text (finish reason: ${choice.finish_reason ?? "unknown"})`,
        );
      }

      const u = json.usage ?? {};
      return {
        text,
        model: json.model ?? model,
        // prompt_tokens / completion_tokens as counted by OpenRouter; completion includes any reasoning tokens (they are billed as output)
        usage: { units: { [modelUnit("input_token", model)]: u.prompt_tokens ?? 0, [modelUnit("output_token", model)]: u.completion_tokens ?? 0 } },
        reportedCostUsd: typeof u.cost === "number" ? u.cost : undefined,
      };
    },
  };
}
