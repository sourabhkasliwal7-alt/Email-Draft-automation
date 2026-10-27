import { assertAdapterEnv, envValue } from "./env";
import { createLiveFetcher } from "./live/fetcher";
import { createLiveGmail, type GmailTokenStore } from "./live/gmail";
import { createLiveLlm } from "./live/anthropic";
import { createLiveSearch } from "./live/serper";
import { createLiveVerifier } from "./live/zerobounce";
import { notImplementedLive } from "./live";
import { createMockAdapters } from "./mock";
import type { Adapters, ApolloAdapter, CrunchbaseAdapter, GmailSender } from "./types";

export * from "./types";
export * from "./env";
export * from "./mock";
export { LiveAdapterNotImplementedError, LIVE_PHASE } from "./live";
export { createLiveLlm, DEFAULT_CHEAP_MODEL, DEFAULT_STRONG_MODEL, type MessagesClientLike } from "./live/anthropic";
export { createLiveSearch, parseSerperDate } from "./live/serper";
export { createLiveVerifier, mapZeroBounceStatus } from "./live/zerobounce";
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
 * Apollo and Crunchbase have no live adapter yet. The live Gmail *sender* is not built: sending stays off.
 */
export function createAdapters(env: Record<string, string | undefined> = process.env, deps: LiveDeps = {}): Adapters & { modes: ReturnType<typeof assertAdapterEnv> } {
  const modes = assertAdapterEnv(env);
  const mock = createMockAdapters();
  const need = (name: string) => envValue(env, name)!;
  if (modes.gmail === "live" && !deps.gmailTokens) throw new Error("ADAPTER_GMAIL=live needs a mailbox token store (the worker provides one)");
  return {
    modes,
    llm: modes.llm === "live" ? createLiveLlm({ apiKey: need("ANTHROPIC_API_KEY") }) : mock.llm,
    search: modes.search === "live" ? createLiveSearch({ apiKey: need("SERPER_API_KEY") }) : mock.search,
    fetcher: modes.fetcher === "live" ? createLiveFetcher() : mock.fetcher,
    crunchbase: modes.crunchbase === "live" ? notImplementedLive<CrunchbaseAdapter>("crunchbase") : mock.crunchbase,
    apollo: modes.apollo === "live" ? notImplementedLive<ApolloAdapter>("apollo") : mock.apollo,
    verifier: modes.verifier === "live" ? createLiveVerifier({ apiKey: need("VERIFIER_API_KEY") }) : mock.verifier,
    gmail:
      modes.gmail === "live"
        ? createLiveGmail({ clientId: need("GOOGLE_CLIENT_ID"), clientSecret: need("GOOGLE_CLIENT_SECRET"), encryptionKey: need("TOKEN_ENCRYPTION_KEY"), tokens: deps.gmailTokens! })
        : mock.gmail,
    gmailSender: modes.gmail === "live" ? notImplementedLive<GmailSender>("gmailSender") : mock.gmailSender,
  };
}
