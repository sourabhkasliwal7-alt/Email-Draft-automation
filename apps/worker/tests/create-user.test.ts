import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/create-user";

describe("create-user CLI arguments", () => {
  it("parses a create request and normalises the email", () => {
    expect(parseArgs(["--email", " Boss@Company.com ", "--role", "admin", "--name", "The Boss"])).toEqual({
      email: "boss@company.com",
      role: "admin",
      name: "The Boss",
      password: null,
      action: "create",
    });
  });
  it("falls back to ADMIN_* env values and lets flags override them", () => {
    const env = { ADMIN_EMAIL: "Env@Co.com", ADMIN_PASSWORD: "longenough1", ADMIN_ROLE: "sender", ADMIN_NAME: "Env Name" };
    expect(parseArgs([], env)).toEqual({ email: "env@co.com", role: "sender", name: "Env Name", password: "longenough1", action: "create" });
    expect(parseArgs(["--email", "x@y.co", "--role", "admin"], env)).toMatchObject({ email: "x@y.co", role: "admin" });
    expect(() => parseArgs([], { ...env, ADMIN_PASSWORD: "short" })).toThrow(/at least 8/);
  });
  it("parses disable and enable", () => {
    expect(parseArgs(["--email", "a@b.co", "--disable"]).action).toBe("disable");
    expect(parseArgs(["--email", "a@b.co", "--enable"]).action).toBe("enable");
  });
  it("rejects a missing/invalid email or an unknown role, showing usage", () => {
    expect(() => parseArgs(["--role", "admin"])).toThrow(/--email must be a valid address/);
    expect(() => parseArgs(["--email", "nope", "--role", "admin"])).toThrow(/valid address/);
    expect(() => parseArgs(["--email", "a@b.co", "--role", "superuser"])).toThrow(/--role must be one of admin, operator, reviewer, sender/);
    expect(() => parseArgs(["--email", "a@b.co"])).toThrow(/Usage/);
  });
});
