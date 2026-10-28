import { describe, expect, it } from "vitest";
import { createLiveFetcher } from "../src";

const resolvePublic = async () => ["93.184.216.34"];
const LONG = "Acme builds web and mobile apps for agencies and software teams. We are hiring React developers and run a delivery studio in Pune. ".repeat(3);

type Route = { status?: number; type?: string; body?: string; throws?: boolean };

/** a fake internet: `site` answers the company's own address, `reader` answers r.jina.ai */
function net(site: Record<string, Route>, reader?: Route | ((url: string) => Route), robots = "") {
  const calls: string[] = [];
  const readerHeaders: Record<string, string>[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const u = new URL(input);
    calls.push(u.hostname === "r.jina.ai" ? `reader:${u.pathname.slice(1)}${u.search}` : `${u.hostname}${u.pathname}`);
    if (u.hostname === "r.jina.ai") {
      readerHeaders.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
      const r = typeof reader === "function" ? reader(input) : reader;
      if (!r) return new Response("", { status: 404 });
      if (r.throws) throw new Error("reader down");
      return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": "text/plain" } });
    }
    if (u.pathname === "/robots.txt") return new Response(robots, { status: robots ? 200 : 404 });
    const r = site[`${u.hostname}${u.pathname}`];
    if (!r) return new Response("", { status: 404 });
    if (r.throws) throw new TypeError("fetch failed");
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": r.type ?? "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, readerHeaders };
}
const readerCalls = (calls: string[]) => calls.filter((c) => c.startsWith("reader:"));

describe("live fetcher: Jina Reader fallback", () => {
  it("reads a page itself and does not call the reader when the page has text", async () => {
    const { fetchImpl, calls } = net({ "acme.com/": { body: `<html><body><p>${LONG}</p></body></html>` } }, { body: "unused" });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Acme builds web and mobile apps");
    expect(readerCalls(calls)).toEqual([]);
  });

  it("asks the reader when the page is a script-only shell with no text", async () => {
    const { fetchImpl, calls, readerHeaders } = net(
      { "acme.com/": { body: '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>' } },
      { body: `Title: Acme\nURL Source: https://acme.com/\nMarkdown Content:\n${LONG}` },
    );
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic, reader: { apiKey: "JINA-KEY" } }).fetchPage("https://acme.com/");
    expect(readerCalls(calls)).toEqual(["reader:https://acme.com/"]);
    expect(r).toMatchObject({ url: "https://acme.com/", status: 200 });
    expect(r.text).toContain("We are hiring React developers");
    expect(r.text).not.toContain("URL Source"); // the reader's header lines are dropped
    expect(readerHeaders[0]).toMatchObject({ accept: "text/plain", authorization: "Bearer JINA-KEY" });
  });

  it("asks the reader when the connection itself fails (a timeout or a TLS error)", async () => {
    const { fetchImpl, calls } = net({ "acme.com/": { throws: true } }, { body: LONG });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/");
    expect(r.status).toBe(200);
    expect(readerCalls(calls)).toHaveLength(1);
  });

  it("falls back to what it had when the reader cannot read it either: nothing is invented", async () => {
    const shell = '<html><body><div id="root"></div></body></html>';
    const { fetchImpl } = net({ "acme.com/": { body: shell } }, { status: 500 });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/");
    expect(r).toMatchObject({ status: 200, text: "" });
    const failing = net({ "acme.com/": { throws: true } }, { throws: true });
    await expect(createLiveFetcher({ fetchImpl: failing.fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/")).rejects.toThrow(/fetch failed/);
    // a reader answer that is itself a bot wall or too short is not used
    const wall = net({ "acme.com/": { body: shell } }, { body: "Verify you are human. Complete the CAPTCHA to continue. ".repeat(6) });
    expect((await createLiveFetcher({ fetchImpl: wall.fetchImpl, resolve: resolvePublic }).fetchPage("https://acme.com/")).text).toBe("");
  });

  it("never works around a block: robots.txt, logins, paywalls, CAPTCHAs, rate limits and local addresses do not reach the reader", async () => {
    const { fetchImpl, calls } = net(
      {
        "acme.com/private": { body: LONG },
        "acme.com/login": { status: 401 },
        "acme.com/forbidden": { status: 403 },
        "acme.com/slow": { status: 429 },
        "acme.com/captcha": { body: "<html><body><h1>Verify you are human</h1><p>Complete the CAPTCHA to continue</p></body></html>" },
        "acme.com/missing-text": { type: "application/pdf", body: "%PDF" },
      },
      { body: LONG },
      "User-agent: *\nDisallow: /private",
    );
    const f = createLiveFetcher({ fetchImpl, resolve: async (h) => (h === "intranet.corp" ? ["10.0.0.5"] : ["93.184.216.34"]) });
    expect(await f.fetchPage("https://acme.com/private")).toMatchObject({ status: 403, text: "" });
    expect(await f.fetchPage("https://acme.com/login")).toMatchObject({ status: 401, text: "" });
    expect(await f.fetchPage("https://acme.com/forbidden")).toMatchObject({ status: 403, text: "" });
    expect(await f.fetchPage("https://acme.com/slow")).toMatchObject({ status: 429, text: "" });
    expect(await f.fetchPage("https://acme.com/captcha")).toMatchObject({ status: 403, text: "" });
    expect(await f.fetchPage("https://acme.com/missing-text")).toMatchObject({ status: 415, text: "" });
    await expect(f.fetchPage("http://localhost/")).rejects.toThrow(/local/);
    await expect(f.fetchPage("http://intranet.corp/")).rejects.toThrow(/private/);
    await expect(f.fetchPage("ftp://acme.com/")).rejects.toThrow(/protocol/);
    expect(readerCalls(calls)).toEqual([]);
  });

  it("can be switched off", async () => {
    const { fetchImpl, calls } = net({ "acme.com/": { body: "<html><body></body></html>" } }, { body: LONG });
    const r = await createLiveFetcher({ fetchImpl, resolve: resolvePublic, reader: { enabled: false } }).fetchPage("https://acme.com/");
    expect(r.text).toBe("");
    expect(readerCalls(calls)).toEqual([]);
  });
});
