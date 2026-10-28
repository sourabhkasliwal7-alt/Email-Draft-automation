import { expect, test } from "@playwright/test";
import { adminClient, hasDb, loginAs } from "./support";
import { cleanupSimpleData } from "./db-cleanup";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

/** Everything this spec seeds carries the tag, and cleanupSimpleData() removes it. Nothing here makes a paid call or sends anything. */
const E = `e2esimple${Math.random().toString(36).slice(2, 8)}`;
// campaigns named "itest ..." are never touched by a worker, so nothing seeded here can ever be run by accident
const CSV_CAMPAIGN = `itest ${E} csv campaign`;
const APOLLO_CAMPAIGN = `itest ${E} apollo campaign`;
const WEB_CAMPAIGN = `itest ${E} web campaign`;
const INBOX_EMAIL = `${E}@example.com`;
const MESSAGE_ID = "18c0ffee12345678";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

const ids = { inbox: "", csv: "", apollo: "", web: "", webFind: "", runReal: "", runTest: "", runLive: "", find: "" };
const leads: Record<string, string> = {};
let workflowBefore: unknown = null;

async function mkLead(
  key: string,
  o: { campaign: string; status: string; next_action?: string | null; reason_codes?: string[]; score?: number | null; email?: string | null; source?: string; detail?: string; noPerson?: boolean },
) {
  const admin = adminClient();
  const { data: company } = await admin.from("companies").insert({ domain: `${key.toLowerCase()}-${E}.example.com`, name: `${key} ${E}` }).select("id").single();
  const { data: contact } = await admin
    .from("contacts")
    .insert(
      o.noPerson
        ? { company_id: company!.id, company_name: `${key} ${E}` }
        : { first_name: key, last_name: `Lead ${E}`, full_name: `${key} Lead ${E}`, job_title: "COO", email: o.email === undefined ? `${key.toLowerCase()}-${E}@example.com` : o.email, company_id: company!.id, company_name: `${key} ${E}` },
    )
    .select("id")
    .single();
  const { data: lead, error } = await admin
    .from("campaign_leads")
    .insert({ campaign_id: o.campaign, contact_id: contact!.id, status: o.status, next_action: o.next_action ?? null, reason_codes: o.reason_codes ?? [], lead_score: o.score ?? null, lead_source: o.source ?? "e2esimple", source_detail: o.detail ?? null })
    .select("id")
    .single();
  expect(error).toBeNull();
  leads[key] = lead!.id;
  return lead!.id;
}

