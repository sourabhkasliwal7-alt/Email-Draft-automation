import { expect, test } from "@playwright/test";
import { hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

/** The whole menu: four items. Setup is only for people who set things up. */
const NAV = {
  admin: ["Home", "Leads", "Drafts", "Setup"],
  operator: ["Home", "Leads", "Drafts", "Setup"],
  reviewer: ["Home", "Leads", "Drafts"],
  sender: ["Home", "Leads", "Drafts"],
} as const;

for (const role of ["admin", "operator", "reviewer", "sender"] as const) {
  test(`${role}: navigation shows exactly the pages this role may use`, async ({ page }) => {
    await loginAs(page, role);
    const links = await page.getByRole("navigation", { name: "Main" }).getByRole("link").allInnerTexts();
    expect(links).toEqual([...NAV[role]]);
  });
}

const FORBIDDEN: Record<string, string[]> = {
  // old addresses lead to Setup, which these roles may not open
  reviewer: ["/setup", "/campaigns/new", "/offers/new", "/settings", "/inboxes", "/offers", "/campaigns", "/suppression", "/runs/00000000-0000-4000-8000-000000000000"],
  sender: ["/setup", "/campaigns/new", "/offers/new", "/settings", "/inboxes", "/offers", "/campaigns", "/suppression", "/runs/00000000-0000-4000-8000-000000000000"],
};

for (const [role, paths] of Object.entries(FORBIDDEN)) {
  test(`${role}: direct URLs outside the role land on the Not allowed page`, async ({ page }) => {
    await loginAs(page, role as "reviewer");
    for (const p of paths) {
      await page.goto(p);
      await expect(page, `${role} ${p}`).toHaveURL(/\/forbidden(#.*)?$/);
      await expect(page.getByTestId("forbidden")).toContainText(`Your role (${role})`);
    }
  });
}

test("the old addresses lead to their new place", async ({ page }) => {
  await loginAs(page, "admin");
  const WHERE: [string, RegExp][] = [
    ["/runs", /\/$/],
    ["/attention", /\/drafts\?tab=attention$/],
    ["/inboxes", /\/setup\?tab=gmail$/],
    ["/settings", /\/setup\?tab=advanced$/],
    ["/offers", /\/setup\?tab=offers$/],
    ["/campaigns", /\/setup\?tab=campaigns$/],
    ["/suppression", /\/setup\?tab=advanced$/],
    ["/import", /\/leads$/],
  ];
  for (const [from, to] of WHERE) {
    await page.goto(from);
    await expect(page, from).toHaveURL(to);
  }
  // the half-built screens are gone, not hidden
  for (const gone of ["/review", "/sending", "/follow-ups", "/jobs", "/usage"]) {
    const res = await page.goto(gone);
    expect(res?.status(), gone).toBe(404);
  }
});

test("reviewer and sender can look at leads and drafts, but not add leads or change anything", async ({ page }) => {
  for (const role of ["reviewer", "sender"] as const) {
    await loginAs(page, role);
    await page.goto("/leads");
    await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
    await expect(page.getByTestId("card-csv")).toHaveCount(0);
    await expect(page.getByTestId("card-apollo")).toHaveCount(0);
    await page.goto("/drafts");
    await expect(page.getByTestId("tab-drafts")).toBeVisible();
    // only people who may act on a lead see the Needs attention tab; a sender does not
    await expect(page.getByTestId("tab-attention")).toHaveCount(role === "reviewer" ? 1 : 0);
    await page.goto("/");
    await expect(page.getByTestId("start-run-form")).toHaveCount(0);
    await expect(page.getByTestId("checklist")).toHaveCount(0);
    await page.context().clearCookies(); // not "Sign out": that would revoke the shared saved session
  }
});

test("operator sees Home with a Start run form (no send controls); admin gets clear validation in Setup", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByTestId("status-card")).toBeVisible();
  await expect(page.getByText(/send/i).filter({ hasText: /approve|send now/i })).toHaveCount(0);
  await page.goto("/drafts?tab=attention");
  await expect(page.getByTestId("tab-attention")).toBeVisible();
  // an operator opens Setup, but the technical settings are the admin's
  await page.goto("/setup?tab=campaigns");
  await expect(page.getByTestId("section-campaign")).toBeVisible();
  await page.goto("/setup?tab=schedule");
  await expect(page.getByTestId("form-schedule")).toHaveCount(0);
  await page.goto("/setup?tab=footer");
  await expect(page.getByTestId("form-footer")).toHaveCount(0);
  await page.context().clearCookies();

  await loginAs(page, "admin");
  await page.goto("/setup?tab=schedule");
  const form = page.getByTestId("form-schedule");
  await expect(form).toBeVisible();
  await form.getByLabel("Start time (India time, 24-hour)").fill("25:99");
  await form.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("error-run_time_ist")).toContainText("HH:MM");
  await expect(page.getByLabel(/SENDING_ENABLED/)).toHaveCount(0); // there is no sending switch anywhere
});
