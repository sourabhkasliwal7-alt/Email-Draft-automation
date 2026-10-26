import { describe, expect, it } from "vitest";
import { MissingPriceError, computeCostUsd, emailDomain, formatKolkata, normalizeDomain, normalizeEmail } from "../src";

describe("normalize", () => {
  it("lowercases and trims emails, rejects invalid", () => {
    expect(normalizeEmail("  Jane.Doe@ACME.com ")).toBe("jane.doe@acme.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
  it("reduces urls to domains", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme.com:8080")).toBe("acme.com");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(emailDomain("A@B.Co")).toBe("b.co");
  });
});

describe("cost math", () => {
  const prices = [
    { provider: "llm", unit: "input_token", usdPerUnit: 0.000003, effectiveFrom: new Date("2026-01-01") },
    { provider: "llm", unit: "input_token", usdPerUnit: 0.000004, effectiveFrom: new Date("2026-06-01") },
    { provider: "llm", unit: "output_token", usdPerUnit: 0.000015, effectiveFrom: new Date("2026-01-01") },
  ];
  it("multiplies recorded usage by the price effective at that time", () => {
    const units = { input_token: 1000, output_token: 100 };
    expect(computeCostUsd("llm", units, prices, new Date("2026-03-01"))).toBe(0.0045);
    expect(computeCostUsd("llm", units, prices, new Date("2026-07-01"))).toBe(0.0055);
  });
  it("refuses to price a unit that has no price row", () => {
    expect(() => computeCostUsd("llm", { image: 1 }, prices)).toThrow(MissingPriceError);
    expect(() => computeCostUsd("llm", { input_token: 1 }, prices, new Date("2025-01-01"))).toThrow(MissingPriceError);
  });
});

describe("time", () => {
  it("renders UTC instants in Asia/Kolkata", () => {
    expect(formatKolkata("2026-10-26T00:00:00Z", { dateStyle: "short", timeStyle: "short", hour12: false })).toContain("05:30");
  });
});
