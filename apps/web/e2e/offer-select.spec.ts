import { expect, test } from "@playwright/test";
import { adminClient, hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

// "e2esimple" rows are removed by the simple-flow cleanup (campaigns, mailboxes); the offers are removed at the end of the test
const TAG = `e2esimple-offer-${Date.now().toString(36)}`;

/**
 * A campaign has one or more offers and a default one. The earlier bug (kept as a guard): choosing an offer jumped back, because the form
 * re-rendered on the `input` event of the select (the live preview of the search queries) and React reset the controlled select.
 */
test("a campaign takes several offers and a default; the choice sticks, is saved, and is shown again when the campaign is opened", async ({ page }) => {
  const admin = adminClient();
  const { data: agency } = await admin.from("offers").insert({ name: `${TAG} White-label for agencies`, allowed_claims: ["Fixed-scope audit"], cta_options: ["Open to a quick call?"], match_terms: ["agency", "web design"] }).select("id").single();
  const { data: health } = await admin.from("offers").insert({ name: `${TAG} Healthtech capacity`, allowed_claims: ["Fixed-scope audit"], match_terms: ["healthcare", "health tech"], trigger_types: ["hiring-developers"] }).select("id").single();
  await admin.from("case_studies").insert({ offer_id: agency!.id, title: `${TAG} case study`, summary: "Illustrative", allowed_numbers: { hours: 12 } });
  const { data: inbox } = await admin.from("inboxes").insert({ email: `${TAG}@example.com`, display_name: "Sam", status: "active" }).select("id").single();
  try {
    await loginAs(page, "operator");
    await page.goto("/campaigns/new");
    await page.getByLabel("Campaign name").fill(`${TAG} campaign`);
    // typing in a field the query preview reads re-renders the form: the choices must survive that too
    await page.getByLabel("Industries", { exact: true }).fill("saas");

    // the offer list shows each offer's rules; nothing is ticked and there is no default yet
    const defaultOffer = page.getByLabel("Default offer");
    await expect(page.getByTestId("offer-options")).toContainText("Fits: agency, web design");
    await expect(page.getByTestId("offer-options")).toContainText("Fits: healthcare, health tech");
    await expect(defaultOffer).toHaveValue("");

    // at least one offer is required
    await page.getByRole("button", { name: "Create campaign" }).click();
    await expect(page.getByTestId("error-offerIds")).toHaveText("Choose at least one offer");

    await page.getByTestId(`offer-${agency!.id}`).check();
    await expect(defaultOffer).toHaveValue(agency!.id); // the first ticked offer becomes the default
    await page.getByTestId(`offer-${health!.id}`).check();
    await page.getByLabel("Industries", { exact: true }).fill("saas, logistics");
    await page.waitForTimeout(500); // a reset would have happened by now
    await expect(page.getByTestId(`offer-${agency!.id}`)).toBeChecked();
    await expect(page.getByTestId(`offer-${health!.id}`)).toBeChecked();
    await expect(page.getByTestId("offer-case-studies")).toContainText(`${TAG} case study`);

    // the default is chosen among the ticked offers only
    await expect(defaultOffer.locator("option")).toHaveText(["Choose the default offer", `${TAG} Healthtech capacity`, `${TAG} White-label for agencies`]); // listed by name
    await defaultOffer.selectOption({ label: `${TAG} Healthtech capacity` });
    await page.getByLabel("Industries", { exact: true }).fill("saas, logistics, fintech");
    await expect(defaultOffer).toHaveValue(health!.id); // still chosen after more typing

    const mailbox = page.getByLabel("Gmail mailbox");
    await mailbox.selectOption({ label: `${TAG}@example.com` });
    await page.waitForTimeout(300);
    await expect(mailbox).toHaveValue(inbox!.id);

    await page.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
    const { data: saved } = await admin.from("campaigns").select("id, offer_id, offer_ids, inbox_id").eq("name", `${TAG} campaign`).single();
    expect(saved).toMatchObject({ offer_id: health!.id, inbox_id: inbox!.id });
    expect([...saved!.offer_ids].sort()).toEqual([agency!.id, health!.id].sort());
    // Setup lists both offers and marks the default
    const row = page.getByTestId("campaign-row").filter({ hasText: `${TAG} campaign` });
    await expect(row.getByTestId("campaign-offers")).toContainText(`${TAG} White-label for agencies`);
    await expect(row.getByTestId("campaign-offers")).toContainText(new RegExp(`${TAG} Healthtech capacity\\s*\\(default\\)`));

    // open it again: both offers, the default and the mailbox are shown
    await page.goto(`/campaigns/${saved!.id}`);
    await expect(page.getByTestId(`offer-${agency!.id}`)).toBeChecked();
    await expect(page.getByTestId(`offer-${health!.id}`)).toBeChecked();
    await expect(page.getByLabel("Default offer")).toHaveValue(health!.id);
    await expect(page.getByLabel("Gmail mailbox")).toHaveValue(inbox!.id);

    // unticking the default moves the default to a ticked offer; the choice is saved
    await page.getByTestId(`offer-${health!.id}`).uncheck();
    await expect(page.getByLabel("Default offer")).toHaveValue(agency!.id);
    await page.getByRole("button", { name: "Save campaign" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
    expect((await admin.from("campaigns").select("offer_id, offer_ids").eq("id", saved!.id).single()).data).toMatchObject({ offer_id: agency!.id, offer_ids: [agency!.id] });
  } finally {
    // the campaign and the mailbox are removed by the simple-flow cleanup; the offers can only go once nothing uses them
    await admin.from("campaigns").update({ offer_id: null, offer_ids: [] }).like("name", `${TAG}%`);
    await admin.from("case_studies").delete().eq("offer_id", agency!.id);
    await admin.from("offers").delete().in("id", [agency!.id, health!.id]);
  }
});

test("an offer's matching rules are saved from the offer form", async ({ page }) => {
  const admin = adminClient();
  const name = `${TAG} rules offer`;
  try {
    await loginAs(page, "operator");
    await page.goto("/offers/new");
    await page.getByLabel("Offer name").fill(name);
    await page.getByLabel("Fits these businesses").fill("agency, web design\nsaas");
    await page.getByLabel("Hiring developers").check();
    await page.getByLabel("Funding").check();
    await page.getByRole("button", { name: "Create offer" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const { data } = await admin.from("offers").select("match_terms, trigger_types").eq("name", name).single();
    expect(data).toMatchObject({ match_terms: ["agency", "web design", "saas"], trigger_types: ["hiring-developers", "funding"] });

    // opened again, the rules are filled in
    await expect(page.getByLabel("Fits these businesses")).toHaveValue("agency, web design, saas");
    await expect(page.getByLabel("Hiring developers")).toBeChecked();
    await expect(page.getByLabel("Funding")).toBeChecked();
    await expect(page.getByLabel("Launch / new product")).not.toBeChecked();
  } finally {
    await admin.from("offers").delete().eq("name", name);
  }
});
