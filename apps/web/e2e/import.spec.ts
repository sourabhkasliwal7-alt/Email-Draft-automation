import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

const E = `e2eimp${Math.random().toString(36).slice(2, 8)}`;
const CAMPAIGN = `${E} campaign`;
const RESEARCH = `${E} research-first`;
const DOMAIN = `${E}.example.com`;
const fixture = (name: string) => readFileSync(path.resolve(__dirname, "../../../tests/fixtures/imports", name));

const APOLLO_CSV = [
  "First Name,Last Name,Title,Company,Email,Email Status,Seniority,# Employees,Industry,Person Linkedin Url,Website,Country",
  `Lia,Moss ${E},COO,Iota ${E},lia@${DOMAIN},Verified,c_suite,"1,200",software,https://www.linkedin.com/in/lia-${E}/?x=1,https://www.${DOMAIN},India`,
  `Max,Dahl ${E},CTO,Kappa ${E},max@kappa-${DOMAIN},Guessed,c_suite,55,logistics,,kappa-${DOMAIN},United States`,
  `Nia,Quin ${E},CEO,Lambda ${E},nia@lambda-${DOMAIN},Bounced,c_suite,11-50,saas,,lambda-${DOMAIN},India`,
  `Lia,Moss ${E},COO,Iota ${E},LIA@${DOMAIN.toUpperCase()},Verified,c_suite,"1,200",software,,,India`,
  `Ed,Fry ${E},CEO,Omicron ${E},not-an-email,Verified,,,,,omicron-${DOMAIN},India`,
  `"=HYPERLINK(""http://evil"")",Evil ${E},CEO,Evil ${E},evil@bad,Verified,,,,,,India`,
].join("\n");

let campaignId = "";

async function upload(page: Page, campaign: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/import");
  await page.getByLabel("Campaign").selectOption({ label: campaign });
  await page.locator('input[name="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]{36}$/);
}

test.beforeAll(async () => {
  const admin = adminClient();
  campaignId = (await admin.from("campaigns").insert({ name: CAMPAIGN, icp: { requireEmail: true } }).select("id").single()).data!.id;
  await admin.from("campaigns").insert({ name: RESEARCH, icp: { requireEmail: false } });
});

test("upload, preview, Apollo preset, and a dry run that writes nothing", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/import");
  // upload validation
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page.getByTestId("error-campaignId")).toHaveText("Choose a campaign");
  await page.getByLabel("Campaign").selectOption({ label: CAMPAIGN });
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page.getByTestId("error-file")).toHaveText("Choose a CSV or Excel file");
  await page.locator('input[name="file"]').setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page.getByTestId("error-file")).toHaveText("Unsupported file type");
  await page.locator('input[name="file"]').setInputFiles({ name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("x") });
  await page.getByRole("button", { name: "Upload and continue" }).click();
  await expect(page.getByTestId("error-file")).toHaveText("Save as .xlsx or CSV first");

  await upload(page, CAMPAIGN, { name: `${E}-apollo.csv`, mimeType: "text/csv", buffer: Buffer.from(APOLLO_CSV) });
  await expect(page.getByTestId("preview")).toContainText(`Moss ${E}`);
  // Apollo columns were recognised without any clicks
  await expect(page.locator("#map_email")).toHaveValue("Email");
  await expect(page.locator("#map_profile_url")).toHaveValue("Person Linkedin Url");
  await expect(page.locator("#map_employee_count")).toHaveValue("# Employees");
  await expect(page.getByLabel(/^Dry run/)).toBeChecked();

  // an unusable mapping is explained, not run
  await page.locator("#map_email").selectOption("");
  await page.getByRole("button", { name: "Start dry run" }).click();
  await expect(page.getByTestId("error-mapping")).toContainText("Map an Email column");
  await page.getByRole("button", { name: "Apollo preset" }).click();
  await expect(page.locator("#map_email")).toHaveValue("Email");

  await page.getByLabel("Save this mapping as a template (optional)").fill(`${E} apollo template`);
  await page.getByRole("button", { name: "Start dry run" }).click();

  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("dry-run-banner")).toContainText("nothing was written");
  await expect(page.getByTestId("total-imported")).toHaveText("2");
  await expect(page.getByTestId("total-duplicate")).toHaveText("1");
  await expect(page.getByTestId("total-invalid")).toHaveText("3");
  await expect(page.getByTestId("total-suppressed")).toHaveText("0");
  const why = await page.getByTestId("import-result-row").allInnerTexts();
  expect(why.join("\n")).toMatch(/Duplicate of row 2 in this file \(same email\)/);
  expect(why.join("\n")).toMatch(/source marks this email as invalid or bounced/);
  expect(why.join("\n")).toMatch(/not a valid email address/);

  const admin = adminClient();
  const { count } = await admin.from("contacts").select("id", { count: "exact", head: true }).like("email_lower", `%${DOMAIN}`);
  expect(count).toBe(0);
});

