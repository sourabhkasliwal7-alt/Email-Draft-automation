import { describe, expect, it, vi } from "vitest";
import { EnvError } from "@outreach/adapters";
import { loadWorkerEnv } from "../src/env";
import { startWorker } from "../src/worker";

describe("loadWorkerEnv", () => {
  it("mock mode needs zero external keys", () => {
    const e = loadWorkerEnv({}, "host-1");
    expect(e.APP_MODE).toBe("mock");
    expect(e.workerId).toBe("host-1");
    expect(e.HEARTBEAT_INTERVAL_SECONDS).toBe(30);
  });

  it("live mode names every missing variable in one error", () => {
    try {
      loadWorkerEnv({ APP_MODE: "live", ADAPTER_LLM: "live" });
      throw new Error("expected EnvError");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const msg = (err as EnvError).message;
      expect(msg).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(msg).toContain("SUPABASE_SECRET_KEY");
      expect(msg).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("rejects malformed values", () => {
    expect(() => loadWorkerEnv({ HEARTBEAT_INTERVAL_SECONDS: "0" })).toThrow(EnvError);
    expect(() => loadWorkerEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toThrow(EnvError);
  });
});

describe("startWorker", () => {
  it("beats immediately and on every interval, and stops cleanly", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const w = startWorker({ workerId: "w", intervalMs: 1000, heartbeat, log: () => {} });
    await w.first;
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    w.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("survives a failing heartbeat", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const heartbeat = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const w = startWorker({ workerId: "w", intervalMs: 1000, heartbeat, log });
    await w.first;
    expect(log).toHaveBeenCalledWith("heartbeat error: db down");
    await vi.advanceTimersByTimeAsync(1100);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    w.stop();
    vi.useRealTimers();
  });
});
