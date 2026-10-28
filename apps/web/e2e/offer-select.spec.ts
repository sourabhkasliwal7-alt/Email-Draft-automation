import { expect, test } from "@playwright/test";
import { adminClient, hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

// "e2esimple" rows are removed by the simple-flow cleanup (campaigns, mailboxes); the offer is removed at the end of the test
const TAG = `e2esimple-offer-${Date.now().toString(36)}`;

/**
 * Bug: choosing an offer on the campaign form jumped back to "No offer chosen". The form re-rendered on the `input` event of the select
 * (the live preview of the search queries), and React reset the controlled select to its old value before the `change` event arrived.
 */
test("choosing an offer and a mailbox on the campaign form sticks, is saved, and is shown again when the campaign is opened", async ({ page }) => {
  const admin = adminClient();
  const { data: offer } = await admin.from("offers").insert({ name: `${TAG} White-label development`, allowed_claims: ["Fixed-scope audit"], cta_options: ["Open to a quick call?"] }).select("id").single();
  await admin.from("case_studies").insert({ offer_id: offer!.id, title: `${TAG} case study`, summary: "Illustrative", allowed_numbers: { hours: 12 } });
  const { data: inbox } = await admin.from("inboxes").insert({ email: `${TAG}@example.com`, display_name: "Sam", status: "active" }).select("id").single();
  try {
    await loginAs(page, "operator");
    await page.goto("/campaigns/new");
    await page.getByLabel("Campaign name").fill(`${TAG} campaign`);
    // typing in a field the query preview reads re-renders the form: the choice must survive that too
    await page.getByLabel("Industries", { exact: true }).fill("saas");

    const offerSelect = page.getByLabel("Offer", { exact: true });
    await expect(offerSelect).toHaveValue("");
    await offerSelect.selectOption({ label: `${TAG} White-label development` });
    await page.waitForTimeout(500); // a reset would have happened by now
    await expect(offerSelect).toHaveValue(offer!.id);
    await expect(page.getByTestId("offer-case-studies")).toContainText(`${TAG} case study`);
    await page.getByLabel("Industries", { exact: true }).fill("saas, logistics");
    await expect(offerSelect).toHaveValue(offer!.id); // still chosen after more typing

    const mailbox = page.getByLabel("Gmail mailbox");
    await mailbox.selectOption({ label: `${TAG}@example.com` });
    await page.waitForTimeout(300);
    await expect(mailbox).toHaveValue(inbox!.id);

    await page.getByRole("button", { name: "Create campaign" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
    const { data: saved } = await admin.from("campaigns").select("id, offer_id, inbox_id").eq("name", `${TAG} campaign`).single();
    expect(saved).toMatchObject({ offer_id: offer!.id, inbox_id: inbox!.id });

    // open it again: both are shown, and changing the offer back to none is saved too
    await page.goto(`/campaigns/${saved!.id}`);
    await expect(page.getByLabel("Offer", { exact: true })).toHaveValue(offer!.id);
    await expect(page.getByLabel("Gmail mailbox")).toHaveValue(inbox!.id);
    await expect(page.getByTestId("offer-case-studies")).toContainText(`${TAG} case study`);
    await page.getByLabel("Offer", { exact: true }).selectOption({ label: "No offer chosen" });
    await page.waitForTimeout(300);
    await expect(page.getByLabel("Offer", { exact: true })).toHaveValue("");
    await page.getByLabel("Offer", { exact: true }).selectOption({ label: `${TAG} White-label development` });
    await page.getByRole("button", { name: "Save campaign" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=campaigns$/);
    expect((await admin.from("campaigns").select("offer_id").eq("id", saved!.id).single()).data!.offer_id).toBe(offer!.id);
  } finally {
    // the campaign and the mailbox are removed by the simple-flow cleanup; the offer can only go once nothing uses it
    await admin.from("campaigns").update({ offer_id: null }).like("name", `${TAG}%`);
    await admin.from("case_studies").delete().eq("offer_id", offer!.id);
    await admin.from("offers").delete().eq("id", offer!.id);
  }
});
