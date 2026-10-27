import { LLM_PROVIDERS, type LlmProviderId } from "@outreach/core";

export type LlmProvider = LlmProviderId;
export { LLM_PROVIDERS };

export const DEFAULT_CHEAP_MODEL = "claude-haiku-5-5";
export const DEFAULT_STRONG_MODEL = "claude-sonnet-5-5";

/** The variable that holds the key of each way of reaching the model. */
export const LLM_KEY_VAR: Record<LlmProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" };

export class LlmProviderError extends Error {
  constructor(value: string) {
    super(`LLM_PROVIDER must be "anthropic" or "openrouter" (got "${value}")`);
    this.name = "LlmProviderError";
  }
}

/** LLM_PROVIDER=anthropic|openrouter. Empty or missing means anthropic. */
export function resolveLlmProvider(env: Record<string, string | undefined>): LlmProvider {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) return "anthropic";
  if ((LLM_PROVIDERS as readonly string[]).includes(raw)) return raw as LlmProvider;
  throw new LlmProviderError(env.LLM_PROVIDER!.trim());
}

/** claude-sonnet-5-5 / claude-opus-5 -> family, major and optional minor. Dated ids (claude-sonnet-4-5-20250929) do not match. */
const ANTHROPIC_ID = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?$/;
const OPENROUTER_CLAUDE = /^~?anthropic\/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Settings hold Anthropic model ids (claude-haiku-5-5). OpenRouter names the same models anthropic/claude-haiku-5.5, so the
 * id is converted on the way out. An id that already has a slash ("anthropic/claude-sonnet-5.5", "~anthropic/claude-sonnet-latest")
 * is sent exactly as written, so any model OpenRouter offers can be typed in Settings.
 */
export function toOpenRouterModel(model: string): string {
  const m = model.trim();
  if (m.includes("/")) return m;
  const hit = ANTHROPIC_ID.exec(m);
  return hit ? `anthropic/claude-${hit[1]}-${hit[2]}${hit[3] ? `.${hit[3]}` : ""}` : m;
}

/** The other way round, so a setting written for OpenRouter keeps working after switching back to the Anthropic API. */
export function toAnthropicModel(model: string): string {
  const m = model.trim();
  const hit = OPENROUTER_CLAUDE.exec(m);
  return hit ? `claude-${hit[1]}-${hit[2]}${hit[3] ? `-${hit[3]}` : ""}` : m;
}

/** The model id that is actually sent to a provider. */
export function modelFor(provider: LlmProvider, model: string): string {
  return provider === "openrouter" ? toOpenRouterModel(model) : toAnthropicModel(model);
}

/** Usage units are named per model so two models with different prices are costed correctly (see computeCostUsd). */
export const modelUnit = (unit: "input_token" | "output_token", model: string) => `${unit}@${model}`;
