import { expect, test } from "@playwright/test";

test("health endpoint is green in mock mode", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.mode).toBe("mock");
});

test("home page shows the health badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Outreach Engine" })).toBeVisible();
  await expect(page.getByTestId("health-badge")).toHaveText(/healthy/i);
});
