import type { VerifierAdapter, VerifyStatus } from "../types";
import { requestJson, type FetchLike } from "./http";

const URL_VALIDATE = "https://api.zerobounce.net/v2/validate";

/**
 * ZeroBounce statuses -> ours. Anything that must never be mailed (invalid, spam trap, abuse, do-not-mail) is "invalid";
 * catch-all stays its own status so the run's allow_risky setting decides. Unknown values are "unknown", never "valid".
 */
export function mapZeroBounceStatus(status: unknown): VerifyStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "valid":
      return "valid";
    case "invalid":
    case "spamtrap":
    case "abuse":
    case "do_not_mail":
      return "invalid";
    case "catch-all":
    case "catch_all":
      return "catch_all";
    default:
      return "unknown";
  }
}

export function createLiveVerifier(opts: { apiKey: string; fetchImpl?: FetchLike }): VerifierAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async verify(email) {
      // ZeroBounce takes the key as a query parameter; the helper never puts the URL in an error message
      const url = `${URL_VALIDATE}?${new URLSearchParams({ api_key: opts.apiKey, email, ip_address: "" }).toString()}`;
      const json = await requestJson<{ status?: string; error?: string }>(fetchImpl, url, {}, { label: "ZeroBounce validate", redact: [opts.apiKey] });
      if (json.error) throw new Error(`ZeroBounce validate failed: ${String(json.error).replace(opts.apiKey, "***").slice(0, 200)}`);
      // one validation = one billing unit; an "unknown" answer is not charged by ZeroBounce, but the price table decides cost
      return { status: mapZeroBounceStatus(json.status), usage: { units: { verification: 1 } } };
    },
  };
}
