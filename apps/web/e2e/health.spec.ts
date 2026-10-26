import { expect, test } from "@playwright/test";

test("health endpoint is green in mock mode with zero keys", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.mode).toBe("mock");
});

test("without a database the app still opens (sign-in explains why it is unavailable)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "AI Outreach Engine" })).toBeVisible();
  await expect(page.locator("p[role=alert]")).toContainText("Supabase is not configured");
  await expect(page.getByTestId("health-badge")).toHaveText(/healthy/i);
});
