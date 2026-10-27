import { expect, test } from "@playwright/test";
import { RUN, hasDb, login, loginAs, e2eEmail } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

const CAMPAIGN = `e2e-campaign-${RUN}`;
const OFFER = `e2e-offer-${RUN}`;

test("anonymous visitors are sent to the login page", async ({ page }) => {
  await page.goto("/campaigns");
  await expect(page).toHaveURL(/\/login\?next=%2Fcampaigns$/);
});

test("wrong password shows one generic error, correct password signs in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).first().fill(e2eEmail("operator"));
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("form-message").first()).toHaveText("Invalid email or password.");

  // what the user typed survives a failed submit (React 19 would otherwise reset the form)
  await expect(page.getByLabel("Email", { exact: true }).first()).toHaveValue(e2eEmail("operator"));
  await page.getByLabel("Password").fill("");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("error-password")).toHaveText("Password is required");
  await loginAs(page, "operator");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("operator creates a campaign through the wizard, with clear validation", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/campaigns/new");

  // submit with nothing filled in -> error on step 1, wizard jumps back to it
  await page.getByRole("button", { name: "4. Sending" }).click();
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByTestId("error-name")).toHaveText("Campaign name is required");
  await expect(page.getByLabel("Campaign name")).toBeVisible();

  await page.getByLabel("Campaign name").fill(CAMPAIGN);
  await page.getByLabel("Target industries").fill("saas, logistics");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Target roles").fill("COO, Head of Operations");
  await page.getByLabel("Draft threshold (0-100)").fill("40");
  await page.getByLabel("Review threshold (0-100)").fill("60");
  await page.getByRole("button", { name: "4. Sending" }).click();
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByTestId("error-scoreReviewMin")).toContainText("cannot be higher than the draft threshold");

  await page.getByLabel("Draft threshold (0-100)").fill("70");
  await page.getByLabel("Review threshold (0-100)").fill("50");
  await page.getByRole("button", { name: "4. Sending" }).click();
  await page.getByRole("button", { name: "Create campaign" }).click();

  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByTestId("campaign-row").filter({ hasText: CAMPAIGN })).toBeVisible();

  // edit it
  await page.getByTestId("campaign-row").filter({ hasText: CAMPAIGN }).getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Target industries")).toHaveValue("saas, logistics");
});

test("operator adds an offer and a case study with allowed numbers", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/offers/new");
  await page.getByRole("button", { name: "Create offer" }).click();
  await expect(page.getByTestId("error-name")).toHaveText("Offer name is required");

  await page.getByLabel("Offer name").fill(OFFER);
  await page.getByLabel("Allowed claims").fill("Fixed-scope, two-week audit\nWritten roadmap");
  await page.getByRole("button", { name: "Create offer" }).click();
  await expect(page.getByRole("heading", { name: OFFER })).toBeVisible();

  await page.getByLabel("Case study title").fill(`e2e-case-${RUN}`);
  await page.getByLabel("Allowed numbers").fill("not a number line");
  await page.getByRole("button", { name: "Add case study" }).click();
  await expect(page.getByTestId("error-allowedNumbers")).toContainText('use "name = number"');
  await page.getByLabel("Allowed numbers").fill("hours saved = 12");
  await page.getByRole("button", { name: "Add case study" }).click();
  await expect(page.getByTestId("case-study-row").filter({ hasText: `e2e-case-${RUN}` })).toContainText("hours saved: 12");

  await page.goto("/offers");
  await expect(page.getByTestId("offer-row").filter({ hasText: OFFER })).toContainText("2 allowed claims");
});

test("operator adds suppression rows (form + CSV) and cannot remove them", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/suppression");

  await page.getByLabel("Value", { exact: true }).fill("not-an-email");
  await page.getByLabel("Reason", { exact: true }).fill(`e2e-${RUN}`);
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByTestId("error-value")).toHaveText("Enter a valid email address");

  await page.getByLabel("Value", { exact: true }).fill(`Opt.Out.${RUN}@Example.com`);
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByTestId("form-message").first()).toHaveText("Added to the suppression list.");
  await expect(page.getByTestId("suppression-row").filter({ hasText: `opt.out.${RUN}@example.com` })).toBeVisible();

  // same entry again -> clear duplicate message
  await page.getByLabel("Value", { exact: true }).fill(`opt.out.${RUN}@example.com`);
  await page.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByTestId("form-message").first()).toHaveText("That entry is already on the list.");

  // CSV: valid, duplicate-in-file and invalid rows
  const csv = `email,reason\ncsv1.${RUN}@example.com,e2e-csv\nCSV1.${RUN}@example.com,e2e-csv\nbroken row,e2e-csv\nblocked-${RUN}.example.org,e2e-csv\n`;
  await page.locator('input[name="file"]').setInputFiles({ name: "list.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("form-message").last()).toContainText("Added 2");
  await expect(page.getByTestId("form-message").last()).toContainText("1 duplicate rows in the file");
  await expect(page.getByTestId("form-message").last()).toContainText("1 invalid rows skipped");
  await expect(page.getByTestId("suppression-row").filter({ hasText: `@blocked-${RUN}.example.org` })).toBeVisible();

  // operators may add but not remove
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("admin can remove a suppression row and the removal is audited", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/suppression");
  const row = page.getByTestId("suppression-row").filter({ hasText: `csv1.${RUN}@example.com` });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
});

test("admin saves settings, prices and caps; every change is audited", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/settings");

  const drafting = page.getByLabel("Drafting model");
  const original = await drafting.inputValue();
  await drafting.fill("");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("error-modelDrafting")).toHaveText("Drafting model is required");

  await drafting.fill(`e2e-model-${RUN}`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("form-message").first()).toHaveText("Settings saved.");
  // the sending switch is hidden in the app (nothing can be sent): saving settings must not offer or change it
  await expect(page.getByLabel(/SENDING_ENABLED/)).toHaveCount(0);

  await drafting.fill(original);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("form-message").first()).toHaveText("Settings saved.");

  await page.getByLabel("USD per unit").fill("-1");
  await page.getByLabel("Provider", { exact: true }).first().fill("e2e");
  await page.getByLabel("Unit", { exact: true }).fill("unit");
  await page.getByRole("button", { name: "Add price" }).click();
  await expect(page.getByTestId("error-usdPerUnit")).toHaveText("Price cannot be negative");

  await page.reload();
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await expect(page.getByTestId("audit-row").filter({ hasText: "settings" }).first()).toBeVisible();
});

test("a disabled user loses access on the very next request", async ({ page }) => {
  await loginAs(page, "disabled");
  await page.goto("/campaigns");
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();

  const { adminClient } = await import("./support");
  const admin = adminClient();
  const { error } = await admin.from("profiles").update({ disabled: true }).eq("full_name", "E2E disabled");
  expect(error).toBeNull();
  try {
    await page.goto("/campaigns");
    await expect(page).toHaveURL(/\/no-access\?reason=disabled$/);
    await expect(page.getByRole("heading", { name: "Your account is disabled" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/no-access/);
  } finally {
    await admin.from("profiles").update({ disabled: false }).eq("full_name", "E2E disabled");
  }
});

test("sign out ends the session", async ({ page }) => {
  // a fresh sign-in (not the shared saved session, which sign-out would revoke for the other tests)
  await login(page, "operator");
  await expect(page.getByTestId("user-role")).toHaveText("operator");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/campaigns");
  await expect(page).toHaveURL(/\/login/);
});
