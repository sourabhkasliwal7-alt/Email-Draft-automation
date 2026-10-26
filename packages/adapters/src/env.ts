import { z } from "zod";

export const ADAPTER_NAMES = ["llm", "search", "fetcher", "crunchbase", "apollo", "verifier", "gmail"] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];
export type AdapterMode = "mock" | "live";

/** Env vars a live adapter needs. Mock mode needs none. */
export const LIVE_REQUIRED_VARS: Record<AdapterName, string[]> = {
  llm: ["ANTHROPIC_API_KEY"],
  search: ["SERPER_API_KEY"],
  fetcher: [],
  crunchbase: ["CRUNCHBASE_API_KEY"],
  apollo: ["APOLLO_API_KEY"],
  verifier: ["VERIFIER_API_KEY"],
  gmail: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
};

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvError";
  }
}

const modeSchema = z.enum(["mock", "live"]);

/** Treat empty / whitespace-only values (e.g. `FOO=` in a .env file) as unset. */
export function cleanEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
}

export function envVarFor(name: AdapterName): string {
  return `ADAPTER_${name.toUpperCase()}`;
}

/** Reads ADAPTER_<NAME>=mock|live (default mock). Throws EnvError listing every problem at once. */
export function resolveAdapterModes(env: Record<string, string | undefined>): Record<AdapterName, AdapterMode> {
  const problems: string[] = [];
  const modes = {} as Record<AdapterName, AdapterMode>;
  for (const name of ADAPTER_NAMES) {
    const key = envVarFor(name);
    const raw = env[key]?.trim();
    if (!raw) {
      modes[name] = "mock";
      continue;
    }
    const parsed = modeSchema.safeParse(raw.toLowerCase());
    if (parsed.success) modes[name] = parsed.data;
    else {
      modes[name] = "mock";
      problems.push(`${key} must be "mock" or "live" (got "${raw}")`);
    }
  }
  if (problems.length) throw new EnvError(problems);
  return modes;
}

/** Fails fast, naming every missing variable for every adapter set to live. Mock mode needs nothing. */
export function assertAdapterEnv(env: Record<string, string | undefined>): Record<AdapterName, AdapterMode> {
  const modes = resolveAdapterModes(env);
  const problems: string[] = [];
  for (const name of ADAPTER_NAMES) {
    if (modes[name] !== "live") continue;
    for (const v of LIVE_REQUIRED_VARS[name]) {
      if (!env[v]?.trim()) problems.push(`${v} is required because ${envVarFor(name)}=live`);
    }
  }
  if (problems.length) throw new EnvError(problems);
  return modes;
}
