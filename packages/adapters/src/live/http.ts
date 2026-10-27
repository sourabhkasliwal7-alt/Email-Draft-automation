export type FetchLike = typeof fetch;

/** An HTTP failure with a message that is safe to show and log: it never contains a key, token or query string. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string = "",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  label: string;
  timeoutMs?: number;
  /** extra attempts after the first one, for 429 / 5xx / network errors only */
  retries?: number;
  /** strings that must never appear in an error message */
  redact?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function redactText(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("***");
  return out;
}

/** JSON request with a timeout and bounded retries. Non-2xx responses throw HttpError. */
export async function requestJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit, opts: RequestOptions): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
      const text = await res.text();
      if (res.ok) return (text ? JSON.parse(text) : {}) as T;
      const err = new HttpError(res.status, `${opts.label} failed (${res.status}): ${redactText(text.slice(0, 300), opts.redact ?? [])}`, text);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastError = err;
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 5) * 1000 : 400 * 2 ** attempt);
        continue;
      }
      throw err;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastError = e;
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw lastError instanceof HttpError ? lastError : new Error(`${opts.label} failed: ${redactText(reason, opts.redact ?? [])}`);
}
