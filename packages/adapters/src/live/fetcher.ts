import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FetchedPage, FetcherAdapter } from "../types";
import type { FetchLike } from "./http";

const MAX_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_REDIRECTS = 5;
export const FETCHER_USER_AGENT = "AI-Outreach-Engine/1.0 (research of public company pages; honours robots.txt)";
const ROBOTS_TOKEN = "ai-outreach-engine";

// ---------------------------------------------------------------- never let a lead's website point us at the local network
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  const v4 = mapped ? mapped[1]! : v;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v4);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// ---------------------------------------------------------------- robots.txt (RFC 9309, the parts that matter here)
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow") cur.allow.push(value);
    else if (key === "disallow") cur.disallow.push(value);
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && ROBOTS_TOKEN.includes(a)));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return { allow: pick.flatMap((g) => g.allow), disallow: pick.flatMap((g) => g.disallow) };
}

function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false; // an empty Disallow allows everything
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path);
}

/** Longest matching rule wins; on a tie Allow wins. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let best = { len: -1, allow: true };
  for (const r of rules.disallow) if (ruleMatches(r, path) && r.length > best.len) best = { len: r.length, allow: false };
  for (const r of rules.allow) if (ruleMatches(r, path) && r.length >= best.len) best = { len: r.length, allow: true };
  return best.allow;
}

// ---------------------------------------------------------------- HTML -> readable text
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };

export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const text = withoutNoise
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_TEXT_CHARS);
}

/** A page that is a bot wall, not content. We report it as unreadable and never try to get past it. */
const WALL = /captcha|verify (that )?you are (a )?human|are you a robot|checking your browser|access denied|enable javascript and cookies|attention required/i;

/** A refusal on our side (a local address, a bad protocol). Never retried through the reader. */
class RefusedFetch extends Error {}

export const JINA_READER_URL = "https://r.jina.ai/";
/** a page with less readable text than this counts as "could not be read" (a script-only shell, a thin or empty page) */
const THIN_TEXT = 200;

export interface ReaderOptions {
  /** switch the fallback off (FETCHER_READER=off) */
  enabled?: boolean;
  baseUrl?: string;
  /** optional Jina key (JINA_API_KEY) for a higher rate limit; the free reader works without one */
  apiKey?: string;
}

export interface LiveFetcherOptions {
  fetchImpl?: FetchLike;
  /** Jina Reader fallback, tried only when our own fetch could not read a page (see createLiveFetcher) */
  reader?: ReaderOptions;
  userAgent?: string;
  /** resolves a hostname to its IP addresses (replaceable in tests) */
  resolve?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
}

