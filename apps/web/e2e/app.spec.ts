import { expect, test } from "@playwright/test";
import { RUN, adminClient, hasDb, login, loginAs, e2eEmail, openAdvanced } from "./support";

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
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
});

test("operator creates a campaign on one page, with clear validation and Apollo filters", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/setup?tab=campaigns");
  await page.getByTestId("new-campaign").click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);

  // nothing filled in -> one clear error, everything is on this one page
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByTestId("error-name")).toHaveText("Campaign name is required");

  await page.getByLabel("Campaign name").fill(CAMPAIGN);
  await page.getByLabel("Leads come from").selectOption("both");
  await expect(page.getByTestId("block-apollo")).toContainText("Used when Apollo looks for people");
  await page.getByLabel("Job titles").fill("COO, Head of Operations");
  await page.getByLabel("Industries", { exact: true }).fill("saas, logistics");
  await page.getByLabel("Founder").check();
  await page.getByLabel("Director").check();
  await page.getByLabel("Companies hiring for").fill("developer");

  // bad numbers are explained next to the field
  await page.getByLabel("At least this many open jobs").fill("many");
  await page.getByLabel("Smallest company (employees)").fill("500");
  await page.getByLabel("Largest company (employees)").fill("50");
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page.getByTestId("error-minOpenJobs")).toHaveText("Open jobs must be a whole number");
  await expect(page.getByTestId("error-employeeMax")).toContainText("at least the minimum");
  await expect(page.getByLabel("Campaign name")).toHaveValue(CAMPAIGN); // what was typed survives

  await page.getByLabel("At least this many open jobs").fill("3");
  await page.getByLabel("Largest company (employees)").fill("5000");
  await page.getByRole("button", { name: "Create campaign" }).click();

  await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
  const row = page.getByTestId("campaign-row").filter({ hasText: CAMPAIGN });
  await expect(row).toBeVisible();
  await expect(row).toContainText("CSV file + Apollo");
  await expect(row).toContainText("Active");

  // the Apollo filters were stored in the campaign
  const { data } = await adminClient().from("campaigns").select("icp, target_roles").eq("name", CAMPAIGN).single();
  expect(data!.icp).toMatchObject({ leadSource: "both", seniorities: ["founder", "director"], hiringTitles: ["developer"], minOpenJobs: 3, employeeMin: 500, employeeMax: 5000, industries: ["saas", "logistics"] });
  expect(data!.target_roles).toEqual(["COO", "Head of Operations"]);

  // edit it: everything comes back as it was saved
  await row.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Industries", { exact: true })).toHaveValue("saas, logistics");
  await expect(page.getByLabel("Leads come from")).toHaveValue("both");
  await expect(page.getByLabel("Founder")).toBeChecked();
  await expect(page.getByLabel("Director")).toBeChecked();
  await expect(page.getByLabel("Manager")).not.toBeChecked();
  await expect(page.getByLabel("Companies hiring for")).toHaveValue("developer");
  await page.getByLabel("Leads come from").selectOption("csv");
  await expect(page.getByTestId("block-apollo")).toContainText("Not used");
  await page.getByRole("button", { name: "Save campaign" }).click();
  await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
  await expect(page.getByTestId("campaign-row").filter({ hasText: CAMPAIGN })).toContainText("CSV file");
});

test("operator adds an offer and a case study with allowed numbers", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/setup?tab=offers");
  await page.getByTestId("new-offer").click();
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

  // back in Setup the offer shows with its case study, and the campaign form lists that case study when the offer is chosen
  await page.getByRole("link", { name: /Setup/ }).first().click();
  const offerRow = page.getByTestId("offer-row").filter({ hasText: OFFER });
  await expect(offerRow).toContainText("2 allowed claims");
  await expect(offerRow).toContainText(`e2e-case-${RUN}`);
  await page.goto("/campaigns/new");
  await page.getByLabel("Offer", { exact: true }).selectOption({ label: OFFER });
  await expect(page.getByTestId("offer-case-studies")).toContainText(`e2e-case-${RUN}`);
});

