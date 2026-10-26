import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, can, type Permission } from "../src";

describe("permission matrix", () => {
  it("only sender and admin can approve sending or send", () => {
    for (const p of ["send.approve", "send.execute"] as Permission[]) {
      expect(ROLES.filter((r) => can(r, p)).sort()).toEqual(["admin", "sender"]);
    }
  });

  it("a reviewer can approve a Gmail draft but never sending", () => {
    expect(can("reviewer", "draft.approve_gmail")).toBe(true);
    expect(can("reviewer", "draft.edit")).toBe(true);
    expect(can("reviewer", "send.approve")).toBe(false);
    expect(can("reviewer", "send.execute")).toBe(false);
  });

  it("operators run campaigns but cannot approve sending or change settings", () => {
    expect(can("operator", "campaign.manage")).toBe(true);
    expect(can("operator", "send.approve")).toBe(false);
    expect(can("operator", "settings.manage")).toBe(false);
  });

  it("reviewers and senders cannot change settings, inboxes, offers or campaigns", () => {
    for (const role of ["reviewer", "sender"] as const) {
      for (const p of ["settings.manage", "inbox.manage", "offer.manage", "campaign.manage", "suppression.remove"] as Permission[]) {
        expect(can(role, p)).toBe(false);
      }
    }
  });

  it("only admin manages settings, inboxes, users, the audit log and suppression removal", () => {
    for (const p of ["settings.manage", "settings.view", "inbox.manage", "user.manage", "audit.view", "suppression.remove"] as Permission[]) {
      expect(ROLES.filter((r) => can(r, p))).toEqual(["admin"]);
    }
  });

  it("no role / unknown role has any permission", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("admin has every permission", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can("admin", p)).toBe(true);
  });
});
