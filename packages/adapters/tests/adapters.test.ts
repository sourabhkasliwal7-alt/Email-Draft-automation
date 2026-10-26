import { describe, expect, it } from "vitest";
import {
  EnvError,
  LiveAdapterNotImplementedError,
  assertAdapterEnv,
  createAdapters,
  createMockAdapters,
  resolveAdapterModes,
} from "../src";

describe("adapter selection", () => {
  it("defaults every adapter to mock with zero env", () => {
    const a = createAdapters({});
    expect(Object.values(a.modes).every((m) => m === "mock")).toBe(true);
  });

  it("is case-insensitive and rejects bad values, naming the variable", () => {
    expect(resolveAdapterModes({ ADAPTER_GMAIL: "LIVE" }).gmail).toBe("live");
    expect(() => resolveAdapterModes({ ADAPTER_LLM: "maybe" })).toThrow(/ADAPTER_LLM must be "mock" or "live"/);
  });

  it("live mode lists EVERY missing variable at once", () => {
    try {
      assertAdapterEnv({ ADAPTER_GMAIL: "live", ADAPTER_LLM: "live", ADAPTER_SEARCH: "live", SERPER_API_KEY: "k" });
      throw new Error("expected EnvError");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as EnvError).message;
      for (const v of ["ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"]) {
        expect(msg).toContain(v);
      }
      expect(msg).not.toContain("SERPER_API_KEY");
    }
  });

  it("a configured live adapter that is not built yet fails loudly instead of doing nothing", () => {
    const a = createAdapters({ ADAPTER_SEARCH: "live", SERPER_API_KEY: "k" });
    expect(() => a.search.search({ query: "x" })).toThrow(LiveAdapterNotImplementedError);
  });
});

describe("mock adapters", () => {
  const a = createMockAdapters();

  it("llm reports usage units for the price table", async () => {
    const r = await a.llm.complete({ tier: "cheap", prompt: "hello world" });
    expect(r.usage.units.input_token).toBeGreaterThan(0);
    expect(r.model).toBe("mock-cheap");
  });

  it("search is deterministic and respects num", async () => {
    const r1 = await a.search.search({ query: "Acme funding", num: 2 });
    const r2 = await a.search.search({ query: "Acme funding", num: 2 });
    expect(r1.results).toHaveLength(2);
    expect(r1).toEqual(r2);
  });

  it("verifier outcome follows the local part", async () => {
    expect((await a.verifier.verify("ok@x.com")).status).toBe("valid");
    expect((await a.verifier.verify("invalid.guy@x.com")).status).toBe("invalid");
    expect((await a.verifier.verify("risky@x.com")).status).toBe("risky");
  });

  it("gmail mock creates drafts and the mock sender only records in memory", async () => {
    const g = createMockAdapters();
    const d = await g.gmail.createDraft({ inboxId: "i", to: "a@b.com", subject: "s", bodyText: "b" });
    expect(d.draftId).toMatch(/^mock-draft-/);
    const s = await g.gmailSender.sendDraft({ inboxId: "i", draftId: d.draftId });
    expect(s.messageId).toMatch(/^mock-msg-/);
  });
});
