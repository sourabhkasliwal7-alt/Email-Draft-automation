import { describe, expect, it } from "vitest";
import { EnvError } from "@outreach/adapters";
import { loadWebEnv } from "../src/lib/env";
import { buildHealth } from "../src/lib/health";

const now = new Date("2026-10-26T10:00:00Z");

describe("buildHealth", () => {
  it("mock mode without a database is healthy (zero-key setup)", () => {
    const r = buildHealth({ mode: "mock", now, staleAfterSeconds: 90, database: { configured: false } });
    expect(r.status).toBe("ok");
    expect(r.checks.database.state).toBe("skipped");
  });

  it("live mode without a database is degraded", () => {
    const r = buildHealth({ mode: "live", now, staleAfterSeconds: 90, database: { configured: false } });
    expect(r.status).toBe("degraded");
    expect(r.checks.database.state).toBe("error");
  });

  it("fresh heartbeat is green, stale heartbeat is not", () => {
    const fresh = buildHealth({ mode: "live", now, staleAfterSeconds: 90, database: { configured: true, heartbeat: { lastSeenAt: new Date("2026-10-26T09:59:30Z") } } });
    expect(fresh.status).toBe("ok");
    expect(fresh.checks.worker).toMatchObject({ state: "ok", ageSeconds: 30 });
    const stale = buildHealth({ mode: "live", now, staleAfterSeconds: 90, database: { configured: true, heartbeat: { lastSeenAt: new Date("2026-10-26T09:50:00Z") } } });
    expect(stale.status).toBe("degraded");
    expect(stale.checks.worker.state).toBe("stale");
  });

  it("a database error is reported, not thrown", () => {
    const r = buildHealth({ mode: "mock", now, staleAfterSeconds: 90, database: { configured: true, error: "boom" } });
    expect(r.status).toBe("degraded");
    expect(r.checks.database).toEqual({ state: "error", detail: "boom" });
  });

  it("no heartbeat yet is fine in mock mode and stale in live mode", () => {
    expect(buildHealth({ mode: "mock", now, staleAfterSeconds: 90, database: { configured: true, heartbeat: null } }).status).toBe("ok");
    expect(buildHealth({ mode: "live", now, staleAfterSeconds: 90, database: { configured: true, heartbeat: null } }).status).toBe("degraded");
  });
});

describe("loadWebEnv", () => {
  it("works with zero keys", () => {
    expect(loadWebEnv({}).APP_MODE).toBe("mock");
  });
  it("live mode names every missing variable", () => {
    try {
      loadWebEnv({ APP_MODE: "live" });
      throw new Error("expected EnvError");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
        expect((e as EnvError).message).toContain(v);
      }
    }
  });
});
