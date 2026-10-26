import { describe, expect, it, vi } from "vitest";
import { ROLES, can, PERMISSIONS, type Permission, type Role } from "@outreach/core";

// auth.ts imports Next/Supabase server modules; the guard under test is pure.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { evaluateGuard, type SessionState } from "../src/lib/auth";

const ok = (role: Role): SessionState => ({ state: "ok", user: { id: "u", email: "u@x.com", role, fullName: null } });

describe("evaluateGuard (every server action goes through this)", () => {
  it("lets exactly the roles in the matrix through, for every permission", () => {
    for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
      for (const role of ROLES) {
        expect(evaluateGuard(ok(role), permission).ok, `${role} ${permission}`).toBe(can(role, permission));
      }
    }
  });

  it("a reviewer cannot change settings or approve sending; a sender can approve sending but not edit campaigns", () => {
    expect(evaluateGuard(ok("reviewer"), "settings.manage").ok).toBe(false);
    expect(evaluateGuard(ok("reviewer"), "send.approve").ok).toBe(false);
    expect(evaluateGuard(ok("reviewer"), "draft.approve_gmail").ok).toBe(true);
    expect(evaluateGuard(ok("sender"), "send.approve").ok).toBe(true);
    expect(evaluateGuard(ok("sender"), "campaign.manage").ok).toBe(false);
    expect(evaluateGuard(ok("operator"), "send.approve").ok).toBe(false);
  });

  it("refuses with a readable message that names the role", () => {
    const r = evaluateGuard(ok("reviewer"), "settings.manage");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.state.message).toBe("Your role (reviewer) is not allowed to do this.");
  });

  it("anonymous, disabled, profile-less and unconfigured sessions can never act", () => {
    const sessions: SessionState[] = [
      { state: "anonymous" },
      { state: "not_configured" },
      { state: "disabled", email: "a@b.com" },
      { state: "no_profile", email: "a@b.com" },
    ];
    for (const s of sessions) {
      for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
        expect(evaluateGuard(s, permission).ok, `${s.state} ${permission}`).toBe(false);
      }
    }
  });
});