test.beforeAll(async () => {
  const admin = adminClient();
  workflowBefore = (await admin.from("settings").select("value").eq("key", "workflow").maybeSingle()).data?.value ?? null;
  ids.inbox = (await admin.from("inboxes").insert({ email: INBOX_EMAIL, display_name: "E2E", status: "active", scopes: [COMPOSE, MODIFY], connected_at: new Date().toISOString() }).select("id").single()).data!.id;
  ids.csv = (await admin.from("campaigns").insert({ name: CSV_CAMPAIGN, inbox_id: ids.inbox, icp: { leadSource: "csv", requireEmail: true } }).select("id").single()).data!.id;
  ids.apollo = (await admin.from("campaigns").insert({ name: APOLLO_CAMPAIGN, inbox_id: ids.inbox, icp: { leadSource: "apollo", requireEmail: false, seniorities: ["founder"] } }).select("id").single()).data!.id;

  ids.web = (await admin.from("campaigns").insert({ name: WEB_CAMPAIGN, inbox_id: ids.inbox, icp: { leadSources: ["web"], leadSource: "web", requireEmail: false } }).select("id").single()).data!.id;

  // two finished runs: the newest is REAL (with the numbers Home shows), an older one is a TEST run.
  // Their times are in the future on purpose: they stay the newest runs however many runs other work creates meanwhile.
  const now = Date.now() + 2 * 3_600_000;
  ids.runReal = (
    await admin
      .from("pipeline_batches")
      .insert({
        campaign_id: ids.csv,
        label: `${E} real`,
        status: "completed",
        estimate: { dryRun: false },
        started_at: new Date(now - 60_000).toISOString(),
        finished_at: new Date(now - 30_000).toISOString(),
        totals: { target: 20, dryRun: false, log: [{ at: new Date().toISOString(), step: "done", count: 5 }], funnel: { found: 12, checked: 10, researched: 8, approved: 6, drafted: 5 }, summary: { leads: 12, drafts: 5, dryRun: false, needsAttention: 1, quality: { firstTry: 3, afterRewrite: 2, failed: 1 } } },
      })
      .select("id")
      .single()
  ).data!.id;
  ids.runTest = (
    await admin
      .from("pipeline_batches")
      .insert({
        campaign_id: ids.csv,
        label: `${E} test`,
        status: "completed",
        estimate: { dryRun: true },
        started_at: new Date(now - 3_600_000).toISOString(),
        finished_at: new Date(now - 3_500_000).toISOString(),
        totals: { target: 20, dryRun: true, log: [], summary: { leads: 4, drafts: 0, dryRun: true } },
      })
      .select("id")
      .single()
  ).data!.id;

  // leads in every state the list can show
  await mkLead("Found", { campaign: ids.csv, status: "imported" });
  await mkLead("Researched", { campaign: ids.csv, status: "scored", score: 70 });
  await mkLead("Skipped", { campaign: ids.csv, status: "disqualified", reason_codes: ["below-threshold", "score 52"] });
  const ready = await mkLead("Ready", { campaign: ids.csv, status: "draft_ready", next_action: "wait-send", score: 80 });
  await admin.from("email_drafts").insert({
    campaign_lead_id: ready,
    step: 0,
    version: 1,
    subject: `${E} white-label help`,
    body_text: `Hi Ready,\n\nA short note that ends the preview.\n\n--\n1 Test Street\nReply STOP`,
    body_hash: `${E}-hash`,
    status: "approved",
    inbox_id: ids.inbox,
    gmail_draft_id: `r-${E}`,
    gmail_message_id: MESSAGE_ID,
    quality_score: 83,
    idempotency_key: `${E}-draft`,
  } as never);
  await mkLead("Failed", { campaign: ids.csv, status: "approved", next_action: "draft", score: 76, reason_codes: ["step-failed", "write: OpenRouter says the account has too few credits (402)"] });
  await mkLead("NoMail", { campaign: ids.csv, status: "disqualified", reason_codes: ["no-email", "no email in the CSV and no Apollo id to reveal one"], email: null });
  await mkLead("SkipMe", { campaign: ids.csv, status: "approved", next_action: "reveal", reason_codes: ["step-failed", "reveal: ZeroBounce validate failed"] });

  // quick-check results and the run report: a lead the quick check turned down (it can be checked again), and the real run's lead list
  await mkLead("ScreenNo", { campaign: ids.apollo, status: "disqualified", reason_codes: ["screen-failed", "looks like a restaurant"] });
  await admin.from("campaign_leads").update({ score_components: { screen: { fit: "no", business_type: "restaurant", reason: "serves food, not software", mode: "mock" } } }).eq("id", leads.ScreenNo!);
  await admin.from("campaign_leads").update({ score_components: { screen: { fit: "uncertain", business_type: "software agency", reason: "thin homepage", mode: "mock" } } }).eq("id", leads.Ready!);
  await admin.from("pipeline_batches").update({ totals: { target: 20, dryRun: false, log: [{ at: new Date().toISOString(), step: "done", count: 5 }], funnel: { found: 12, checked: 10, researched: 8, approved: 6, drafted: 5 }, summary: { leads: 12, drafts: 5, dryRun: false, needsAttention: 1, quality: { firstTry: 3, afterRewrite: 2, failed: 1 } }, leadIds: [leads.Ready!], reportExtraIds: [leads.ScreenNo!], approveCutoff: 55 } }).eq("id", ids.runReal);

  // Web discovery: one company with a person found, one without (parked under Needs attention), and a finished Google search
  await mkLead("WebFound", { campaign: ids.web, status: "researching", source: "web_discovery", detail: "saas agency hiring react" });
  await mkLead("WebNone", { campaign: ids.web, status: "disqualified", reason_codes: ["no-contact", "WebNone: a software agency (webnone.example.com)"], source: "web_discovery", detail: "saas agency pune", noPerson: true, email: null });
  ids.webFind = (
    await admin
      .from("jobs")
      .insert({
        type: "web.find",
        idempotency_key: `${E}-webfind-done`,
        payload: { campaignId: ids.web },
        campaign_id: ids.web,
        status: "completed",
        result: {
          queries: ["saas agency pune", "saas agency hiring react"],
          queriesRun: 2,
          results: 20,
          kept: 6,
          checked: 3,
          contacts: 2,
          noContact: 1,
          skipped: { excluded: 9, known: 3, failedCheck: 2, noData: 1 },
          companies: [
            { domain: `webfound-${E}.example.com`, name: `WebFound ${E}`, query: "saas agency hiring react", outcome: "lead" },
            { domain: `webnone-${E}.example.com`, name: `WebNone ${E}`, query: "saas agency pune", outcome: "no-contact" },
            { domain: `weboff-${E}.example.com`, name: `WebOff ${E}`, query: "saas agency pune", outcome: "failed-check" },
          ],
          demo: true,
        },
      })
      .select("id")
      .single()
  ).data!.id;

  // a finished Apollo search for the Apollo campaign
  ids.find = (
    await admin
      .from("jobs")
      .insert({ type: "apollo.find", idempotency_key: `${E}-find-done`, payload: { campaignId: ids.apollo }, campaign_id: ids.apollo, status: "completed", result: { found: 12, imported: 10, duplicate: 2, suppressed: 0, invalid: 0, demo: true, note: "" } })
      .select("id")
      .single()
  ).data!.id;
});

