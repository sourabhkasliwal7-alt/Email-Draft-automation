import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { mockQuerySlug, mockRevealLog } from "@outreach/adapters";
import { WORKFLOW_SETTINGS_KEY } from "@outreach/core";
import { startRun } from "@outreach/db";
import type { WorkerCtx } from "../src/ctx";
import { runOneJob } from "../src/jobs/runner";
import { webFindJob, webSkipReason } from "../src/jobs/web-discovery";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the web discovery integration tests are NOT run.");

/**
 * Web discovery (Google) against the real dev database with MOCK adapters only. The mock search answers a query that contains "agency"
 * with ten results: two company sites (one appears twice), a LinkedIn page, a directory, a job board, a news article, a site that
 * does not fit, a site with nobody to write to, and a site that is down.
 */
describe.skipIf(!enabled)("web discovery (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("web-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  let inboxId = "";
  let offerId = "";
  let previousWorkflow: Json | null | undefined;
  /** the mock search names the made-up sites after the query: "<tag> a agency" -> web-<tag>-a-a.example.com */
  const site = (q: string, suffix: "a" | "b") => `web-${mockQuerySlug(`${tag} ${q}`)}-${suffix}.example.com`;

  async function setWorkflow(patch: Record<string, unknown> = {}) {
    const value = { postal_address: `${tag} Street 1, Pune 411001, India`, optout_line: "Reply STOP and I will not write again.", ...patch };
    await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: value as Json }, { onConflict: "key" });
  }
  async function mkCampaign(name: string, icp: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const { data, error } = await db
      .from("campaigns")
      .insert({ name: `${tag} ${name}`, offer_id: offerId, offer_ids: [offerId], inbox_id: inboxId, cta: "Open to a quick call next week?", daily_cap: 4, target_roles: ["Head of Operations"], icp: { requireEmail: false, industries: ["logistics"], countries: [], seniorities: [], ...icp } as Json, ...extra })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id;
  }
  const mkJob = async (key: string, campaignId: string, type = "web.find") => ({
    jobId: (await db.from("jobs").insert({ type, idempotency_key: `${tag}-${key}`, payload: {} as Json, campaign_id: campaignId, status: "completed" }).select("id").single()).data!.id,
    attempts: 1,
  });
  const leadsOf = async (campaignId: string) =>
    (await db.from("campaign_leads").select("id, status, lead_source, source_detail, reason_codes, next_action, score_components, contacts(first_name, company_name, companies(domain))").eq("campaign_id", campaignId)).data ?? [];

  beforeAll(async () => {
    previousWorkflow = (await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle()).data?.value;
    await setWorkflow();
    inboxId = (await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: "Sam", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single()).data!.id;
    const offer = (await db.from("offers").insert({ name: `Audit ${tag}`, allowed_claims: ["Fixed-scope, two-week audit"], cta_options: ["Open to a quick call next week?"] }).select("id").single()).data!;
    offerId = offer.id;
    await db.from("case_studies").insert({ offer_id: offerId, title: `Logistics case ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["logistics"] });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (previousWorkflow === undefined) await db.from("settings").delete().eq("key", WORKFLOW_SETTINGS_KEY);
    else await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: previousWorkflow }, { onConflict: "key" });
    await cleanup(tag);
    await ctx.pool.end();
  }, 120_000);

  it("keeps only company websites, checks each once, finds a person by company website, and keeps the rest in Needs attention", async () => {
    const q1 = `${tag} a agency`;
    const q2 = `${tag} b agency`;
    const camp = await mkCampaign("web", { leadSources: ["web"], leadSource: "web", webQueries: [q1, q2], webMaxQueries: 5, webMaxResults: 10 });
    const reveals = mockRevealLog.length;
    const r = await webFindJob(ctx, { campaignId: camp }, await mkJob("find1", camp));

    expect(r.demo).toBe(true);
    expect(r.queries).toEqual([q1, q2]);
    expect(r.queriesRun).toBe(2);
    expect(r.results).toBe(20);
    // LinkedIn, the directory, the job board and the news article are never company websites (4 of 10 in each query)
    expect(r.skipped.excluded).toBe(8);
    expect(r.skipped.known).toBe(0);
    expect(r.kept).toBe(10); // 5 company sites per query: the repeated site and the "www." twin count once
    expect(r.checked).toBe(10);
    expect(r.skipped.failedCheck).toBe(2); // "nofit-": the quick check says it does not fit
    expect(r.skipped.noData).toBe(2); // "down-": the homepage does not open
    expect(r.contacts).toBe(4);
    expect(r.noContact).toBe(2); // "nocontact-": Apollo knows nobody there
    expect(r.companies.filter((c) => c.outcome === "lead").map((c) => c.domain).sort()).toEqual([site("a agency", "a"), site("a agency", "b"), site("b agency", "a"), site("b agency", "b")] .sort());

    const rows = await leadsOf(camp);
    expect(rows).toHaveLength(6); // 4 people + 2 companies without a contact; failed-check and down sites are not leads
    const people = rows.filter((l) => l.status === "imported");
    expect(people).toHaveLength(4);
    for (const l of people) {
      expect(l.lead_source).toBe("web_discovery");
      expect([q1, q2]).toContain(l.source_detail);
      expect(l.contacts?.first_name).toBeTruthy();
      // the quick check is already done, so the run does not pay for it again
      expect((l.score_components as { screen: { fit: string; mode: string } }).screen).toMatchObject({ fit: "yes", mode: "mock" });
    }
    const parked = rows.filter((l) => l.status === "disqualified");
    expect(parked).toHaveLength(2);
    for (const l of parked) {
      expect(l.reason_codes[0]).toBe("no-contact");
      expect(l.reason_codes[1]).toMatch(/nocontact-.*Apollo found nobody/);
      expect(l.lead_source).toBe("web_discovery");
      expect(l.contacts?.first_name).toBeNull(); // nobody was invented
      expect(l.contacts?.company_name).toBeTruthy();
    }
    // no email is revealed or guessed in discovery
    expect(mockRevealLog.length).toBe(reveals);
    expect((await db.from("contacts").select("email").in("id", (await db.from("campaign_leads").select("contact_id").eq("campaign_id", camp)).data!.map((x) => x.contact_id))).data!.every((c) => c.email === null)).toBe(true);
    // every Google search is recorded as usage (one row per query) at $0 in mock mode
    const usage = (await db.from("usage_records").select("provider, operation, step, is_mock, cost_usd").eq("campaign_id", camp).eq("provider", "serper")).data!;
    expect(usage).toHaveLength(2);
    for (const u of usage) expect(u).toMatchObject({ operation: "web_discovery", step: "webDiscovery", is_mock: true });

    // a second search finds the same sites: all of them are known now (leads, failed checks, down sites), nothing is checked or stored again
    const again = await webFindJob(ctx, { campaignId: camp }, await mkJob("find2", camp));
    expect(again.kept).toBe(0);
    expect(again.checked).toBe(0);
    expect(again.skipped.known).toBe(10);
    expect(again.contacts + again.noContact).toBe(0);
    expect(await leadsOf(camp)).toHaveLength(6);
  }, 180_000);

  it("never uses a suppressed company, and respects the caps on queries and results", async () => {
    const q = `${tag} c agency`;
    const camp = await mkCampaign("webcaps", { leadSources: ["web"], leadSource: "web", webQueries: [q, `${tag} d agency`, `${tag} e agency`], webMaxQueries: 1, webMaxResults: 3 });
    // the first three results are: company A, LinkedIn, company B (www + careers page)
    const suppressed = site("c agency", "a");
    await db.from("suppression").insert({ domain: suppressed, scope: "global", reason: `${tag} do not contact`, source: "itest" });
    const r = await webFindJob(ctx, { campaignId: camp }, await mkJob("caps1", camp));
    expect(r.queries).toEqual([q]); // one query allowed
    expect(r.queriesRun).toBe(1);
    expect(r.results).toBe(3); // three results allowed
    expect(r.skipped.excluded).toBe(1); // LinkedIn
    expect(r.skipped.known).toBe(1); // the suppressed company
    expect(r.contacts).toBe(1);
    const rows = await leadsOf(camp);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contacts?.companies?.domain).not.toBe(suppressed);
    expect((await db.from("companies").select("id").eq("domain", suppressed)).data).toHaveLength(0); // never stored, never checked
    expect((await db.from("usage_records").select("id").eq("campaign_id", camp).eq("provider", "serper")).data).toHaveLength(1);
  }, 120_000);

  it("builds the queries from the target when none are typed, and stops searching once enough people are found", async () => {
    const camp = await mkCampaign("webbuilt", { leadSources: ["web"], leadSource: "web", industries: [`${tag} logistics`], countries: ["India"], keywordsInclude: ["python"], webQueries: [], webMaxQueries: 10, webMaxResults: 10 }, { daily_cap: 1 });
    const r = await webFindJob(ctx, { campaignId: camp }, await mkJob("built1", camp));
    expect(r.queries).toEqual([`${tag} logistics agency India`, `${tag} logistics agency hiring python`, `${tag} logistics agency careers python developer`]);
    // daily number 1 / approval rate asks for a few leads; the first query already has enough company sites, so the others cost nothing
    expect(r.queriesRun).toBeLessThan(r.queries.length);
    expect(r.contacts).toBeGreaterThanOrEqual(1);
    const serper = (await db.from("usage_records").select("id").eq("campaign_id", camp).eq("provider", "serper")).data!;
    expect(serper).toHaveLength(r.queriesRun);
  }, 120_000);

  it("looks again, for free, at companies that had no contact before, and a found person makes the lead a normal one", async () => {
    const camp = await mkCampaign("webrecheck", { leadSources: ["web"], leadSource: "web", webQueries: [`${tag} f agency`], webMaxQueries: 1, webMaxResults: 1 });
    const domain = `web-${tag}-rc.example.com`;
    const company = (await db.from("companies").insert({ domain, name: `Recheck ${tag}`, website: `https://${domain}` }).select("id").single()).data!;
    const contact = (await db.from("contacts").insert({ company_id: company.id, company_name: `Recheck ${tag}` }).select("id").single()).data!;
    const lead = (
      await db
        .from("campaign_leads")
        .insert({ campaign_id: camp, contact_id: contact.id, lead_source: "web_discovery", source_detail: "earlier query", status: "disqualified", reason_codes: ["no-contact", "Apollo found nobody"], next_action: "No contact found", score_components: { screen: { fit: "yes", business_type: "software agency", reason: "x", mode: "mock" } } as Json })
        .select("id")
        .single()
    ).data!;
    const r = await webFindJob(ctx, { campaignId: camp }, await mkJob("recheck1", camp));
    expect(r.revived).toBe(1);
    const after = (await db.from("campaign_leads").select("status, reason_codes, next_action").eq("id", lead.id).single()).data!;
    expect(after).toMatchObject({ status: "imported", reason_codes: [], next_action: null });
    const c = (await db.from("contacts").select("first_name, job_title, email").eq("id", contact.id).single()).data!;
    expect(c.first_name).toBeTruthy();
    expect(c.job_title).toBe("Head of Operations");
    expect(c.email).toBeNull(); // the email is revealed later, only for approved leads
    const apolloId = (await db.from("enrichment_results").select("result").eq("contact_id", contact.id).eq("provider", "apollo")).data!;
    expect(apolloId).toHaveLength(1);
    expect((apolloId[0]!.result as { person_id: string }).person_id).toBe(`apollo-web-0-${domain}`);
  }, 120_000);

  it("is refused for a campaign without web discovery, and never searches with made-up results while anything real is on", async () => {
    const csv = await mkCampaign("webcsv", { leadSources: ["csv"], leadSource: "csv" });
    const none = await webFindJob(ctx, { campaignId: csv }, await mkJob("csv1", csv));
    expect(none).toMatchObject({ queriesRun: 0, contacts: 0 });
    expect(none.note).toMatch(/does not use Web discovery/);

    const live = (over: Record<string, "mock" | "live">): WorkerCtx => ({ ...ctx, modes: { ...ctx.modes, ...over } });
    expect(webSkipReason(ctx)).toBeNull(); // everything demo: allowed (that is how it is tested)
    expect(webSkipReason(live({ search: "live" }))).toBeNull();
    for (const over of [{ llm: "live" }, { fetcher: "live" }, { apollo: "live" }] as Record<string, "live">[]) expect(webSkipReason(live(over))).toMatch(/Google search is in demo mode.*SERPER_API_KEY/);
    expect(webSkipReason(live({ llm: "live", fetcher: "live", apollo: "live", search: "live" }))).toBeNull();

    const web = await mkCampaign("webreal", { leadSources: ["web"], leadSource: "web", webQueries: [`${tag} g agency`] });
    const refused = await webFindJob(live({ llm: "live", fetcher: "live" }), { campaignId: web }, await mkJob("real1", web));
    expect(refused.queriesRun).toBe(0);
    expect(refused.note).toMatch(/demo mode/);
    expect(await leadsOf(web)).toHaveLength(0);
    expect((await db.from("usage_records").select("id").eq("campaign_id", web)).data).toHaveLength(0);
  }, 120_000);

  it("the Preview button's job (web.find) is picked up by the worker queue and stores the result the Leads page shows", async () => {
    const camp = await mkCampaign("webqueue", { leadSources: ["web"], leadSource: "web", webQueries: [`${tag} k agency`], webMaxQueries: 1, webMaxResults: 4 });
    const { data: queued, error } = await db.from("jobs").insert({ type: "web.find", idempotency_key: `${tag}-queue1`, payload: { campaignId: camp } as Json, campaign_id: camp }).select("id").single();
    expect(error).toBeNull();
    while (await runOneJob(ctx, { campaignIds: [camp] })) {
      /* keep draining */
    }
    const job = (await db.from("jobs").select("status, result, last_error").eq("id", queued!.id).single()).data!;
    expect(job.last_error).toBeNull();
    expect(job.status).toBe("completed");
    expect(job.result).toMatchObject({ queries: [`${tag} k agency`], queriesRun: 1, results: 4, demo: true, skipped: { excluded: expect.any(Number), known: 0, failedCheck: 0, noData: 0 } });
    expect((job.result as { companies: { domain: string; query: string; outcome: string }[] }).companies.map((c) => c.outcome)).toEqual(["lead", "lead"]);
  }, 120_000);

  it("a run with Web discovery: searches, checks, finds people, reveals only approved leads, writes Gmail drafts, and counts companies without a contact", async () => {
    const camp = await mkCampaign("webrun", { leadSources: ["web"], leadSource: "web", webQueries: [`${tag} h agency`, `${tag} i agency`], webMaxQueries: 2, webMaxResults: 10 }, { daily_cap: 3 });
    const reveals = mockRevealLog.length;
    const batchId = await startRun(db, camp, { startedBy: null, label: `${tag} run` });
    while (await runOneJob(ctx, { campaignIds: [camp] })) {
      /* keep draining */
    }
    const batch = (await db.from("pipeline_batches").select("*").eq("id", batchId).single()).data!;
    const totals = batch.totals as { leadIds: string[]; log: { step: string; count: number | null; note?: string }[]; summary: { drafts: number; needsAttention: number; skipped: Record<string, number> }; web?: { contacts: number; noContact: number } };
    expect(batch.status).toBe("completed");
    const steps = totals.log.map((l) => l.step);
    expect(steps).toEqual(expect.arrayContaining(["target", "web search", "clean", "quick check", "research and score", "approve", "reveal and verify", "done"]));
    expect(steps).not.toContain("search"); // no Apollo company search: only web discovery was ticked
    expect(totals.log.find((l) => l.step === "web search")!.note).toMatch(/2 search\(es\), 20 results.*checked.*with a person to write to.*no contact found/);

    // the quick check is not paid for twice: it ran once per company during discovery, never again for these leads
    const rows = (await db.from("campaign_leads").select("id, status, lead_source, contact_id").in("id", totals.leadIds)).data!;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.lead_source).toBe("web_discovery");
    expect((await db.from("usage_records").select("id").in("campaign_lead_id", rows.map((r) => r.id)).eq("step", "screen")).data).toHaveLength(0);

    // drafts: for the leads that passed everything, with the revealed (made-up, demo) address; the email flags are the safe set
    const drafted = rows.filter((r) => r.status === "draft_ready");
    expect(drafted.length).toBeGreaterThanOrEqual(1);
    expect(totals.summary.drafts).toBe(drafted.length);
    const emails = (await db.from("contacts").select("email, email_status").in("id", drafted.map((d) => d.contact_id))).data!;
    for (const e of emails) expect(e.email).toMatch(/^[a-z]+\.[a-z]+@web-.*\.example\.com$/);
    for (const call of mockRevealLog.slice(reveals)) expect(call.flags).toEqual({ revealPersonalEmails: false, revealPhoneNumber: false, waterfallEmail: false, waterfallPhone: false, webhookUrl: null });
    expect(mockRevealLog.length - reveals).toBeLessThanOrEqual(3); // only approved leads, never more than today's number

    // companies without a contact are counted as found and as needing attention, and one search is recorded per query
    // today's number (4 people) is reached in the second query, so only the first query's "nocontact-" site was looked at
    expect(totals.summary.skipped["no-contact"]).toBe(1);
    expect(totals.summary.needsAttention).toBeGreaterThanOrEqual(1);
    expect(((await db.from("usage_records").select("id").eq("campaign_id", camp).eq("provider", "serper").eq("step", "webDiscovery")).data ?? []).length).toBe(2);
  }, 400_000);

  it("a mix of CSV and web discovery: the CSV leads come first and web discovery only fills what is missing", async () => {
    const camp = await mkCampaign("webmix", { leadSources: ["csv", "web"], leadSource: "mix", webQueries: [`${tag} j agency`], webMaxQueries: 1 }, { daily_cap: 2 });
    const company = (await db.from("companies").insert({ domain: `csv-${tag}.example.com`, name: `Csv Co ${tag}`, website: `https://csv-${tag}.example.com` }).select("id").single()).data!;
    const contact = (await db.from("contacts").insert({ first_name: "Cy", last_name: `Tester ${tag}`, full_name: `Cy Tester ${tag}`, job_title: "Head of Operations", email: `cy@csv-${tag}.example.com`, company_id: company.id }).select("id").single()).data!;
    await db.from("campaign_leads").insert({ campaign_id: camp, contact_id: contact.id, status: "imported", lead_source: "import:file.csv" });
    const batchId = await startRun(db, camp, { startedBy: null, label: `${tag} mix` });
    while (await runOneJob(ctx, { campaignIds: [camp] })) {
      /* keep draining */
    }
    const batch = (await db.from("pipeline_batches").select("*").eq("id", batchId).single()).data!;
    expect(batch.status).toBe("completed");
    const log = (batch.totals as { log: { step: string; note?: string }[] }).log;
    expect(log.map((l) => l.step)).toContain("web search");
    expect(log.map((l) => l.step)).not.toContain("search");
    const sources = (await db.from("campaign_leads").select("lead_source").eq("campaign_id", camp)).data!.map((l) => l.lead_source);
    expect(sources).toContain("import:file.csv");
    expect(sources).toContain("web_discovery");
  }, 400_000);
});
