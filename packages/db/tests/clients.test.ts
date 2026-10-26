import { describe, expect, it } from "vitest";
import { projectUrl } from "../src/clients";

describe("projectUrl", () => {
  it("reduces a pasted REST url to the project origin", () => {
    expect(projectUrl("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(projectUrl(" https://abc.supabase.co ")).toBe("https://abc.supabase.co");
  });
  it("rejects garbage", () => {
    expect(() => projectUrl("not a url")).toThrow();
  });
});
