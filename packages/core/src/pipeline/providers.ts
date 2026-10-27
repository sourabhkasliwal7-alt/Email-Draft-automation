/**
 * Maps an adapter slot to the provider id used in price_table.provider, spend_caps.provider and
 * usage_records.provider. Enter prices and provider caps in Settings using these ids.
 */
export const PROVIDER_FOR_ADAPTER = {
  llm: "anthropic",
  search: "serper",
  fetcher: "fetcher",
  crunchbase: "crunchbase",
  apollo: "apollo",
  verifier: "verifier",
} as const;
export type PipelineAdapterName = keyof typeof PROVIDER_FOR_ADAPTER;
/** Where the language model is reached. Usage and prices are recorded under this id (the other adapters have a fixed one). */
export const LLM_PROVIDERS = ["anthropic", "openrouter"] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export type ProviderId = (typeof PROVIDER_FOR_ADAPTER)[PipelineAdapterName] | LlmProviderId;
export const PROVIDER_IDS: ProviderId[] = [...new Set<ProviderId>([...Object.values(PROVIDER_FOR_ADAPTER), ...LLM_PROVIDERS])];

/** The provider id a paid call is recorded under. Only the language model has a choice. */
export function providerIdFor(adapter: PipelineAdapterName, llmProvider: LlmProviderId = "anthropic"): ProviderId {
  return adapter === "llm" ? llmProvider : PROVIDER_FOR_ADAPTER[adapter];
}

/** Billing units each provider reports (what the mocks emit and what price_table rows must be keyed by). */
export const PROVIDER_UNITS: Record<ProviderId, string[]> = {
  anthropic: ["input_token", "output_token"],
  openrouter: ["input_token", "output_token"],
  serper: ["search"],
  apollo: ["credit"],
  verifier: ["verification"],
  crunchbase: ["lookup"],
  fetcher: [],
};
