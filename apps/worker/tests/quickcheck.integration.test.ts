import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { WORKFLOW_SETTINGS_KEY } from "@outreach/core";
import { startRun } from "@outreach/db";
import type { WorkerCtx } from "../src/ctx";
import { runOneJob } from "../src/jobs/runner";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the quick-check integration tests are NOT run.");

/** The quick check judges against the target AND the offer, lets "uncertain" through, records what the run report needs, and can be re-run for skipped leads only. */
describe.skipIf(!enabled)("quick check, re-check and run report data (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("qc-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  const D = (s: string) => `${s}-${tag}.example.com`;
  let inboxId = "";
  let offerId = "";
  let previousWorkflow: Json | null | undefined;
  const OFFER = `White-label development ${tag}`;

  async function setWorkflow(patch: Record<string, unknown> = {}) {
    const value = { postal_address: `${tag} Street 1, Pune 411001, India`, optout_line: "Reply STOP and I will not write again.", ...patch };
    await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: value as Json }, { onConflict: "key" });
  }
  async function mkCampaign(name: string) {
    const { data } = await db
      .from("campaigns")
      .insert({ name: `${tag} ${name}`, offer_id: offerId, offer_ids: [offerId], inbox_id: inboxId, cta: "Open to a quick call next week?", daily_cap: 6, target_roles: ["COO"], icp: { leadSource: "csv", requireEmail: true, industries: ["software", "saas"] } as Json })
      .select("id")
      .single();
    return data!.id;
  }
  async function mkLead(campaign: string, key: string, o: { status?: string; reason?: string[]; dnc?: boolean; screen?: object } = {}) {
    const company = (await db.from("companies").insert({ domain: D(key), name: `${key} ${tag}`, industry: "software", employee_count: 80, country: "IN" }).select("id").single()).data!;
    const contact = (await db.from("contacts").insert({ first_name: "Pat", last_name: `Tester ${tag}`, full_name: `Pat Tester ${tag}`, job_title: "COO", email: `pat@${D(key)}`, company_id: company.id, country: "IN", dnc: o.dnc ?? false }).select("id").single()).data!;
    const lead = (
      await db
        .from("campaign_leads")
        .insert({ campaign_id: campaign, contact_id: contact.id, status: o.status ?? "imported", lead_source: "itest", reason_codes: o.reason ?? [], score_components: (o.screen ? { screen: o.screen } : {}) as Json })
        .select("id")
        .single()
    ).data!;
    return lead.id;
  }
  const leadRow = async (id: string) => (await db.from("campaign_leads").select("status, reason_codes, score_components, lead_score").eq("id", id).single()).data!;
  async function run(c: WorkerCtx, campaignId: string) {
    const batchId = await startRun(db, campaignId, { startedBy: null, label: `${tag} run` });
    while (await runOneJob(c, { campaignIds: [campaignId] })) {
      /* keep draining */
    }
    return (await db.from("pipeline_batches").select("*").eq("id", batchId).single()).data!;
  }

  beforeAll(async () => {
    previousWorkflow = (await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle()).data?.value;
    await setWorkflow();
    inboxId = (await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: "Sam", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single()).data!.id;
    offerId = (await db.from("offers").insert({ name: OFFER, description: "extra developers for agencies", allowed_claims: ["Fixed-scope audit"], cta_options: ["Open to a quick call next week?"] }).select("id").single()).data!.id;
    await db.from("case_studies").insert({ offer_id: offerId, title: `Case ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["software"] });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (previousWorkflow === undefined) await db.from("settings").delete().eq("key", WORKFLOW_SETTINGS_KEY);
    else await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: previousWorkflow }, { onConflict: "key" });
    await cleanup(tag);
    await ctx.pool.end();
  }, 120_000);

  it("a run: 'uncertain' continues to research, only a clear 'no' is skipped, the check sees the target and the offer, and the run records what the report needs", async () => {
    const camp = await mkCampaign("run");
    const sure = await mkLead(camp, "sure");
    const maybe = await mkLead(camp, "maybe-co");
    const nofit = await mkLead(camp, "nofit-co");
    const prompts: string[] = [];
    const spying: WorkerCtx = { ...ctx, adapters: { ...ctx.adapters, llm: { complete: async (req) => { if (/\[task:screen\]/.test(`${req.system ?? ""}\n${req.prompt}`)) prompts.push(req.prompt); return ctx.adapters.llm.complete(req); } } } };
    const batch = await run(spying, camp);
    expect(batch.status).toBe("completed");

    // the clear "no" is skipped with its reason; "uncertain" is NOT dropped: it was researched and scored like the others
    const no = await leadRow(nofit);
    expect(no).toMatchObject({ status: "disqualified", reason_codes: ["screen-failed", expect.any(String)] });
    expect((no.score_components as { screen: { fit: string; reason: string } }).screen).toMatchObject({ fit: "no", reason: expect.any(String) });
    const unsure = await leadRow(maybe);
    expect((unsure.score_components as { screen: { fit: string } }).screen.fit).toBe("uncertain");
    expect(unsure.reason_codes[0] ?? "").not.toBe("screen-failed");
    expect(unsure.lead_score).not.toBeNull();
    expect((unsure.score_components as { components: { fit: number } }).components.fit).toBeGreaterThan(0); // half the fit points, not zero
    expect((await leadRow(sure)).lead_score).not.toBeNull();

    // the quick check was asked against the industries AND the offer
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    for (const p of prompts) {
      expect(p).toContain("MARKET:software, saas");
      expect(p).toContain(`OFFER: ${OFFER} - extra developers for agencies`);
    }

    // what the run report reads: pages visited, hiring roles and the quote check on every researched lead, plus the cut-off and the skipped ids
    const research = (unsure.score_components as { research: { pages_visited: string[]; hiring_roles: string[]; facts_check: { given: number; kept: number } } }).research;
    expect(research.pages_visited.length).toBeGreaterThan(0);
    expect(research.pages_visited.every((u) => /^https:\/\//.test(u))).toBe(true);
    expect(Array.isArray(research.hiring_roles)).toBe(true);
    expect(research.facts_check.given).toBeGreaterThanOrEqual(research.facts_check.kept);
    const totals = batch.totals as { leadIds: string[]; approveCutoff: number; reportExtraIds: string[] };
    expect(totals.approveCutoff).toBeGreaterThan(0);
    expect(totals.leadIds).toEqual(expect.arrayContaining([sure, maybe, nofit]));
    expect(Array.isArray(totals.reportExtraIds)).toBe(true);
  }, 400_000);

  it("Re-check skipped leads: only leads skipped as screen-failed or no-data get a new quick check; nothing else is repeated or paid for", async () => {
    const camp = await mkCampaign("recheck");
    const skipped = (key: string, reason: string, fit = "no") => mkLead(camp, key, { status: "disqualified", reason: [reason, "earlier detail"], screen: { fit, business_type: "x", reason: "earlier answer", mode: "mock" } });
    const stillNo = await skipped("nofit-again", "screen-failed"); // a mock "no" stays a "no"
    const nowFits = await skipped("fits-now", "screen-failed"); // wrongly skipped earlier
    const unreadable = await skipped("down-site", "no-data"); // the website still does not open
    const lowScore = await mkLead(camp, "lowscore", { status: "disqualified", reason: ["below-threshold", "score 30"] }); // not a quick-check skip
    const dnc = await skipped("dnc-co", "screen-failed");
    await db.from("contacts").update({ dnc: true }).eq("id", (await db.from("campaign_leads").select("contact_id").eq("id", dnc).single()).data!.contact_id);
    const reveals = (await db.from("credit_ledger").select("id", { count: "exact", head: true })).count;

    const { data: job } = await db.from("jobs").insert({ type: "screen.recheck", idempotency_key: `${tag}-recheck`, payload: { campaignId: camp } as Json, campaign_id: camp }).select("id").single();
    while (await runOneJob(ctx, { campaignIds: [camp] })) {
      /* keep draining */
    }
    const done = (await db.from("jobs").select("status, result, last_error").eq("id", job!.id).single()).data!;
    expect(done.last_error).toBeNull();
    expect(done.status).toBe("completed");
    expect(done.result).toMatchObject({ total: 3, passed: 1, stillNo: 1, stillUnreadable: 1, suppressed: 1, failed: 0 });

    expect(await leadRow(nowFits)).toMatchObject({ status: "researching", reason_codes: [] }); // waits for the next Start run
    expect((await leadRow(nowFits)).score_components).toMatchObject({ screen: { fit: "yes", mode: "mock" } });
    expect(await leadRow(stillNo)).toMatchObject({ status: "disqualified", reason_codes: ["screen-failed", expect.any(String)] });
    expect(await leadRow(unreadable)).toMatchObject({ status: "disqualified", reason_codes: ["no-data", expect.stringContaining("homepage")] });
    // the others are untouched
    expect(await leadRow(lowScore)).toMatchObject({ status: "disqualified", reason_codes: ["below-threshold", "score 30"] });
    expect(await leadRow(dnc)).toMatchObject({ status: "disqualified", reason_codes: ["screen-failed", "earlier detail"] });

    // only the quick check was paid for, and only for the three leads that were checked (the unreadable site never reached the model)
    const usage = (await db.from("usage_records").select("campaign_lead_id, step, provider").eq("campaign_id", camp)).data!;
    expect(new Set(usage.map((u) => u.step))).toEqual(new Set(["screen"]));
    expect(new Set(usage.map((u) => u.campaign_lead_id))).toEqual(new Set([stillNo, nowFits]));
    expect((await db.from("credit_ledger").select("id", { count: "exact", head: true })).count).toBe(reveals);

    // run again: the lead that passed is researched now, the ones that still fail are not asked again by the run itself
    const batch = await run(ctx, camp);
    expect(batch.status).toBe("completed");
    expect((await leadRow(nowFits)).lead_score).not.toBeNull();
    expect(await leadRow(stillNo)).toMatchObject({ status: "disqualified" });
  }, 400_000);
});
