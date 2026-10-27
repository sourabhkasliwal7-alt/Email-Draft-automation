import { assertAdapterEnv, envValue } from "./env";
import { createLiveApollo } from "./live/apollo";
import { createLiveFetcher } from "./live/fetcher";
import { createLiveGmail, type GmailTokenStore } from "./live/gmail";
import { createLiveLlm } from "./live/anthropic";
import { resolveLlmProvider, type LlmProvider } from "./live/llm-models";
import { createOpenRouterLlm } from "./live/openrouter";
import { createLiveSearch } from "./live/serper";
import { createLiveVerifier } from "./live/zerobounce";
import { notImplementedLive } from "./live";
import { createMockAdapters } from "./mock";
import type { Adapters, CrunchbaseAdapter, GmailSender } from "./types";

export * from "./types";
export * from "./env";
export * from "./mock";
export { LiveAdapterNotImplementedError, LIVE_PHASE } from "./live";
export { createLiveLlm, type MessagesClientLike } from "./live/anthropic";
export { createOpenRouterLlm, OPENROUTER_URL } from "./live/openrouter";
export { DEFAULT_CHEAP_MODEL, DEFAULT_STRONG_MODEL, LLM_KEY_VAR, LLM_PROVIDERS, LlmProviderError, modelFor, modelUnit, resolveLlmProvider, toAnthropicModel, toOpenRouterModel, type LlmProvider } from "./live/llm-models";
export { createLiveSearch, parseSerperDate } from "./live/serper";
export { createLiveVerifier, mapZeroBounceStatus } from "./live/zerobounce";
export { APOLLO_BASE, APOLLO_SENIORITIES, createLiveApollo, employeeRange, toQuery } from "./live/apollo";
export { createLiveFetcher, htmlToText, isPrivateAddress, parseRobots, robotsAllows } from "./live/fetcher";
export { buildRawMessage, createLiveGmail, MailboxNeedsReconnectError, type GmailInboxRecord, type GmailTokenStore, type LiveGmailOptions } from "./live/gmail";
export { decryptToken, encryptToken, parseEncryptionKey } from "./live/token-crypto";
export * from "./live/google";
export { HttpError, requestJson, type FetchLike } from "./live/http";

/** Things the live adapters need that only the host (the worker) can provide. */
export interface LiveDeps {
  /** where mailbox sign-ins are stored; required when ADAPTER_GMAIL=live */
  gmailTokens?: GmailTokenStore;
}

/**
 * Builds every adapter, picking mock or live per ADAPTER_<NAME>. Mock mode needs zero external keys.
 * Live mode validates its variables up front and lists everything that is missing.
 * Crunchbase has no live adapter (it is not part of the product). The live Gmail *sender* is not built: sending stays off.
 */
export function createAdapters(env: Record<string, string | undefined> = process.env, deps: LiveDeps = {}): Adapters & { modes: ReturnType<typeof assertAdapterEnv>; llmProvider: LlmProvider } {
  const modes = assertAdapterEnv(env);
  const llmProvider = resolveLlmProvider(env);
  const mock = createMockAdapters();
  const need = (name: string) => envValue(env, name)!;
  if (modes.gmail === "live" && !deps.gmailTokens) throw new Error("ADAPTER_GMAIL=live needs a mailbox token store (the worker provides one)");
  return {
    modes,
    llmProvider,
    llm:
      modes.llm !== "live"
        ? mock.llm
        : llmProvider === "openrouter"
          ? createOpenRouterLlm({ apiKey: need("OPENROUTER_API_KEY"), siteUrl: envValue(env, "NEXT_PUBLIC_SITE_URL") })
          : createLiveLlm({ apiKey: need("ANTHROPIC_API_KEY") }),
    search: modes.search === "live" ? createLiveSearch({ apiKey: need("SERPER_API_KEY") }) : mock.search,
    fetcher: modes.fetcher === "live" ? createLiveFetcher() : mock.fetcher,
    crunchbase: modes.crunchbase === "live" ? notImplementedLive<CrunchbaseAdapter>("crunchbase") : mock.crunchbase,
    apollo: modes.apollo === "live" ? createLiveApollo({ apiKey: need("APOLLO_API_KEY") }) : mock.apollo,
    verifier: modes.verifier === "live" ? createLiveVerifier({ apiKey: need("VERIFIER_API_KEY") }) : mock.verifier,
    gmail:
      modes.gmail === "live"
        ? createLiveGmail({ clientId: need("GOOGLE_CLIENT_ID"), clientSecret: need("GOOGLE_CLIENT_SECRET"), encryptionKey: need("TOKEN_ENCRYPTION_KEY"), tokens: deps.gmailTokens! })
        : mock.gmail,
    gmailSender: modes.gmail === "live" ? notImplementedLive<GmailSender>("gmailSender") : mock.gmailSender,
  };
}
