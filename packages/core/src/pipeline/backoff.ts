export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message ?? `Provider HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

export class BackoffExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(`gave up after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    this.name = "BackoffExhaustedError";
  }
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET"]);

/** Retry 429, 408, 5xx and network faults. Never any other 4xx (a bad request will not get better). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderHttpError) return err.status === 429 || err.status === 408 || (err.status >= 500 && err.status <= 599);
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && /fetch failed/i.test(msg)) return true;
  }
  return false;
}

/** Full jitter: random() * min(cap, base * 2^(attempt-1)). `attempt` starts at 1 (the wait after the first failure). */
export function computeBackoffMs(o: { attempt: number; baseMs?: number; capMs?: number; random?: () => number }): number {
  const { attempt, baseMs = 500, capMs = 30_000, random = Math.random } = o;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * ceiling);
}

export interface WithBackoffOptions {
  maxAttempts?: number;
  baseMs?: number;
  capMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  retryable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs fn, retrying retryable failures with full-jitter exponential backoff (a Retry-After header is a floor).
 * Non-retryable errors are thrown unchanged; running out of attempts throws BackoffExhaustedError.
 */
export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: WithBackoffOptions = {}): Promise<T> {
  const { maxAttempts = 5, sleep = defaultSleep, random = Math.random, onRetry, retryable = isRetryable } = opts;
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (!retryable(err)) throw err;
      if (attempt === maxAttempts) break;
      let delay = computeBackoffMs({ attempt, baseMs: opts.baseMs, capMs: opts.capMs, random });
      if (err instanceof ProviderHttpError && err.retryAfterMs !== undefined) delay = Math.max(delay, err.retryAfterMs);
      onRetry?.({ attempt, delayMs: delay, error: err });
      await sleep(delay);
    }
  }
  throw new BackoffExhaustedError(maxAttempts, last);
}
