import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createServiceClient } from "@outreach/db";
import { expect, type BrowserContext, type Page } from "@playwright/test";

config({ path: path.resolve(__dirname, "../../../.env") });

export const ROLES = ["admin", "operator", "reviewer", "sender"] as const;
export type E2ERole = (typeof ROLES)[number] | "disabled";

export function e2eEmail(role: E2ERole) {
  return `e2e-${role}@example.com`;
}

export function hasDb() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

/** Service-role client used ONLY by the test harness to create users and clean up. */
export function adminClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export function password() {
  const p = process.env.E2E_PASSWORD;
  if (!p) throw new Error("E2E_PASSWORD missing: global setup did not run");
  return p;
}

export async function login(page: Page, role: E2ERole) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).first().fill(e2eEmail(role));
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
}

export const AUTH_DIR = path.resolve(__dirname, ".auth");
export const authFile = (role: E2ERole) => path.join(AUTH_DIR, `${role}.json`);

/**
 * Signs in as a role. Global setup signs in through the real login form once per role and saves the session, so the
 * suite does not trip the auth provider's sign-in rate limit. Tests that exercise the login form itself call login().
 * The "disabled" test user is an operator until the test disables it.
 */
export async function loginAs(page: Page, role: E2ERole) {
  if (fs.existsSync(authFile(role))) {
    const state = JSON.parse(fs.readFileSync(authFile(role), "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
    await page.context().addCookies(state.cookies);
    await page.goto("/");
  } else {
    await login(page, role);
  }
  await expect(page.getByTestId("user-role")).toHaveText(role === "disabled" ? "operator" : role);
}

/** Unique per run so repeated runs never collide with leftovers. */
export const RUN = `e2e-${Date.now().toString(36)}`;
