import { describe, expect, it } from "vitest";
import { parseWorkflowConfig, toolsFor, workflowConfigToForm, workflowFormSchema, workflowFormToConfig } from "@outreach/core";
import {
  DEFAULT_TOOLS_SENTENCE,
  dataFlagsOf,
  emailStatusWords,
  failedDraftIds,
  hasEmailMismatch,
  joinSamples,
  mailboxNameWarning,
  matchToolRow,
  sampleCountNote,
  sampleStatus,
  splitKeywords,
  splitSamples,
  toolRowProblems,
  toolRowsFromConfig,
  toolRowsToText,
} from "../src/lib/email-style";
import { draftNotice } from "../src/lib/notices";
import { parseTools } from "../src/app/(app)/setup/schemas";

describe("Tools by industry rows", () => {
  it("splits keywords on commas, lower-cases, drops repeats and colons", () => {
    expect(splitKeywords("Health , medical;  health\nBio: tech")).toEqual(["health", "medical", "bio tech"]);
    expect(splitKeywords("  ")).toEqual([]);
  });

  it("turns rows into the saved text, default last, blank and half-filled rows dropped", () => {
    const text = toolRowsToText(
      [
        { keywords: "Health, medical", sentence: "FHIR and HIPAA-ready hosting." },
        { keywords: "", sentence: "no keywords" },
        { keywords: "fintech", sentence: "" },
        { keywords: "saas", sentence: "  React\n  and Node.  " },
      ],
      "Default stack.",
    );
    expect(text).toBe("health, medical: FHIR and HIPAA-ready hosting.\nsaas: React and Node.\ndefault: Default stack.");
  });

  it("always has a default row, even when it was emptied", () => {
    expect(toolRowsToText([], "")).toBe(`default: ${DEFAULT_TOOLS_SENTENCE}`);
    expect(toolRowsFromConfig({ saas: "React." })).toEqual({ rows: [{ keywords: "saas", sentence: "React." }], fallback: DEFAULT_TOOLS_SENTENCE });
  });

  it("round-trips through the saved text and through the workflow form", () => {
    const rows = [
      { keywords: "health, medical", sentence: "FHIR." },
      { keywords: "saas", sentence: "React." },
    ];
    const table = parseTools(toolRowsToText(rows, "Node."));
    expect(table).toEqual({ "health, medical": "FHIR.", saas: "React.", default: "Node." });
    expect(toolRowsFromConfig(table)).toEqual({ rows, fallback: "Node." });
    // the same text goes through the core form conversion unchanged
    const cfg = parseWorkflowConfig({ tools_by_industry: table, postal_address: "1 Main St, Pune", optout_line: "Reply STOP.", white_label_line: "White-label work for agencies." });
    const form = workflowConfigToForm(cfg);
    expect(toolRowsFromConfig(parseTools(form.tools_by_industry!)).rows).toEqual(rows);
    const back = workflowFormToConfig(workflowFormSchema.parse({ ...form, schedule_enabled: false, dry_run: false, allow_risky: false }), cfg);
    expect(back.tools_by_industry).toEqual(table);
  });

  it("explains a half-filled row", () => {
    expect(toolRowProblems([{ keywords: "saas", sentence: "" }, { keywords: "", sentence: "x" }, { keywords: "a", sentence: "b" }, { keywords: "", sentence: "" }])).toEqual({
      0: "Add the tools sentence for this industry, or remove the row.",
      1: "Add at least one industry or keyword, or remove the row.",
    });
  });

  it("tells which row a lead would use: the same rule the writer uses", () => {
    const rows = [
      { keywords: "health, medical", sentence: "FHIR." },
      { keywords: "healthtech", sentence: "Healthtech stack." },
      { keywords: "fintech", sentence: "Payments." },
    ];
    expect(matchToolRow("software agency", "Hospital & Health Care", rows)).toEqual({ row: 0, sentence: "FHIR." });
    expect(matchToolRow("healthtech platform", "", rows)).toEqual({ row: 1, sentence: "Healthtech stack." }); // the longer keyword is more specific
    expect(matchToolRow("saas", "FinTech", rows)).toEqual({ row: 2, sentence: "Payments." });
    expect(matchToolRow("logistics", "transport", rows)).toEqual({ row: "default", sentence: null });
    // and it agrees with core's toolsFor on the saved table
    const table = parseTools(toolRowsToText(rows, "Default."));
    for (const [bt, ind] of [["software agency", "Hospital & Health Care"], ["healthtech platform", ""], ["logistics", "transport"]] as const) {
      const m = matchToolRow(bt, ind, rows);
      expect(toolsFor(bt, table, ind)).toBe(m.sentence ?? "Default.");
    }
  });
});

