import { assertAdapterEnv } from "./env";
import { notImplementedLive } from "./live";
import { createMockAdapters } from "./mock";
import type { Adapters, ApolloAdapter, CrunchbaseAdapter, FetcherAdapter, GmailAdapter, GmailSender, LlmAdapter, SearchAdapter, VerifierAdapter } from "./types";

export * from "./types";
export * from "./env";
export * from "./mock";
export { LiveAdapterNotImplementedError, LIVE_PHASE } from "./live";

/**
 * Builds every adapter, picking mock or live per ADAPTER_<NAME>. Mock mode needs zero external keys.
 * Live mode validates its variables up front and lists everything that is missing.
 * The live Gmail *sender* additionally requires ALLOW_LIVE_SEND=true (enforced in Phase 11).
 */
export function createAdapters(env: Record<string, string | undefined> = process.env): Adapters & { modes: ReturnType<typeof assertAdapterEnv> } {
  const modes = assertAdapterEnv(env);
  const mock = createMockAdapters();
  return {
    modes,
    llm: modes.llm === "live" ? notImplementedLive<LlmAdapter>("llm") : mock.llm,
    search: modes.search === "live" ? notImplementedLive<SearchAdapter>("search") : mock.search,
    fetcher: modes.fetcher === "live" ? notImplementedLive<FetcherAdapter>("fetcher") : mock.fetcher,
    crunchbase: modes.crunchbase === "live" ? notImplementedLive<CrunchbaseAdapter>("crunchbase") : mock.crunchbase,
    apollo: modes.apollo === "live" ? notImplementedLive<ApolloAdapter>("apollo") : mock.apollo,
    verifier: modes.verifier === "live" ? notImplementedLive<VerifierAdapter>("verifier") : mock.verifier,
    gmail: modes.gmail === "live" ? notImplementedLive<GmailAdapter>("gmail") : mock.gmail,
    gmailSender: modes.gmail === "live" ? notImplementedLive<GmailSender>("gmailSender") : mock.gmailSender,
  };
}
