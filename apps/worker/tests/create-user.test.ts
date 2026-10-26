import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/create-user";

describe("create-user CLI arguments", () => {
  it("parses a create request and normalises the email", () => {
    expect(parseArgs(["--email", " Boss@Company.com ", "--role", "admin", "--name", "The Boss"])).toEqual({
      email: "boss@company.com",
      role: "admin",
      name: "The Boss",
      action: "create",
    });
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
