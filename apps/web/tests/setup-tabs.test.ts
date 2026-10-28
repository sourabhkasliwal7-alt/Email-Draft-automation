import { describe, expect, it } from "vitest";
import { hasDemoData, isDemoCampaign, isDemoCaseStudy, isDemoInbox, isDemoOffer } from "../src/lib/demo-data";
import { SETUP_TABS, gmailBanner, parseSetupTab, setupTabHref, setupTabMarks } from "../src/lib/setup-tabs";
import { describeEstimate } from "../src/lib/run-estimate";

describe("Setup tabs", () => {
  it("has the eight tabs in order and defaults to Gmail", () => {
    expect(SETUP_TABS.map((t) => t.key)).toEqual(["gmail", "apollo", "campaigns", "offers", "footer", "style", "schedule", "advanced"]);
    expect(parseSetupTab(undefined)).toBe("gmail");
    expect(parseSetupTab("nonsense")).toBe("gmail");
    expect(parseSetupTab("offers")).toBe("offers");
    expect(parseSetupTab("style")).toBe("style");
    expect(setupTabHref("style")).toBe("/setup?tab=style");
    expect(parseSetupTab(["footer", "x"])).toBe("footer");
    expect(setupTabHref("apollo")).toBe("/setup?tab=apollo");
  });

  it("marks a tab done (tick) or todo (dot); Advanced never shows a mark and Schedule is quiet while off", () => {
    const none = setupTabMarks({ gmailReady: false, apolloLive: false, campaigns: 0, offers: 0, footerSet: false, scheduleOn: false });
    expect(none).toEqual({ gmail: "todo", apollo: "todo", campaigns: "todo", offers: "todo", footer: "todo", style: "none", schedule: "none", advanced: "none" });
    const all = setupTabMarks({ gmailReady: true, apolloLive: true, campaigns: 1, offers: 2, footerSet: true, scheduleOn: true });
    expect(all).toEqual({ gmail: "done", apollo: "done", campaigns: "done", offers: "done", footer: "done", style: "none", schedule: "done", advanced: "none" });
  });
});

describe("Gmail banner", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const day = 86_400_000;
  const box = (over: Partial<Parameters<typeof gmailBanner>[0][number]> = {}) => ({ email: "a@x.com", status: "active", hasLabelPermission: true, expiresAt: null, ...over });
  it("is empty when nothing needs doing", () => {
    expect(gmailBanner([], now)).toBeNull();
    expect(gmailBanner([box({ expiresAt: new Date(now.getTime() + 5 * day) })], now)).toBeNull();
  });
  it("asks to reconnect a mailbox that needs it or lacks the label permission", () => {
    expect(gmailBanner([box({ status: "needs_reconnect" })], now)).toContain("a@x.com");
    expect(gmailBanner([box({ hasLabelPermission: false })], now)).toContain("reconnected");
  });
  it("warns when a sign-in expires within 2 days", () => {
    expect(gmailBanner([box({ expiresAt: new Date(now.getTime() + 1 * day) })], now)).toContain("within 2 days");
  });
});

describe("Demo data", () => {
  it("recognises only the seeded demo records", () => {
    expect(isDemoOffer({ id: "00000000-0000-4000-8000-0000000000a1" })).toBe(true);
    expect(isDemoOffer({ id: "11111111-0000-4000-8000-0000000000a1" })).toBe(false);
    expect(isDemoCaseStudy({ id: "00000000-0000-4000-8000-0000000000b2" })).toBe(true);
    expect(isDemoInbox({ id: "x", email: "Demo-Sender@example.com" })).toBe(true);
    expect(isDemoInbox({ id: "x", email: "me@gmail.com" })).toBe(false);
    expect(isDemoCampaign({ id: "x", name: "Demo campaign" })).toBe(true);
    expect(isDemoCampaign({ id: "x", name: "Q4 campaign" })).toBe(false);
    expect(hasDemoData({ offers: [{ id: "real" }], inboxes: [{ id: "i", email: "me@gmail.com" }] })).toBe(false);
    expect(hasDemoData({ offers: [{ id: "00000000-0000-4000-8000-0000000000a2" }] })).toBe(true);
  });
});

describe("Run estimate text", () => {
  const est = { drafts: 20, credits: 20, usdPerDraft: 0.05, hasMailbox: true, apolloPeople: 20 };
  it("says a practice run uses nothing", () => {
    expect(describeEstimate(est, true)).toMatch(/no email credits/);
  });
  it("lists drafts, credits and cost for a real run", () => {
    const t = describeEstimate(est, false);
    expect(t).toContain("up to 20 Gmail drafts");
    expect(t).toContain("20 email credits");
    expect(t).toContain("$1.00");
  });
  it("says the cost is unknown before a first run and CSV leads need no credits", () => {
    expect(describeEstimate({ ...est, credits: 0, usdPerDraft: null }, false)).toMatch(/no email credits.*first run/);
  });
});
