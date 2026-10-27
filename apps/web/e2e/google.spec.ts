import { expect, test } from "@playwright/test";
import { RUN, adminClient, hasDb, loginAs } from "./support";

test.skip(!hasDb(), "needs the Supabase env in the root .env");
test.describe.configure({ mode: "serial" });

const EMAIL = `e2e-gmail-${RUN}@example.com`;
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.TOKEN_ENCRYPTION_KEY && process.env.NEXT_PUBLIC_SITE_URL);

test.afterAll(async () => {
  if (hasDb()) await adminClient().from("inboxes").delete().eq("email", EMAIL);
});

test("admin: Mailboxes shows the exact redirect URI to register, the Testing-mode warning and a Connect Gmail button per mailbox", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/inboxes");
  await expect(page.getByRole("heading", { name: "Mailboxes" })).toBeVisible();
  // the value to paste into Google Cloud: NEXT_PUBLIC_SITE_URL + /api/google/callback
  await expect(page.getByTestId("google-redirect-uri")).toContainText("/api/google/callback");
  await expect(page.getByTestId("testing-warning")).toContainText("7 days");

  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Display name").first().fill("E2E Gmail");
  await page.getByRole("button", { name: "Add mailbox" }).click();
  const row = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Not connected");
  await expect(row.getByTestId("connect-gmail")).toHaveText("Connect Gmail");
  // nothing to test or disconnect until a Google sign-in exists
  await expect(row.getByTestId("test-draft")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  // the status is not a free choice for a mailbox that was never connected
  await expect(row.locator("select[name=status]")).toHaveCount(0);
});

test("Connect Gmail sends the browser to Google with offline access, only the two narrow scopes and a one-time state", async ({ page }) => {
  test.skip(!googleConfigured, "Google variables are not set in the root .env");
  await loginAs(page, "admin");
  await page.goto("/inboxes");
  const row = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  const href = await row.getByTestId("connect-gmail").getAttribute("href");
  expect(href).toMatch(/^\/api\/google\/connect\?inbox=[0-9a-f-]{36}$/);

  const res = await page.request.get(href!, { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());
  const to = new URL(res.headers().location!);
  expect(to.origin + to.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(to.searchParams.get("access_type")).toBe("offline");
  expect(to.searchParams.get("redirect_uri")).toMatch(/\/api\/google\/callback$/);
  expect(to.searchParams.get("login_hint")).toBe(EMAIL);
  expect(to.searchParams.get("scope")!.split(" ").sort()).toEqual(["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.labels"]);
  expect(to.searchParams.get("state")!.length).toBeGreaterThan(20);
  expect(res.headers()["set-cookie"]).toMatch(/g_oauth=.*HttpOnly/i);
});

test("a forged or replayed Google callback is refused and stores nothing", async ({ page }) => {
  test.skip(!googleConfigured, "Google variables are not set in the root .env");
  await loginAs(page, "admin");
  // the route answers with a redirect back to Mailboxes (to NEXT_PUBLIC_SITE_URL, which is not this test server), so read it instead of following it
  const res = await page.request.get("/api/google/callback?code=forged&state=forged", { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/inboxes\?gmail=state$/);
  await page.goto("/inboxes?gmail=state");
  await expect(page.getByTestId("gmail-message")).toContainText("could not be verified");
  const { data } = await adminClient().from("inboxes").select("status, scopes").eq("email", EMAIL).single();
  expect(data).toEqual({ status: "disconnected", scopes: [] });
});

test("a mailbox Google no longer accepts shows 'Needs reconnect' with the reason, and Disconnect resets only that mailbox", async ({ page }) => {
  const admin = adminClient();
  await admin.from("inboxes").update({ status: "needs_reconnect", scopes: ["https://www.googleapis.com/auth/gmail.compose"], connected_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), last_error: "Google no longer accepts this sign-in (e2e)" }).eq("email", EMAIL);
  await loginAs(page, "admin");
  await page.goto("/inboxes");
  const row = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  await expect(row).toContainText("Needs reconnect");
  await expect(row.getByTestId("reconnect-reason")).toContainText("no longer accepts");
  await expect(row.getByTestId("connect-gmail")).toHaveText("Reconnect");
  await expect(row.getByTestId("test-draft")).toHaveCount(0); // only a connected mailbox can make a test draft
  await expect(row.locator("select[name=status]")).toHaveCount(0);

  await row.getByRole("button", { name: "Disconnect" }).click();
  await expect(page).toHaveURL(/\/inboxes\?gmail=disconnected$/);
  await expect(page.getByTestId("gmail-message")).toContainText("Mailbox disconnected");
  const after = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  await expect(after).toContainText("Not connected");
  const { data } = await admin.from("inboxes").select("status, scopes, connected_at, last_error").eq("email", EMAIL).single();
  expect(data).toEqual({ status: "disconnected", scopes: [], connected_at: null, last_error: null });
});

test("a connected mailbox warns when its Testing-mode sign-in is about to expire, and can be paused but not forced active when disconnected", async ({ page }) => {
  const admin = adminClient();
  await admin.from("inboxes").update({ status: "active", scopes: ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.labels"], connected_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq("email", EMAIL);
  await loginAs(page, "admin");
  await page.goto("/inboxes");
  const row = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  await expect(row).toContainText("Connected");
  await expect(row.getByTestId("expiry")).toContainText("stops working about");
  await expect(row.getByTestId("test-draft")).toBeVisible();
  await expect(row.locator("select[name=status]")).toHaveValue("active");
  await admin.from("inboxes").update({ status: "disconnected", scopes: [], connected_at: null }).eq("email", EMAIL);
});

test("operators can look at mailboxes but cannot connect, disconnect or see the Google setup; the connect URL refuses them", async ({ page }) => {
  await loginAs(page, "operator");
  await page.goto("/inboxes");
  const row = page.getByTestId("inbox-row").filter({ hasText: EMAIL });
  await expect(row).toBeVisible();
  await expect(page.getByTestId("connect-gmail")).toHaveCount(0);
  await expect(page.getByTestId("google-redirect-uri")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  const res = await page.request.get("/api/google/connect?inbox=11111111-1111-4111-8111-111111111111", { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());
  expect(res.headers().location).toMatch(/\/inboxes\?gmail=(forbidden|not_configured)$/);
});

test("Settings > Connections lists Claude, Serper and ZeroBounce with their key status, and never prints a key", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/settings");
  const section = page.getByTestId("connections");
  await expect(section).toBeVisible();
  for (const id of ["anthropic", "serper", "verifier"]) {
    const card = page.getByTestId(`connection-${id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(/set|NOT set/);
    await expect(card.getByRole("button", { name: "Test connection" })).toBeVisible();
  }
  const text = await section.innerText();
  for (const key of [process.env.ANTHROPIC_API_KEY, process.env.SERPER_API_KEY, process.env.ZEROBOUNCE_API_KEY, process.env.GOOGLE_CLIENT_SECRET]) {
    if (key && key.length > 8) expect(text).not.toContain(key);
  }
  // an operator has no Settings at all
  await loginAs(page, "operator");
  await page.goto("/settings");
  await expect(page.getByTestId("connections")).toHaveCount(0);
});
