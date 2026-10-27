import { expect, test } from "@playwright/test";
import { hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

const NAV = {
  admin: ["Dashboard", "Runs", "Needs attention", "Campaigns", "Import", "Suppression", "Mailboxes", "Offers", "Settings"],
  operator: ["Dashboard", "Runs", "Needs attention", "Campaigns", "Import", "Suppression", "Mailboxes", "Offers"],
  reviewer: ["Dashboard", "Needs attention", "Campaigns", "Suppression", "Offers"],
  sender: ["Dashboard", "Campaigns", "Suppression", "Offers"],
} as const;

for (const role of ["admin", "operator", "reviewer", "sender"] as const) {
  test(`${role}: navigation shows exactly the pages this role may use`, async ({ page }) => {
    await loginAs(page, role);
    const links = await page.getByRole("navigation", { name: "Main" }).getByRole("link").allInnerTexts();
    expect(links).toEqual([...NAV[role]]);
  });
}

const FORBIDDEN: Record<string, string[]> = {
  operator: ["/settings"],
  reviewer: ["/settings", "/campaigns/new", "/offers/new", "/import", "/inboxes", "/sending", "/jobs", "/usage", "/runs"],
  sender: ["/settings", "/campaigns/new", "/offers/new", "/import", "/review", "/inboxes", "/jobs", "/usage", "/runs", "/attention"],
};

for (const [role, paths] of Object.entries(FORBIDDEN)) {
  test(`${role}: direct URLs outside the role land on the Not allowed page`, async ({ page }) => {
    await loginAs(page, role as "operator");
    for (const p of paths) {
      await page.goto(p);
      await expect(page, `${role} ${p}`).toHaveURL(/\/forbidden$/);
      await expect(page.getByTestId("forbidden")).toContainText(`Your role (${role})`);
    }
  });
}

test("reviewer and sender see campaigns and suppression read-only", async ({ page }) => {
  for (const role of ["reviewer", "sender"] as const) {
    await loginAs(page, role);
    await page.goto("/campaigns");
    await expect(page.getByRole("link", { name: "New campaign" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await page.goto("/suppression");
    await expect(page.getByRole("button", { name: "Add to list" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await page.context().clearCookies(); // not "Sign out": that would revoke the shared saved session
  }
});

test("operator sees the run page with a Start form (no send controls); admin sees the run settings and gets clear validation", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/runs");
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByText(/send/i).filter({ hasText: /approve|send now/i })).toHaveCount(0);
  await page.goto("/attention");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await page.context().clearCookies();

  await loginAs(page, "admin");
  await page.goto("/settings");
  const form = page.getByTestId("workflow-settings");
  await expect(form).toBeVisible();
  await form.getByLabel("Daily start time (IST)").fill("25:99");
  await form.getByRole("button", { name: "Save run settings" }).click();
  await expect(page.getByTestId("error-run_time_ist")).toContainText("HH:MM");
  await expect(page.getByLabel(/SENDING_ENABLED/)).toHaveCount(0); // the sending switch is hidden in the app
});