test.afterAll(async () => {
  const admin = adminClient();
  if (workflowBefore === null) await admin.from("settings").delete().eq("key", "workflow");
  else await admin.from("settings").upsert({ key: "workflow", value: workflowBefore as never }, { onConflict: "key" });
  await cleanupSimpleData();
});

test("Home: status card, the last run as a funnel, email quality, REAL and TEST badges, credits and the Gmail link", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByTestId("status-card")).toBeVisible();
  await expect(page.getByTestId("status-title")).not.toBeEmpty();

  // last run = the newest finished one (ours, REAL), as Found -> Checked -> Researched -> Approved -> Drafted
  const funnel = page.getByTestId("funnel");
  await expect(funnel).toBeVisible();
  const labels = await funnel.locator("li div:nth-child(2)").allInnerTexts();
  expect(labels).toEqual(["Found", "Checked", "Researched", "Approved", "Drafted"]);
  await expect(page.getByTestId("funnel-found")).toHaveText("12");
  await expect(page.getByTestId("funnel-checked")).toHaveText("10");
  await expect(page.getByTestId("funnel-researched")).toHaveText("8");
  await expect(page.getByTestId("funnel-approved")).toHaveText("6");
  await expect(page.getByTestId("funnel-drafted")).toHaveText("5");
  await expect(page.getByTestId("last-run").getByTestId("run-mode-real")).toBeVisible();
  await expect(page.getByTestId("quality")).toHaveText("Email quality: 3 of 6 passed first time, 2 after one rewrite, 1 need attention.");

  // every run in the list says REAL or TEST
  const rows = page.getByTestId("run-row").filter({ hasText: CSV_CAMPAIGN });
  await expect(rows).toHaveCount(2);
  await expect(rows.getByTestId("run-mode-real")).toHaveCount(1);
  await expect(rows.getByTestId("run-mode-test")).toHaveCount(1);

  await expect(page.getByTestId("apollo-credits")).toContainText(/Apollo email credits used: \d+ today, \d+ this month/);
  const gmail = await page.getByTestId("open-gmail-drafts").getAttribute("href");
  expect(gmail).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/\?authuser=.+#drafts$/);
  await expect(page.getByTestId("attention-link")).toContainText("Needs attention (");

  // the run details say REAL/TEST too, show the pass rate, and lead back to Home
  await page.goto(`/runs/${ids.runReal}`);
  await expect(page.getByTestId("run-mode-real")).toBeVisible();
  await expect(page.getByTestId("run-quality")).toHaveText("Email quality: 3 of 6 passed first time, 2 after one rewrite, 1 need attention.");
  await page.goto(`/runs/${ids.runTest}`);
  await expect(page.getByTestId("run-mode-test")).toBeVisible();
  await page.getByRole("link", { name: /Home/ }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("Home: the Getting started list is shown only while something is missing, in order, with a link for each step", async ({ page }) => {
  const admin = adminClient();
  const [offers, footer, realRuns] = await Promise.all([
    admin.from("offers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("settings").select("value").eq("key", "workflow").maybeSingle(),
    admin.from("pipeline_batches").select("id, estimate").eq("estimate->>dryRun", "false").limit(1),
  ]);
  const wf = (footer.data?.value ?? {}) as { postal_address?: string; optout_line?: string };
  const complete = (offers.count ?? 0) > 0 && Boolean(wf.postal_address?.trim()) && Boolean(wf.optout_line?.trim()) && (realRuns.data?.length ?? 0) > 0;
  await loginAs(page, "admin");
  await page.goto("/");
  const checklist = page.getByTestId("checklist");
  if (complete) {
    await expect(checklist).toHaveCount(0);
  } else {
    await expect(checklist).toBeVisible();
    await expect(checklist.locator("li")).toHaveText([/Connect Gmail/, /Add an offer/, /Set the email footer/, /Create a campaign/, /Add leads \(CSV, Apollo or Google\)/, /Start your first run/]);
    // what the seeded data completes is ticked: mailbox, campaign, leads, a real run
    await expect(page.getByTestId("step-gmail")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("step-campaign")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("step-leads")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("step-run")).toHaveAttribute("data-done", "true");
    if ((offers.count ?? 0) === 0) await expect(page.getByTestId("step-offer")).toHaveAttribute("data-done", "false");
  }
});

test("Home: the button says Start run or Start test run (no drafts), and the confirmation says which one", async ({ page }) => {
  const forced = Boolean((workflowBefore as { dry_run?: boolean } | null)?.dry_run);
  await loginAs(page, "operator");
  await page.goto("/");
  const form = page.getByTestId("start-run-form");
  await expect(form).toBeVisible();
  const test = form.locator("input[type=checkbox][name=dryRun]");
  const dialog = page.getByTestId("confirm-dialog");
  if (forced) {
    await expect(test).toBeChecked();
    await expect(test).toBeDisabled();
    await expect(form.getByRole("button", { name: "Start test run (no drafts)", exact: true })).toBeVisible();
  } else {
    await expect(test).not.toBeChecked();
    await expect(form.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
    await form.getByRole("button", { name: "Start run", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Real run");
    await expect(dialog).toContainText("Nothing is ever sent");
    await page.getByTestId("confirm-cancel").click(); // never start anything from a test
    await test.check();
    await expect(form.getByRole("button", { name: "Start test run (no drafts)", exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: "Start run", exact: true })).toHaveCount(0);
    await form.getByRole("button", { name: "Start test run (no drafts)", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Test run");
    await page.getByTestId("confirm-cancel").click();
    await test.uncheck();
    await expect(form.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
  }
  // dismissed: no run was created
  const { data } = await adminClient().from("pipeline_batches").select("id").in("campaign_id", [ids.csv, ids.apollo]).in("status", ["running", "paused"]);
  expect(data).toEqual([]);
});

test("Home: a yellow warning shows while email checking is switched off, and only then", async ({ page }) => {
  const admin = adminClient();
  await loginAs(page, "operator");
  await page.goto("/");
  await expect(page.getByTestId("skip-verification-banner")).toHaveCount(0);
  await admin.from("settings").upsert({ key: "workflow", value: { ...((workflowBefore as object | null) ?? {}), skip_verification: true } as never }, { onConflict: "key" });
  try {
    await page.reload();
    const banner = page.getByTestId("skip-verification-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Email checking is OFF (testing only)");
    await expect(banner).toHaveClass(/yellow/);
  } finally {
    if (workflowBefore === null) await admin.from("settings").delete().eq("key", "workflow");
    else await admin.from("settings").upsert({ key: "workflow", value: workflowBefore as never }, { onConflict: "key" });
  }
  await page.reload();
  await expect(page.getByTestId("skip-verification-banner")).toHaveCount(0);
});

test("Home: a mailbox connected before the label permission is flagged so it can be reconnected", async ({ page }) => {
  const admin = adminClient();
  await admin.from("inboxes").update({ scopes: [COMPOSE] }).eq("id", ids.inbox);
  try {
    await loginAs(page, "operator");
    await page.goto("/");
    await expect(page.getByTestId("reconnect-note")).toContainText(INBOX_EMAIL);
  } finally {
    await admin.from("inboxes").update({ scopes: [COMPOSE, MODIFY] }).eq("id", ids.inbox);
  }
});

test("Leads: three clear ways to add leads, an Apollo search with its result, and every lead with a plain status", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/leads");
  await expect(page.getByTestId("card-csv")).toContainText("Upload CSV");
  await expect(page.getByTestId("card-apollo")).toContainText("Apollo search");
  await expect(page.getByTestId("card-apollo")).toContainText("no email credits are used");
  // side by side
  const [a, b] = await Promise.all([page.getByTestId("card-csv").boundingBox(), page.getByTestId("card-apollo").boundingBox()]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(5);
  expect(b!.x).toBeGreaterThan(a!.x);

  // only campaigns that use Apollo can search
  const options = await page.locator("#apolloCampaignId option").allInnerTexts();
  expect(options).toContain(APOLLO_CAMPAIGN);
  expect(options).not.toContain(CSV_CAMPAIGN);
  if (process.env.ADAPTER_APOLLO?.trim().toLowerCase() !== "live" || !process.env.APOLLO_API_KEY?.trim()) await expect(page.getByTestId("apollo-demo-note")).toContainText("gives practice people");

  // the latest search result of the campaign, in words
  const line = page.getByTestId(`find-result-${ids.apollo}`);
  await expect(line).toContainText("Practice data (demo): found 12, added 10, 2 already in your list");

  // pressing the button queues the search (a job for this campaign); the test cancels it so nothing runs
  await page.locator("#apolloCampaignId").selectOption({ label: APOLLO_CAMPAIGN });
  await page.getByRole("button", { name: "Preview Apollo leads (optional)" }).click();
  await expect(page.getByTestId("form-message").last()).toContainText("Search started");
  const admin = adminClient();
  const { data: queued } = await admin.from("jobs").select("id, status, payload").eq("type", "apollo.find").eq("campaign_id", ids.apollo).in("status", ["pending", "running"]);
  expect(queued!.length).toBeLessThanOrEqual(1);
  for (const j of queued ?? []) {
    expect(j.payload).toMatchObject({ campaignId: ids.apollo });
    await admin.from("jobs").update({ status: "cancelled" }).eq("id", j.id).eq("status", "pending");
  }

  // the lead list: plain words, no internal status names
  await page.goto(`/leads?campaign=${ids.csv}`);
  const status = async (key: string) => page.getByTestId("lead-row").filter({ hasText: `${key} ${E}` }).getByTestId("lead-status").innerText();
  expect(await status("Found")).toContain("Found");
  expect(await status("Researched")).toContain("Researched");
  expect(await status("Skipped")).toContain("Skipped: Score too low to write to");
  expect(await status("Ready")).toContain("Draft ready");
  expect(await status("Failed")).toContain("Needs attention: Something went wrong on one step");
  expect(await status("NoMail")).toContain("Needs attention: No email address");
  const text = await page.getByTestId("lead-list").innerText();
  expect(text).not.toMatch(/\b(disqualified|imported|step-failed|no-email|below-threshold|draft_ready)\b/);
  // a ready draft opens in Gmail by its message id
  await expect(page.getByTestId("lead-row").filter({ hasText: `Ready ${E}` }).getByRole("link", { name: "Open in Gmail" })).toHaveAttribute("href", `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(INBOX_EMAIL)}#drafts?compose=${MESSAGE_ID}`);
  // the campaign filter narrows the list
  await page.goto(`/leads?campaign=${ids.apollo}`);
  await expect(page.getByTestId("lead-row").filter({ hasText: E })).toHaveCount(0);
});

test("Leads: a third card finds companies on Google, shows the latest result, and every lead says where it came from", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/leads");
  const card = page.getByTestId("card-web");
  await expect(card).toContainText("Find companies on Google");
  await expect(page.getByTestId("web-optional-note")).toContainText("Start run also searches Google automatically");
  // only campaigns that use Web discovery can search
  const options = await card.locator("#webCampaignId option").allInnerTexts();
  expect(options).toContain(WEB_CAMPAIGN);
  expect(options).not.toContain(CSV_CAMPAIGN);
  if (process.env.ADAPTER_APOLLO?.trim().toLowerCase() !== "live" || !process.env.APOLLO_API_KEY?.trim()) await expect(page.getByTestId("web-demo-note")).toContainText("Apollo is not connected");

  // the latest result, in words, and the companies with their outcome
  const result = page.getByTestId(`web-result-${ids.web}`);
  await expect(result).toContainText("2 searches, 20 results, 6 company sites kept, 3 passed the quick check, 2 people found, 1 with no contact found");
  await result.getByText(/Show the 3 companies/).click();
  await expect(result.getByTestId("web-companies").locator("li")).toHaveCount(3);
  await expect(result).toContainText("Found by: saas agency hiring react");
  await expect(result).toContainText("No contact found");

  // pressing the button queues the search; the test cancels it so nothing runs
  await card.locator("#webCampaignId").selectOption({ label: WEB_CAMPAIGN });
  await page.getByTestId("find-web").click();
  await expect(page.getByTestId("form-message").last()).toContainText("Search started");
  const admin = adminClient();
  const { data: queued } = await admin.from("jobs").select("id, payload").eq("type", "web.find").eq("campaign_id", ids.web).in("status", ["pending", "running"]);
  for (const j of queued ?? []) {
    expect(j.payload).toMatchObject({ campaignId: ids.web });
    await admin.from("jobs").update({ status: "cancelled" }).eq("id", j.id).eq("status", "pending");
  }

  // the lead list: source and the query that found the company; a company with no person is never a blank row
  await page.goto(`/leads?campaign=${ids.web}`);
  const found = page.getByTestId("lead-row").filter({ hasText: `WebFound ${E}` });
  await expect(found.getByTestId("lead-source")).toHaveText("Web discovery (Google)");
  await expect(found.getByTestId("lead-found-by")).toHaveText("saas agency hiring react");
  const none = page.getByTestId("lead-row").filter({ hasText: `WebNone ${E}` });
  await expect(none).toContainText(`WebNone ${E}`);
  await expect(none.getByTestId("lead-status")).toContainText("Needs attention: No contact found");
  await page.goto(`/leads?campaign=${ids.csv}`);
  await expect(page.getByTestId("lead-row").filter({ hasText: `Found ${E}` }).getByTestId("lead-source")).toHaveText("CSV file");
  await expect(page.getByTestId("lead-row").filter({ hasText: `Found ${E}` }).getByTestId("lead-found-by")).toHaveText("-");
});

test("Drafts: a company with no contact is explained in plain words, and Retry is not offered", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/drafts?tab=attention");
  const row = page.getByTestId("attention-row").filter({ hasText: `WebNone ${E}` });
  await expect(row.getByTestId("attention-reason")).toHaveText("No contact found: we found this company but no person to write to. Apollo found nobody, or Apollo is not connected.");
  await expect(row.getByTestId("attention-company")).toContainText(`webnone-${E}.example.com`);
  await expect(row.getByTestId("attention-company")).toContainText("Found by: saas agency pune");
  await expect(row.getByTestId("attention-advice")).toContainText("Connect Apollo, or add the person in a CSV file. Each run looks again for free");
  await expect(row.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Skip" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Do not contact" })).toBeVisible();
  expect(await row.innerText()).not.toMatch(/\b(no-contact|web_discovery)\b/);
});

test("Drafts: the drafts list opens each one in Gmail, and the second tab says in plain words what needs attention", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/drafts");
  const row = page.getByTestId("draft-row").filter({ hasText: `${E} white-label help` });
  await expect(row).toBeVisible();
  await expect(row).toContainText("email quality 83%");
  await expect(row.getByTestId("open-in-gmail")).toHaveAttribute("href", `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(INBOX_EMAIL)}#drafts?compose=${MESSAGE_ID}`);
  await row.getByText("Read the email").click();
  await expect(row).toContainText("A short note that ends the preview.");

  await page.getByTestId("tab-attention").click();
  await expect(page).toHaveURL(/\/drafts\?tab=attention$/);
  const failed = page.getByTestId("attention-row").filter({ hasText: `Failed ${E}` });
  await expect(failed.getByTestId("attention-reason")).toHaveText("Something went wrong on one step. Retry tries it again");
  await expect(failed.getByTestId("attention-detail")).toHaveText("Writing the email: OpenRouter says the account has too few credits (402)");
  await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(failed.getByRole("button", { name: "Skip" })).toBeVisible();
  const table = await page.getByTestId("attention-table").innerText();
  expect(table).not.toMatch(/\b(step-failed|no-email|reveal|ledger|adapter)\b/i);
});

test("Drafts: Retry cannot fix a missing email, and tells the person what to do instead", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/drafts?tab=attention");
  const row = page.getByTestId("attention-row").filter({ hasText: `NoMail ${E}` });
  await expect(row.getByTestId("attention-reason")).toContainText("No email address");
  await row.getByRole("button", { name: "Retry" }).click();
  await expect(row.getByTestId("form-message")).toContainText("Add one to your file and upload it again");
  const { data } = await adminClient().from("campaign_leads").select("status, reason_codes").eq("id", leads.NoMail!).single();
  expect(data).toMatchObject({ status: "disqualified", reason_codes: ["no-email", expect.any(String)] });
});

test("Drafts: Retry puts the lead back at the step that failed and carries on in the current run; Skip closes a lead", async ({ page }) => {
  const admin = adminClient();
  // an old unfinished run for the campaign: Retry must join it instead of starting a second one (nothing is started by this test)
  ids.runLive = (
    await admin
      .from("pipeline_batches")
      .insert({ campaign_id: ids.csv, label: `${E} running`, status: "running", estimate: { dryRun: false }, started_at: new Date(Date.now() - 4 * 3_600_000).toISOString(), totals: { target: 20, log: [{ at: new Date().toISOString(), step: "research and score", count: 3 }] } })
      .select("id")
      .single()
  ).data!.id;

  await loginAs(page, "operator");
  await page.goto("/drafts?tab=attention");
  const failed = page.getByTestId("attention-row").filter({ hasText: `Failed ${E}` });
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(page).toHaveURL(/notice=retry_running/);
  await expect(page.getByTestId("notice")).toContainText("continue in the current run");
  await expect(page.getByTestId("notice")).toContainText("Nothing that already ran is repeated");
  // back at the writing step (the research and approval are kept), no failure note, and no second run
  const { data: lead } = await admin.from("campaign_leads").select("status, next_action, reason_codes, lead_score").eq("id", leads.Failed!).single();
  expect(lead).toEqual({ status: "approved", next_action: "draft", reason_codes: [], lead_score: 76 });
  const { data: batches } = await admin.from("pipeline_batches").select("id").eq("campaign_id", ids.csv).in("status", ["running", "paused"]);
  expect(batches).toHaveLength(1);
  await expect(page.getByTestId("attention-row").filter({ hasText: `Failed ${E}` })).toHaveCount(0);

  // Skip: the lead is closed and leaves the list
  const skip = page.getByTestId("attention-row").filter({ hasText: `SkipMe ${E}` });
  await expect(skip.getByTestId("attention-detail")).toContainText("Getting and checking the email address");
  await skip.getByRole("button", { name: "Skip" }).click();
  await page.getByTestId("confirm-yes").click(); // the confirmation dialog
  await expect(page.getByTestId("attention-row").filter({ hasText: `SkipMe ${E}` })).toHaveCount(0);
  const { data: skipped } = await admin.from("campaign_leads").select("status, reason_codes").eq("id", leads.SkipMe!).single();
  expect(skipped).toMatchObject({ status: "disqualified", reason_codes: ["manual"] });
});

test("Home: a run in progress is shown in plain words with its step, and can be cancelled", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/");
  await expect(page.getByTestId("status-title")).toHaveText("Run in progress: research and scoring");
  await expect(page.getByTestId("status-card")).toContainText("This page updates by itself");
  const row = page.getByTestId("run-row").filter({ hasText: CSV_CAMPAIGN }).filter({ hasText: "Running" });
  await expect(row.getByTestId("run-mode-real")).toBeVisible();
  await expect(row.getByRole("button", { name: "Cancel" })).toBeVisible();
});

test("Setup shows the Apollo account section for an admin: key status, demo or live, and a test button", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/setup?tab=apollo");
  const section = page.getByTestId("section-apollo");
  await expect(section).toBeVisible();
  const keySet = Boolean(process.env.APOLLO_API_KEY?.trim());
  await expect(page.getByTestId("apollo-key-status")).toContainText(keySet ? "Apollo key: set" : "Apollo key: not set");
  const live = keySet && process.env.ADAPTER_APOLLO?.trim().toLowerCase() === "live";
  await expect(page.getByTestId("apollo-mode")).toContainText(live ? "Live" : "Practice mode");
  if (!live) await expect(page.getByTestId("apollo-how-to")).toContainText("APOLLO_API_KEY");
  await expect(page.getByTestId("test-apollo")).toBeVisible();
  const text = await section.innerText();
  if (process.env.APOLLO_API_KEY && process.env.APOLLO_API_KEY.length > 8) expect(text).not.toContain(process.env.APOLLO_API_KEY);

  // a finished test shows what the key can do, in plain words (seeded: the worker is not asked to call Apollo)
  await adminClient().from("jobs").insert({
    type: "adapter.test",
    idempotency_key: `${E}-apollo-test`,
    payload: { provider: "apollo" },
    status: "completed",
    result: { ok: true, provider: "apollo", message: "Connected to Apollo.", apollo: { mode: "live", health: true, search: { ok: true }, reveal: { ok: false, message: "Your Apollo plan does not allow unlocking emails through the API" } }, finishedAt: new Date().toISOString() },
  });
  await page.reload();
  const details = page.getByTestId("apollo-test-details");
  await expect(details).toContainText("Key: accepted");
  await expect(details).toContainText("Finding people: allowed");
  await expect(details).toContainText("Getting email addresses: not allowed. Your Apollo plan does not allow unlocking emails");
});

