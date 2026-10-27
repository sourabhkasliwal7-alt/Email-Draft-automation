import { describe, expect, it } from "vitest";
import { GMAIL_MESSAGES, googleConfig, testingExpiry } from "../src/lib/google";

const KEY = Buffer.alloc(32, 1).toString("base64");
const full = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TOKEN_ENCRYPTION_KEY: KEY, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" };

describe("googleConfig", () => {
  it("builds the redirect URI from NEXT_PUBLIC_SITE_URL + /api/google/callback", () => {
    const c = googleConfig(full);
    expect(c.ok && c.redirectUri).toBe("http://localhost:3000/api/google/callback");
    expect(googleConfig({ ...full, NEXT_PUBLIC_SITE_URL: "https://outreach.example.com/" }).ok && (googleConfig({ ...full, NEXT_PUBLIC_SITE_URL: "https://outreach.example.com/" }) as { redirectUri: string }).redirectUri).toBe("https://outreach.example.com/api/google/callback");
  });
  it("names everything that is missing, and still shows the URI to register when it can", () => {
    const c = googleConfig({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", GOOGLE_CLIENT_ID: "  " });
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.missing).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"]);
      expect(c.redirectUri).toBe("http://localhost:3000/api/google/callback");
    }
    const noSite = googleConfig({ ...full, NEXT_PUBLIC_SITE_URL: undefined });
    expect(!noSite.ok && noSite.missing).toEqual(["NEXT_PUBLIC_SITE_URL"]);
    const badSite = googleConfig({ ...full, NEXT_PUBLIC_SITE_URL: "not a url" });
    expect(!badSite.ok && badSite.missing[0]).toMatch(/NEXT_PUBLIC_SITE_URL/);
  });
  it("assumes Testing mode unless told it is in production", () => {
    expect(googleConfig(full).ok && (googleConfig(full) as { publishing: string }).publishing).toBe("testing");
    expect((googleConfig({ ...full, GOOGLE_APP_PUBLISHING: "Production" }) as { publishing: string }).publishing).toBe("production");
    expect((googleConfig({ ...full, GOOGLE_APP_PUBLISHING: "whatever" }) as { publishing: string }).publishing).toBe("testing");
  });
});

describe("Testing-mode expiry", () => {
  it("is exactly 7 days after connecting", () => {
    expect(testingExpiry("2026-10-27T10:00:00.000Z")?.toISOString()).toBe("2026-11-03T10:00:00.000Z");
    expect(testingExpiry(null)).toBeNull();
  });
});

describe("messages shown after the Google round trip", () => {
  it("every code the routes can return has a readable message", () => {
    for (const code of ["connected", "not_configured", "state", "session", "denied", "google_error", "no_code", "token", "no_refresh_token", "scopes", "wrong_account", "profile", "no_inbox", "forbidden", "disconnected"]) {
      expect(GMAIL_MESSAGES[code]?.text.length, code).toBeGreaterThan(10);
    }
  });
});