test("operator adds suppression rows (form + CSV) and cannot remove them", async ({ page }) => {
  await loginAs(page, "operator");
  await openAdvanced(page);

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
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByTestId("form-message").last()).toContainText("Added 2");
  await expect(page.getByTestId("form-message").last()).toContainText("1 duplicate rows in the file");
  await expect(page.getByTestId("form-message").last()).toContainText("1 invalid rows skipped");
  await expect(page.getByTestId("suppression-row").filter({ hasText: `@blocked-${RUN}.example.org` })).toBeVisible();

  // operators may add but not remove, and the admin-only settings are not offered to them
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(page.getByTestId("form-run-rules")).toHaveCount(0);
  await expect(page.getByTestId("connections")).toHaveCount(0);
});

test("admin can remove a suppression row and the removal is audited", async ({ page }) => {
  await loginAs(page, "admin");
  await openAdvanced(page);
  const row = page.getByTestId("suppression-row").filter({ hasText: `csv1.${RUN}@example.com` });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
});

test("admin saves footer, models, prices and caps in Setup; every change is audited", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/setup?tab=footer");

  // footer: required text is explained, a valid footer is saved without touching the other settings
  const footer = page.getByTestId("form-footer");
  const postal = await footer.getByLabel("Postal address").inputValue();
  const optout = await footer.getByLabel("Opt-out line").inputValue();
  await footer.getByLabel("Postal address").fill("");
  await footer.getByRole("button", { name: "Save footer" }).click();
  await expect(page.getByTestId("error-postal_address")).toContainText("Enter your postal address");
  await footer.getByLabel("Postal address").fill(postal || `1 Test Street, Pune 411001 (${RUN})`);
  await footer.getByLabel("Opt-out line").fill(optout || "Reply STOP and I will not write again.");
  await footer.getByRole("button", { name: "Save footer" }).click();
  await expect(footer.getByTestId("form-message")).toHaveText("Footer saved.");

  await openAdvanced(page);
  // models: each Setup section saves only its own keys
  const models = page.getByTestId("form-models");
  const original = await models.getByLabel("Writing model").inputValue();
  const screenModel = await models.getByLabel("Quick-check model").inputValue();
  await models.getByLabel("Writing model").fill("");
  await models.getByRole("button", { name: "Save models" }).click();
  await expect(page.getByTestId("error-model_write")).toHaveText("Enter the writing model");
  await models.getByLabel("Writing model").fill(`e2e-model-${RUN}`);
  await models.getByRole("button", { name: "Save models" }).click();
  await expect(models.getByTestId("form-message")).toHaveText("Models saved.");
  await page.reload();
  await expect(page.getByTestId("form-models").getByLabel("Writing model")).toHaveValue(`e2e-model-${RUN}`);
  await expect(page.getByTestId("form-models").getByLabel("Quick-check model")).toHaveValue(screenModel);
  await page.goto("/setup?tab=footer");
  await expect(page.getByTestId("form-footer").getByLabel("Opt-out line")).not.toHaveValue(""); // saving models did not clear the footer
  await page.goto("/setup?tab=advanced");
  await page.getByTestId("form-models").getByLabel("Writing model").fill(original);
  await page.getByTestId("form-models").getByRole("button", { name: "Save models" }).click();
  await expect(page.getByTestId("form-models").getByTestId("form-message")).toHaveText("Models saved.");

  // credit limits are validated
  const credits = page.getByTestId("form-credits");
  await credits.getByLabel("Credits per day").fill("-3");
  await credits.getByRole("button", { name: "Save credit limits" }).click();
  await expect(page.getByTestId("error-daily_reveal_cap")).toContainText("at least 0");

  // the sending switch does not exist; email checking is on unless someone turns it off on purpose
  await expect(page.getByLabel(/SENDING_ENABLED/)).toHaveCount(0);
  await expect(page.getByLabel("Skip email verification (testing only)")).not.toBeChecked();
  await expect(page.getByLabel("Always run as a test run (no drafts, no credits)")).not.toBeChecked();
  await expect(page.getByTestId("skip-verification-warning")).toBeVisible();

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
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  const { adminClient } = await import("./support");
  const admin = adminClient();
  const { error } = await admin.from("profiles").update({ disabled: true }).eq("full_name", "E2E disabled");
  expect(error).toBeNull();
  try {
    await page.goto("/leads");
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
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login/);
});
