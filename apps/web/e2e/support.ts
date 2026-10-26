import path from "node:path";
import { config } from "dotenv";
import { createServiceClient } from "@outreach/db";
import { expect, type Page } from "@playwright/test";

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

/** The "disabled" test user is an operator until the test disables it. */
export async function loginAs(page: Page, role: E2ERole) {
  await login(page, role);
  await expect(page.getByTestId("user-role")).toHaveText(role === "disabled" ? "operator" : role);
}

/** Unique per run so repeated runs never collide with leftovers. */
export const RUN = `e2e-${Date.now().toString(36)}`;