test("Setup is one page with seven numbered tabs, one section visible at a time", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/setup");
  const tabs = await page.getByTestId("setup-tabs").getByRole("link").allInnerTexts();
  expect(tabs.map((t) => t.replace(/\s+/g, " ").replace(/complete|needs action/g, "").trim())).toEqual(["1 Gmail", "2 Apollo", "3 Campaigns", "4 Offers", "5 Email footer", "6 Schedule", "7 Advanced"]);
  const ids: Record<string, string> = { gmail: "mailboxes", apollo: "apollo", campaigns: "campaign", offers: "offer", footer: "footer", schedule: "schedule", advanced: "advanced" };
  for (const [tab, id] of Object.entries(ids)) {
    await page.goto(`/setup?tab=${tab}`);
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await page.goto("/setup?tab=gmail");
  // the technical words live inside Advanced only
  const outside = await page.locator("main").evaluate((main) => {
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelector("[data-testid=technical-details]")?.remove();
    clone.querySelector("[data-testid=google-redirect-uri]")?.remove();
    clone.querySelector("[data-testid=google-not-configured]")?.remove();
    clone.querySelector("[data-testid=testing-warning]")?.remove();
    clone.querySelector("[data-testid=section-apollo]")?.remove();
    return clone.innerText;
  });
  expect(outside).not.toMatch(/\b(ledger|stage A|stage B|ADAPTER_)/i);
});