const defaultResolve = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/** Public pages only: robots.txt is honoured, redirects are re-checked, and logins, paywalls and CAPTCHAs are reported as unreadable, never bypassed. */
export function createLiveFetcher(opts: LiveFetcherOptions = {}): FetcherAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ua = opts.userAgent ?? FETCHER_USER_AGENT;
  const resolve = opts.resolve ?? defaultResolve;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const robots = new Map<string, Promise<RobotsRules | "blocked">>();

  async function assertPublic(u: URL) {
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new RefusedFetch(`unsupported protocol ${u.protocol}`);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new RefusedFetch("refusing to fetch a local address");
    const addrs = isIP(host) ? [host] : await resolve(host);
    if (!addrs.length || addrs.some(isPrivateAddress)) throw new RefusedFetch("refusing to fetch a private or unresolvable address");
  }

  const get = (url: string, accept: string) => fetchImpl(url, { redirect: "manual", headers: { "user-agent": ua, accept, "accept-language": "en" }, signal: AbortSignal.timeout(timeoutMs) });

  function robotsFor(u: URL): Promise<RobotsRules | "blocked"> {
    let p = robots.get(u.origin);
    if (!p) {
      p = (async () => {
        try {
          const res = await get(`${u.origin}/robots.txt`, "text/plain");
          if (res.status >= 500) return "blocked"; // unreachable robots.txt: assume the site does not want crawlers
          if (res.status !== 200) return { allow: [], disallow: [] };
          return parseRobots((await res.text()).slice(0, 500_000));
        } catch {
          return { allow: [], disallow: [] }; // the site itself will fail to load below if it is down
        }
      })();
      robots.set(u.origin, p);
    }
    return p;
  }

  const reader = { enabled: true, baseUrl: JINA_READER_URL, ...opts.reader };

  /**
   * Jina Reader (r.jina.ai/<url>) returns the readable text of a public page, including pages that only draw themselves with scripts.
   * It is the fallback, used ONLY when our own fetch could not read the page: a connection error, or a page with (almost) no text.
   * It is never used after robots.txt said no, after a login, paywall, CAPTCHA or any 4xx answer, or for a local address: those are
   * blocks, and a block is never worked around.
   */
  async function viaReader(url: string): Promise<FetchedPage | null> {
    try {
      const res = await fetchImpl(`${reader.baseUrl}${url}`, {
        headers: { accept: "text/plain", "x-return-format": "text", "user-agent": ua, ...(reader.apiKey ? { authorization: `Bearer ${reader.apiKey}` } : {}) },
        signal: AbortSignal.timeout(Math.max(timeoutMs, 30_000)),
      });
      if (res.status !== 200) return null;
      const body = (await res.text()).replace(/^(?:(?:Title|URL Source|Published Time|Warning|Markdown Content):[^\n]*\n)+/i, "").replace(/^\s*Markdown Content:\s*/i, "").trim();
      const text = body.slice(0, MAX_TEXT_CHARS);
      if (text.length < THIN_TEXT || (text.length < 2000 && WALL.test(text))) return null;
      return { url, status: 200, text, retrievedAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  return {
    async fetchPage(url) {
      let first: FetchedPage | null = null;
      let failure: unknown = null;
      try {
        first = await fetchPlain(url);
      } catch (e) {
        const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
        if (e instanceof RefusedFetch || code === "ENOTFOUND") throw e;
        failure = e; // a connection problem or a timeout: the reader may still be able to read the page
      }
      const unreadable = first ? first.status === 200 && first.text.trim().length < THIN_TEXT : true;
      if (!unreadable) return first!;
      if (reader.enabled) {
        const read = await viaReader(first?.url ?? url);
        if (read) return read;
      }
      if (first) return first;
      throw failure;
    },
  };

  async function fetchPlain(url: string): Promise<FetchedPage> {
    {
      const retrievedAt = new Date().toISOString();
      let current = new URL(url);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertPublic(current);
        const rules = await robotsFor(current);
        if (rules === "blocked" || !robotsAllows(rules, current.pathname + current.search)) return { url: current.toString(), status: 403, text: "", retrievedAt };

        const res = await get(current.toString(), "text/html,text/plain;q=0.9");
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          current = new URL(res.headers.get("location")!, current);
          continue;
        }
        // logins, paywalls and rate limits are reported as they are; we never try to get past them
        if (res.status !== 200) return { url: current.toString(), status: res.status, text: "", retrievedAt };
        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        if (type && !/text\/html|text\/plain|application\/xhtml/.test(type)) return { url: current.toString(), status: 415, text: "", retrievedAt };

        const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
        const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
        let html: string;
        try {
          html = new TextDecoder(charset).decode(buf);
        } catch {
          html = new TextDecoder("utf-8").decode(buf);
        }
        const text = /text\/plain/.test(type) ? html.trim().slice(0, MAX_TEXT_CHARS) : htmlToText(html);
        if (text.length < 2000 && WALL.test(text)) return { url: current.toString(), status: 403, text: "", retrievedAt };
        return { url: current.toString(), status: 200, text, retrievedAt };
      }
      return { url: current.toString(), status: 310, text: "", retrievedAt }; // too many redirects
    }
  }
}
