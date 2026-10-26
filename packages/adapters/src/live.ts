import type { AdapterName } from "./env";

export class LiveAdapterNotImplementedError extends Error {
  constructor(adapter: string, phase: number) {
    super(
      `Live "${adapter}" adapter is built in Phase ${phase}. Set ADAPTER_${adapter.toUpperCase()}=mock until then.`,
    );
    this.name = "LiveAdapterNotImplementedError";
  }
}

/** Phase in which each live adapter is implemented (see docs/IMPLEMENTATION_PLAN.md). */
export const LIVE_PHASE: Record<AdapterName | "gmailSender", number> = {
  llm: 9,
  search: 6,
  fetcher: 6,
  crunchbase: 7,
  apollo: 8,
  verifier: 8,
  gmail: 10,
  gmailSender: 11,
};

/** Placeholder that fails loudly on first use, so a half-configured live setup cannot silently do nothing. */
export function notImplementedLive<T extends object>(adapter: AdapterName | "gmailSender"): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === "then") return undefined; // not a thenable
      return () => {
        throw new LiveAdapterNotImplementedError(adapter, LIVE_PHASE[adapter]);
      };
    },
  });
}