test("Run report: a download link on the run page and on Home, and the CSV has every lead including the skipped one", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto(`/runs/${ids.runReal}`);
  const link = page.getByTestId("download-report");
  await expect(link).toHaveText("Download run report (CSV)");
  await expect(link).toHaveAttribute("href", `/runs/${ids.runReal}/report`);
  // the run page lists its leads with the quick-check result
  const rows = page.getByTestId("run-lead-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `ScreenNo ${E}` }).getByTestId("run-lead-quick-check")).toContainText("restaurant");
  await expect(rows.filter({ hasText: `Ready ${E}` }).getByTestId("run-lead-quick-check")).toContainText("Maybe");

  await page.goto("/");
  await expect(page.getByTestId("last-run").getByTestId("download-report")).toHaveAttribute("href", `/runs/${ids.runReal}/report`);

  const res = await page.request.get(`/runs/${ids.runReal}/report`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain("run-report-");
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = body.toString("utf8");
  expect(text).toContain(`Ready ${E}`);
  expect(text).toContain(`ScreenNo ${E}`);
  expect(text).toContain("restaurant");
  expect(text).toContain("White-label");
  expect((await page.request.get("/runs/00000000-0000-4000-8000-0000000000ff/report")).status()).toBe(404);
});

test("Leads: every lead shows its quick check, and skipped leads can be checked again", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/leads");
  const no = page.getByTestId("lead-row").filter({ hasText: `ScreenNo ${E}` });
  await expect(no.getByTestId("lead-quick-check")).toContainText("No");
  await expect(no.getByTestId("lead-quick-check")).toContainText("restaurant");
  await expect(no.getByTestId("lead-quick-check")).toContainText("serves food, not software");
  await expect(page.getByTestId("lead-row").filter({ hasText: `Ready ${E}` }).getByTestId("lead-quick-check")).toContainText("Maybe");
  await expect(page.getByTestId("lead-row").filter({ hasText: `Found ${E}` }).getByTestId("lead-quick-check")).toHaveText("-");

  await expect(page.getByTestId("recheck-help")).toContainText("Nothing else is repeated");
  const section = page.getByTestId(`recheck-${ids.apollo}`);
  await expect(section.getByTestId("recheck-skipped")).toHaveText("Re-check 1 skipped lead");
  await section.getByTestId("recheck-skipped").click();
  await expect(page.getByTestId("form-message").first()).toBeVisible();
  const { data: queued } = await adminClient().from("jobs").select("id, payload").eq("type", "screen.recheck").eq("campaign_id", ids.apollo);
  expect(queued?.length).toBeGreaterThanOrEqual(1);
  expect(queued![0]!.payload).toMatchObject({ campaignId: ids.apollo });
  // seeded campaigns are named "itest ...": a worker never takes this job, so nothing is checked or paid for
});
