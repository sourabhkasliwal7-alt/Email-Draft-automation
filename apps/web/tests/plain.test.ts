import { describe, expect, it } from "vitest";
import { ATTENTION_REASONS, SKIP_REASONS, retryPatch } from "@outreach/core";
import { buildChecklist, setupComplete } from "../src/lib/checklist";
import { PLAIN_PAUSE, PLAIN_REASON, gmailDraftUrl, gmailDraftsUrl, isAttentionReason, plainDetail, plainLeadStatus, plainReason, plainStep } from "../src/lib/plain";

/** words that belong in Setup > Advanced only */
const INTERNAL = /\b(adapter|ledger|reveal|stage [ab]|ICP|pipeline|batch|quote check|extraction|webhook|waterfall)\b/i;

describe("plain language", () => {
  it("every reason a lead can be skipped or parked for has a plain sentence without internal words", () => {
    for (const code of SKIP_REASONS) {
      const text = PLAIN_REASON[code];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toMatch(INTERNAL);
      expect(text.length, code).toBeGreaterThan(10);
    }
    expect(plainReason("something-new")).toBe("something-new");
    expect(plainReason(undefined)).toBe("");
  });

  it("names the step that failed in plain words", () => {
    expect(plainDetail("step-failed", "write: OpenRouter says the account has too few credits (402)")).toBe("Writing the email: OpenRouter says the account has too few credits (402)");
    expect(plainDetail("step-failed", "reveal: ZeroBounce validate failed")).toBe("Getting and checking the email address: ZeroBounce validate failed");
    expect(plainDetail("step-failed", "weird: x")).toBe("weird: x");
    expect(plainDetail("draft-failed", "W2: 2 question marks")).toBe("W2: 2 question marks");
    expect(plainDetail("step-failed", undefined)).toBe("");
    // the worker's own wording is softened for the main screens
    expect(plainDetail("no-email", "no email in the CSV and no Apollo id to reveal one")).toBe("no email in the CSV and no Apollo id to unlock one");
    expect(plainDetail("credit-uncertain", "the ledger row stayed started; revealed twice?")).toBe("the credit record row stayed started; unlocked twice?");
  });

  it("describes where a lead stands", () => {
    expect(plainLeadStatus({ status: "imported" }).label).toBe("Found");
    expect(plainLeadStatus({ status: "researching" }).label).toBe("Checked");
    expect(plainLeadStatus({ status: "scored" }).label).toBe("Researched");
    expect(plainLeadStatus({ status: "approved", next_action: "draft" }).label).toBe("Approved, preparing the email");
    expect(plainLeadStatus({ status: "draft_ready" })).toEqual({ label: "Draft ready", tone: "green" });
    expect(plainLeadStatus({ status: "disqualified", reason_codes: ["below-threshold", "score 52"] }).label).toBe("Skipped: Score too low to write to");
    const attention = plainLeadStatus({ status: "approved", next_action: "draft", reason_codes: ["step-failed", "write: x"] });
    expect(attention.tone).toBe("red");
    expect(attention.label).toMatch(/^Needs attention: /);
    for (const code of ATTENTION_REASONS) expect(isAttentionReason(code)).toBe(true);
    expect(isAttentionReason("below-threshold")).toBe(false);
  });

  it("run steps and pauses read like sentences", () => {
    expect(plainStep("research and score")).toBe("research and scoring");
    expect(plainStep(undefined)).toBe("starting");
    expect(plainStep("unheard-of")).toBe("unheard-of");
    for (const text of Object.values(PLAIN_PAUSE)) expect(text).not.toMatch(INTERNAL);
  });

  it("Gmail links open the mailbox that holds the draft, by message id when there is one", () => {
    expect(gmailDraftsUrl("me+x@gmail.com")).toBe("https://mail.google.com/mail/u/?authuser=me%2Bx%40gmail.com#drafts");
    expect(gmailDraftUrl("me@gmail.com", "18c0ffee")).toBe("https://mail.google.com/mail/u/?authuser=me%40gmail.com#drafts?compose=18c0ffee");
    expect(gmailDraftUrl("me@gmail.com", null)).toBe("https://mail.google.com/mail/u/?authuser=me%40gmail.com#drafts");
  });
});

describe("Getting started checklist", () => {
  const none = { gmailConnected: false, offers: 0, footerSet: false, campaigns: 0, leads: 0, realRuns: 0 };
  it("lists the six steps in the order a new person does them", () => {
    const steps = buildChecklist(none);
    expect(steps.map((s) => s.label)).toEqual(["Connect Gmail", "Add your offer", "Fill in the email footer", "Create a campaign", "Add leads (CSV or Apollo)", "Start your first run"]);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(setupComplete(steps)).toBe(false);
    expect(steps.map((s) => s.href)).toEqual(["/setup?tab=gmail", "/setup?tab=offers", "/setup?tab=footer", "/setup?tab=campaigns", "/leads", "#start"]);
  });
  it("ticks each step from the data and is complete only when every step is", () => {
    expect(buildChecklist({ ...none, gmailConnected: true, offers: 2 }).filter((s) => s.done).map((s) => s.key)).toEqual(["gmail", "offer"]);
    expect(setupComplete(buildChecklist({ gmailConnected: true, offers: 1, footerSet: true, campaigns: 1, leads: 5, realRuns: 1 }))).toBe(true);
    expect(setupComplete(buildChecklist({ gmailConnected: true, offers: 1, footerSet: true, campaigns: 1, leads: 5, realRuns: 0 }))).toBe(false);
  });
});

describe("Retry sends a lead back to the step that failed", () => {
  const both = { hasEmail: true, hasDraft: false };
  it("writing and Gmail steps resume at writing or saving, earlier work is kept", () => {
    expect(retryPatch({ status: "approved", next_action: "draft", reason_codes: ["step-failed", "write: x"] }, both)).toMatchObject({ status: "approved", next_action: "draft" });
    expect(retryPatch({ status: "approved", next_action: "deliver", reason_codes: ["step-failed", "write: x"] }, { ...both, hasDraft: true })).toMatchObject({ status: "approved", next_action: "deliver" });
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["draft-failed", "W2"] }, both)).toMatchObject({ status: "approved", next_action: "draft" });
    expect(retryPatch({ status: "approved", next_action: "deliver", reason_codes: ["gmail-failed", "x"] }, { ...both, hasDraft: true })).toMatchObject({ next_action: "deliver" });
  });
  it("email problems resume at the email step, research problems at research", () => {
    expect(retryPatch({ status: "approved", next_action: "reveal", reason_codes: ["step-failed", "reveal: x"] }, both)).toMatchObject({ status: "approved", next_action: "reveal" });
    expect(retryPatch({ status: "researching", next_action: null, reason_codes: ["step-failed", "research: x"] }, both)).toMatchObject({ status: "researching" });
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["extraction-suspect", "x"] }, both)).toMatchObject({ status: "researching" });
  });
  it("things a person must fix first are not retried automatically", () => {
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["credit-uncertain", "x"] }, both)).toBeNull();
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["no-email", "x"] }, { hasEmail: false, hasDraft: false })).toBeNull();
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["no-email", "x"] }, { hasEmail: true, hasDraft: false })).toMatchObject({ status: "imported" });
    expect(retryPatch({ status: "disqualified", next_action: null, reason_codes: ["suppressed"] }, both)).toBeNull();
  });
});
