import { describe, expect, it } from "vitest";
import { MAX_SUPPRESSION_ROWS, parseSuppressionCsv } from "../src/lib/suppression-csv";

describe("parseSuppressionCsv", () => {
  it("reads a single column, telling emails from domains and normalising both", () => {
    const r = parseSuppressionCsv("Bob@Example.com\nhttps://www.Blocked.com/x\n");
    expect(r.entries).toEqual([
      { email_lower: "bob@example.com", domain: null, reason: null },
      { email_lower: null, domain: "blocked.com", reason: null },
    ]);
  });

  it("reads a header row with email, domain and reason columns, and a UTF-8 BOM", () => {
    const r = parseSuppressionCsv("﻿email,domain,reason\na@x.com,,asked to stop\n,y.org,customer\n");
    expect(r.entries).toEqual([
      { email_lower: "a@x.com", domain: null, reason: "asked to stop" },
      { email_lower: null, domain: "y.org", reason: "customer" },
    ]);
  });

  it("reports bad rows individually and keeps the good ones", () => {
    const r = parseSuppressionCsv("ok@x.com\nnot an email@\nlocalhost\n\n  \nok2@x.com");
    expect(r.entries.map((e) => e.email_lower)).toEqual(["ok@x.com", "ok2@x.com"]);
    expect(r.invalid.map((i) => [i.row, i.problem])).toEqual([
      [2, "not a valid email"],
      [3, "not a valid domain"],
    ]);
  });

  it("drops duplicates inside the file (case-insensitive) and counts them", () => {
    const r = parseSuppressionCsv("a@x.com\nA@X.COM\nx.com\nX.com");
    expect(r.entries).toHaveLength(2);
    expect(r.duplicatesInFile).toBe(2);
  });

  it("refuses files over the row limit", () => {
    const big = Array.from({ length: MAX_SUPPRESSION_ROWS + 1 }, (_, i) => `u${i}@x.com`).join("\n");
    expect(parseSuppressionCsv(big).tooMany).toBe(true);
  });

  it("handles an empty file", () => {
    expect(parseSuppressionCsv("")).toMatchObject({ entries: [], invalid: [], tooMany: false });
  });
});