describe("Sample emails", () => {
  it("round-trips the saved format (samples separated by a line with only ---)", () => {
    const list = ["Hi A,\n\nOne.", "Hi B,\n\nTwo."];
    expect(joinSamples(list)).toBe("Hi A,\n\nOne.\n---\nHi B,\n\nTwo.");
    expect(splitSamples(joinSamples(list))).toEqual(list);
    expect(splitSamples("a\r\n---\r\nb")).toEqual(["a", "b"]);
  });

  it("drops blank samples and a dashes-only line inside a sample", () => {
    expect(joinSamples(["  ", "Hi A\n---\nmore", "", "Hi B"])).toBe("Hi A\nmore\n---\nHi B");
    expect(splitSamples("\n---\n\n---\n")).toEqual([]);
  });

  it("counts, warns under three and refuses more than five", () => {
    expect(sampleCountNote(3)).toBe("3 of 3-5 recommended");
    expect(sampleStatus(0)).toMatchObject({ level: "warn" });
    expect(sampleStatus(2).message).toMatch(/Three to five good samples work best. You have 2/);
    expect(sampleStatus(3)).toEqual({ level: "ok", message: null });
    expect(sampleStatus(5)).toEqual({ level: "ok", message: null });
    expect(sampleStatus(6)).toEqual({ level: "error", message: "Use at most 5 sample emails. Remove 1." });
  });
});

describe("Mailbox display name", () => {
  const company = "Nuance Infotech";
  it("warns when the display name is the company name (any spelling), or empty", () => {
    for (const name of ["Nuance Infotech", "nuance infotech", "Nuance Infotech Pvt Ltd", "NUANCE-INFOTECH"]) {
      expect(mailboxNameWarning({ displayName: name, email: "a@x.com", company }), name).toBe("The display name is the company name, so emails would be signed with the company only. Use a person's name, for example 'Sam Rivera'.");
    }
    expect(mailboxNameWarning({ displayName: "", email: "a@x.com", company })).toMatch(/no display name/);
    expect(mailboxNameWarning({ displayName: null, email: "a@x.com", company })).toMatch(/no display name/);
  });
  it("is quiet for a person's name", () => {
    expect(mailboxNameWarning({ displayName: "Sam Rivera", email: "sam@x.com", company })).toBeNull();
    expect(mailboxNameWarning({ displayName: "Sourabh K", email: "s@x.com", company })).toBeNull();
  });
});

describe("Email status in plain words", () => {
  it("shows Verified only for a checked address; catch-all and guessed are Risky; unchecked is Not checked", () => {
    expect(emailStatusWords("valid")).toEqual({ label: "Verified", tone: "green" });
    expect(emailStatusWords("risky")).toEqual({ label: "Risky (catch-all or unverified)", tone: "amber" });
    expect(emailStatusWords("catch_all").label).toBe("Risky (catch-all or unverified)"); // an old row from before catch-all became risky
    expect(emailStatusWords("unknown")).toEqual({ label: "Not checked", tone: "neutral" });
    expect(emailStatusWords(null).label).toBe("Not checked");
    expect(emailStatusWords(undefined).label).toBe("Not checked");
    expect(emailStatusWords("invalid")).toEqual({ label: "Invalid", tone: "red" });
    for (const s of ["unknown", "risky", "catch_all", "guessed", null]) expect(emailStatusWords(s).label, String(s)).not.toBe("Verified");
  });
});

describe("Data flags on a lead", () => {
  it("reads score_components.data_flags defensively", () => {
    expect(dataFlagsOf({ data_flags: ["email domain mismatch", 3, null] })).toEqual(["email domain mismatch"]);
    expect(dataFlagsOf(null)).toEqual([]);
    expect(dataFlagsOf({ data_flags: "x" })).toEqual([]);
    expect(hasEmailMismatch({ data_flags: ["email domain mismatch"] })).toBe(true);
    expect(hasEmailMismatch({})).toBe(false);
  });
});

describe("Retry all failed drafts", () => {
  it("applies to leads skipped as draft-failed only", () => {
    const leads = [
      { id: "a", status: "disqualified", reason_codes: ["draft-failed", "W4: link"] },
      { id: "b", status: "disqualified", reason_codes: ["gmail-failed", "x"] },
      { id: "c", status: "approved", reason_codes: [] },
      { id: "d", status: "disqualified", reason_codes: ["draft-failed"] },
      { id: "e", status: "approved", reason_codes: ["draft-failed"] }, // not skipped: handled by the run
      { id: "f", status: "disqualified", reason_codes: null },
    ];
    expect(failedDraftIds(leads)).toEqual(["a", "d"]);
    expect(failedDraftIds([])).toEqual([]);
  });

  it("the notice says how many drafts will be written again (writing step only)", () => {
    expect(draftNotice("retry_drafts_started", "7")).toBe("7 drafts will be written again (writing step only). A run has started: watch it on Home.");
    expect(draftNotice("retry_drafts_running", "1")).toMatch(/^1 draft will be written again \(writing step only\)/);
    expect(draftNotice("retry_drafts_paused", "3")).toMatch(/^3 drafts will be written again .* paused/);
    expect(draftNotice("retry_drafts_started", "abc")).toMatch(/^0 drafts/);
    expect(draftNotice("nonsense", "3")).toBeNull();
    expect(draftNotice(undefined)).toBeNull();
    expect(draftNotice("retry_started")).toMatch(/^Done\./);
  });
});
