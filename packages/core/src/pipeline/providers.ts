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
export type ProviderId = (typeof PROVIDER_FOR_ADAPTER)[PipelineAdapterName];
export const PROVIDER_IDS: ProviderId[] = Object.values(PROVIDER_FOR_ADAPTER);

/** Billing units each provider reports (what the mocks emit and what price_table rows must be keyed by). */
export const PROVIDER_UNITS: Record<ProviderId, string[]> = {
  anthropic: ["input_token", "output_token"],
  serper: ["search"],
  apollo: ["credit"],
  verifier: ["verification"],
  crunchbase: ["lookup"],
  fetcher: [],
};