test("run it for real from the dry run, then download the rows that were not imported", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/import");
  await page.getByTestId("import-row").filter({ hasText: `${E}-apollo.csv` }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Run it for real" })).toBeVisible();
  const dry = page.getByLabel(/^Dry run/);
  await expect(dry).not.toBeChecked();
  await expect(page.getByLabel("Add new only")).toBeChecked();
  await page.getByRole("button", { name: "Start import" }).click();

  // the previous (dry run) summary is still on screen right after the click: wait for the NEW completed summary
  await expect(async () => {
    await expect(page.getByTestId("summary")).toBeVisible();
    await expect(page.getByTestId("dry-run-banner")).toHaveCount(0);
  }).toPass({ timeout: 90_000 });
  await expect(page.getByTestId("total-imported")).toHaveText("2");
  await expect(page.getByTestId("total-duplicate")).toHaveText("1");
  await expect(page.getByTestId("total-invalid")).toHaveText("3");

  const admin = adminClient();
  const { data: contacts } = await admin
    .from("contacts")
    .select("email, email_lower, email_status, profile_url, companies(domain, employee_count)")
    .like("email_lower", `%${DOMAIN}`);
  expect(contacts).toHaveLength(2);
  expect(contacts!.map((c) => c.email_status).sort()).toEqual(["risky", "valid"]);
  const lia = contacts!.find((c) => c.email_lower === `lia@${DOMAIN}`)!;
  expect(lia.profile_url).toBe(`https://linkedin.com/in/lia-${E}`);
  expect(lia.companies).toMatchObject({ domain: DOMAIN, employee_count: 1200 });
  const { count: leads } = await admin.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
  expect(leads).toBe(2);

  // CSV of not-imported rows: reasons included, formula injection neutralised
  const link = page.getByTestId("download-errors");
  const res = await page.request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain("not-imported.csv");
  const csv = await res.text();
  expect(csv.split("\r\n")[0]).toMatch(/^﻿row_number,status,errors,First Name,/);
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  expect(csv).toContain("Duplicate of row 2");
});

test("uploading the same file again warns, and the saved template is offered", async ({ page }) => {
  await loginAs(page, "operator");
  await upload(page, CAMPAIGN, { name: `${E}-apollo-again.csv`, mimeType: "text/csv", buffer: Buffer.from(APOLLO_CSV) });
  await expect(page.getByTestId("same-file-warning")).toContainText("This exact file was already uploaded");
  await expect(page.getByRole("button", { name: `Template: ${E} apollo template` })).toBeVisible();

  // run for real again: everyone is already in the campaign -> reported as duplicates, nothing is created twice
  await page.getByLabel(/^Dry run/).uncheck();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("total-imported")).toHaveText("0");
  await expect(page.getByTestId("total-duplicate")).toHaveText("3");
  const { count } = await adminClient().from("contacts").select("id", { count: "exact", head: true }).like("email_lower", `%${DOMAIN}`);
  expect(count).toBe(2);
});

test("Excel: worksheet picker, header override and previews", async ({ page }) => {
  await loginAs(page, "operator");
  await upload(page, CAMPAIGN, { name: `${E}-types.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixture("excel-types.xlsx") });
  const sheet = page.locator('select[name="sheet"]');
  await expect(sheet).toHaveValue("Leads");
  await expect(page.getByTestId("preview")).toContainText("yan@psi.example.com");
  await expect(page.getByTestId("preview")).toContainText("2026-09-01");
  await sheet.selectOption("Other");
  await page.getByRole("button", { name: "Reload preview" }).click();
  await expect(page.getByTestId("preview")).toContainText("Pat Cox");
  await expect(page.getByTestId("preview")).not.toContainText("yan@psi");
  // pretend the first row is data: columns are named by position
  await page.locator('select[name="header"]').selectOption("no");
  await page.getByRole("button", { name: "Reload preview" }).click();
  await expect(page.getByTestId("preview")).toContainText("Column 1");
});

test("research-first campaign: a file without an email column is accepted, a standard one is not", async ({ page }) => {
  await loginAs(page, "operator");
  const csv = `Name,Company,LinkedIn\nGil Ash ${E},Pi ${E},https://www.linkedin.com/in/gil-${E}/\n`;
  await upload(page, CAMPAIGN, { name: `${E}-noemail.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Start dry run" }).click();
  await expect(page.getByTestId("error-mapping")).toContainText("Map an Email column");

  await upload(page, RESEARCH, { name: `${E}-noemail2.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("This campaign is research-first")).toBeVisible();
  await page.getByLabel(/^Dry run/).uncheck();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("total-imported")).toHaveText("1");
});

test("a file over 50,000 rows is refused with a clear message", async ({ page }) => {
  test.setTimeout(180_000);
  await loginAs(page, "operator");
  const body = "First Name,Email\n" + Array.from({ length: 50_001 }, (_, i) => `P${i},p${i}@big-${E}.example.com`).join("\n") + "\n";
  await upload(page, CAMPAIGN, { name: `${E}-big.csv`, mimeType: "text/csv", buffer: Buffer.from(body) });
  await expect(page.getByTestId("parse-error")).toContainText("50,001 data rows. The limit is 50,000 per file");
  await expect(page.getByRole("button", { name: "Start import" })).toHaveCount(0);
});

test("the Windows-1252 and semicolon fixtures import end to end with accents intact", async ({ page }) => {
  await loginAs(page, "operator");
  const csv = Buffer.from(`First Name;Last Name;Email;Company\nJosé;Müller ${E};jose@win-${DOMAIN};Béta ${E}\n`, "latin1");
  await upload(page, CAMPAIGN, { name: `${E}-win.csv`, mimeType: "text/csv", buffer: csv });
  await expect(page.getByTestId("preview")).toContainText("José");
  await expect(page.getByTestId("preview")).toContainText("Béta");
  await page.getByLabel(/^Dry run/).uncheck();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 90_000 });
  const { data } = await adminClient().from("contacts").select("first_name, company_name").like("email_lower", `%win-${DOMAIN}`).single();
  expect(data).toMatchObject({ first_name: "José", company_name: `Béta ${E}` });
});
