import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { MissingPriceError, pipelineJobKey } from "@outreach/core";
import { CapReachedError, makeSpender } from "../src/spend";
import { runOneJob } from "../src/jobs/runner";
import { sendJob } from "../src/jobs/send";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the core-flow integration tests are NOT run.");

/**
 * The core flow against the real dev database with MOCK adapters only:
 * Start workflow -> (Apollo pull | CSV leads) -> DNC/suppression -> research -> score -> email reveal -> draft + fact check
 * -> review -> Gmail draft -> send approval -> send, plus the safety rules around sending.
 */
describe.skipIf(!enabled)("core flow (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("flow-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  const D = (s: string) => `${s}-${tag}.example.com`;
  let campaignId = "";
  let apolloCampaignId = "";
  let inboxId = "";
  let userId = "";
  let n = 0;
  let previousFlags: Json | null | undefined;
  const leads: Record<string, { leadId: string; contactId: string }> = {};

  const sender = () => (ctx.adapters as unknown as { gmailSender: { sent: unknown[] } }).gmailSender;
  const gmail = () => (ctx.adapters as unknown as { gmail: { drafts: Map<string, unknown> } }).gmail;

  async function mkLead(key: string, o: { email?: string | null; first: string; title?: string; dnc?: boolean; campaign?: string }) {
    const { data: company } = await db
      .from("companies")
      .insert({ domain: D(key), name: `${key} ${tag}`, industry: "logistics", employee_count: 80, country: "IN" })
      .select("id")
      .single();
    const { data: contact } = await db
      .from("contacts")
      .insert({ first_name: o.first, last_name: `Tester ${tag}`, full_name: `${o.first} Tester ${tag}`, job_title: o.title ?? "COO", email: o.email === undefined ? `${o.first.toLowerCase()}@${D(key)}` : o.email, company_id: company!.id, country: "IN", dnc: o.dnc ?? false })
      .select("id")
      .single();
    const { data: lead } = await db.from("campaign_leads").insert({ campaign_id: o.campaign ?? campaignId, contact_id: contact!.id, status: "imported", lead_source: "itest" }).select("id").single();
    leads[key] = { leadId: lead!.id, contactId: contact!.id };
    return leads[key]!;
  }

  async function startWorkflow(campaign: string) {
    const { data: batch } = await db.from("pipeline_batches").insert({ campaign_id: campaign, label: `${tag} run` }).select("id").single();
    await db.from("jobs").insert({ type: "workflow.start", idempotency_key: `${tag}-wf-${++n}`, payload: { batchId: batch!.id } as Json, campaign_id: campaign, batch_id: batch!.id });
    return batch!.id;
  }
  async function drain(campaigns: string[]) {
    let ran = 0;
    while (await runOneJob(ctx, { campaignIds: campaigns })) ran++;
    // surface why anything did not finish (the assertions below then make sense)
    const stuck = (await db.from("jobs").select("type, status, attempts, last_error").in("campaign_id", campaigns).in("status", ["failed", "pending"])).data ?? [];
    for (const j of stuck) console.warn(`[flow] ${j.type} ${j.status} (attempt ${j.attempts}): ${j.last_error}`);
    return ran;
  }
  const latestDraft = async (leadId: string) => (await db.from("email_drafts").select("*").eq("campaign_lead_id", leadId).order("version", { ascending: false }).limit(1).single()).data!;
  const lead = async (id: string) => (await db.from("campaign_leads").select("*").eq("id", id).single()).data!;

  /** What the Review screen does for a reviewer. */
  async function approveForGmail(draftId: string) {
    const { data } = await db.from("email_drafts").update({ status: "approved" }).eq("id", draftId).eq("status", "needs_review").select("id");
    if (data?.length) await db.from("jobs").insert({ type: "gmail.draft", idempotency_key: `${tag}-gd-${draftId}`, payload: { draftId } as Json, campaign_id: campaignId });
  }
  /** What the Sending screen does for a sender/admin: record the approval of this exact text. */
  async function approveSend(draftId: string) {
    const d = (await db.from("email_drafts").select("body_hash").eq("id", draftId).single()).data!;
    const { error } = await db.from("send_approvals").insert({ draft_id: draftId, approved_by: userId, body_hash: d.body_hash });
    expect(error).toBeNull();
  }
  const send = (draftId: string) => sendJob(ctx, { draftId }, { jobId: "itest", attempts: 1 });
  const sends = async (draftId: string) => (await db.from("email_sends").select("status").eq("draft_id", draftId)).data ?? [];

  beforeAll(async () => {
    const { data: u, error } = await db.auth.admin.createUser({ email: `${tag}@example.com`, password: `${tag}-Aa1!x${tag}`, email_confirm: true });
    expect(error).toBeNull();
    userId = u!.user!.id;
    previousFlags = (await db.from("settings").select("value").eq("key", "flags").maybeSingle()).data?.value;
    await db.from("settings").upsert({ key: "flags", value: { ...(previousFlags as object), SENDING_ENABLED: true } as Json }, { onConflict: "key" });

    const { data: inbox } = await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: `Sam ${tag}`, status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single();
    inboxId = inbox!.id;
    const { data: offer } = await db.from("offers").insert({ name: `Audit ${tag}`, allowed_claims: ["Fixed-scope, two-week audit"], cta_options: ["Open to a quick call next week?"] }).select("id").single();
    await db.from("case_studies").insert({ offer_id: offer!.id, title: `Logistics case ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["logistics"] });
    const base = { score_draft_min: 40, score_review_min: 20, offer_id: offer!.id, inbox_id: inboxId, cta: "Open to a quick call next week?" };
    campaignId = (await db.from("campaigns").insert({ name: `${tag} csv`, ...base, icp: { leadSource: "csv", requireEmail: true } as Json }).select("id").single()).data!.id;
    apolloCampaignId = (
      await db.from("campaigns").insert({ name: `${tag} apollo`, ...base, target_roles: ["COO"], icp: { leadSource: "apollo", maxLeadsPerRun: 6, requireEmail: false, countries: [], industries: [] } as Json }).select("id").single()
    ).data!.id;
    await db.from("suppression").insert({ email_lower: `blocked@${D("sup")}`, scope: "global", reason: `${tag} opted out`, source: "itest" });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    if (previousFlags === undefined) await db.from("settings").delete().eq("key", "flags");
    else await db.from("settings").upsert({ key: "flags", value: previousFlags }, { onConflict: "key" });
    await cleanup(tag);
    if (userId) await db.auth.admin.deleteUser(userId);
    await ctx.pool.end();
  }, 120_000);

  it("Start workflow on CSV-imported leads: research, score, draft, fact check, hand to a human; bad leads stop with a reason", async () => {
    await mkLead("ok", { first: "Asha" });
    await mkLead("sup", { first: "Blocked", email: `blocked@${D("sup")}` });
    await mkLead("dnc", { first: "Dina", dnc: true });
    await mkLead("bad", { first: "Bob", email: `invalid.bob@${D("bad")}` }); // mock verifier marks "invalid" local parts as invalid
    const batchId = await startWorkflow(campaignId);
    await drain([campaignId]);

    const ok = await lead(leads.ok!.leadId);
    expect(ok.status).toBe("needs_review");
    expect(ok.lead_score).toBeGreaterThanOrEqual(40);
    expect(ok.score_components).toMatchObject({ icp_fit: expect.any(Number), trigger: expect.any(Number) });
    expect(ok.trigger).toBeTruthy();
    expect(ok.trigger_source).toMatch(/^https:\/\//);

    // evidence = URL + retrieval date; every draft claim points at stored evidence
    const ev = (await db.from("evidence_items").select("id, url, snippet, retrieved_at").eq("company_id", (await db.from("contacts").select("company_id").eq("id", leads.ok!.contactId).single()).data!.company_id!)).data!;
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.retrieved_at).toBeTruthy();
    }
    const draft = await latestDraft(leads.ok!.leadId);
    expect(draft).toMatchObject({ status: "needs_review", version: 1, step: 0 });
    expect(draft.body_text).toContain("Hi Asha,");
    expect(draft.warnings).toEqual([]);
    expect(draft.quality_score).toBe(100);
    expect(draft.body_hash).toHaveLength(64);
    for (const id of draft.facts as string[]) expect(ev.some((e) => e.id === id)).toBe(true);
    expect((draft.claim_check as { llm: { pass: boolean } }).llm.pass).toBe(true);

    // gates
    expect(await lead(leads.sup!.leadId)).toMatchObject({ status: "disqualified", reason_codes: expect.arrayContaining(["suppressed"]) });
    expect(await lead(leads.dnc!.leadId)).toMatchObject({ status: "disqualified", reason_codes: expect.arrayContaining(["dnc"]) });
    expect(await lead(leads.bad!.leadId)).toMatchObject({ status: "disqualified", reason_codes: expect.arrayContaining(["invalid_email"]) });
    expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", leads.sup!.leadId)).data).toHaveLength(0);
    expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", leads.dnc!.leadId)).data).toHaveLength(0);
    // the verifier result stored for the bad address also suppresses it for good
    expect((await db.from("suppression").select("id").eq("email_lower", `invalid.bob@${D("bad")}`)).data).toHaveLength(1);

    // usage is recorded (mock = $0) and the batch is closed with counters
    expect((await db.from("usage_records").select("is_mock, provider").eq("campaign_id", campaignId)).data!.every((u) => u.is_mock)).toBe(true);
    const batch = (await db.from("pipeline_batches").select("status, totals").eq("id", batchId).single()).data!;
    expect(batch.status).toBe("completed");
    expect((batch.totals as { leads: Record<string, number> }).leads).toMatchObject({ needs_review: 1, disqualified: 3 });
  }, 280_000);

  it("is idempotent: enqueueing the same lead twice or re-running finished steps changes nothing", async () => {
    const draftsBefore = (await db.from("email_drafts").select("id").eq("campaign_lead_id", leads.ok!.leadId)).data!.length;
    const evBefore = (await db.from("evidence_items").select("id", { count: "exact", head: true })).count;
    const job = (await db.from("jobs").select("id, batch_id, idempotency_key, payload").eq("campaign_lead_id", leads.ok!.leadId).eq("type", "lead.pipeline").single()).data!;
    // same unique key -> rejected
    const dup = await db.from("jobs").insert({ type: "lead.pipeline", idempotency_key: pipelineJobKey(job.batch_id!, leads.ok!.leadId), payload: job.payload, campaign_id: campaignId });
    expect(dup.error?.code).toBe("23505");
    // force a rerun of the same job: every completed step is skipped
    await db.from("jobs").update({ status: "pending", attempts: 0 }).eq("id", job.id);
    await drain([campaignId]);
    expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", leads.ok!.leadId)).data).toHaveLength(draftsBefore);
    expect((await db.from("evidence_items").select("id", { count: "exact", head: true })).count).toBe(evBefore);
    expect((await db.from("jobs").select("status").eq("id", job.id).single()).data!.status).toBe("completed");
  }, 120_000);

  it("review -> Gmail draft: approving twice creates exactly one Gmail draft", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    await approveForGmail(draft.id);
    await approveForGmail(draft.id); // second click: the status is no longer needs_review
    await db.from("jobs").insert({ type: "gmail.draft", idempotency_key: `${tag}-gd-again`, payload: { draftId: draft.id } as Json, campaign_id: campaignId }); // a racing duplicate job
    const before = gmail().drafts.size;
    await drain([campaignId]);
    expect(gmail().drafts.size - before).toBe(1);
    const after = await latestDraft(leads.ok!.leadId);
    expect(after.gmail_draft_id).toMatch(/^mock-draft-/);
    expect(after.status).toBe("approved");
    expect((await lead(leads.ok!.leadId)).status).toBe("approved");
  }, 120_000);

  it("SAFETY: nothing is sent without a recorded approval", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    const r = await send(draft.id);
    expect(r).toMatchObject({ blocked: expect.stringContaining("no recorded send approval") });
    expect(await sends(draft.id)).toHaveLength(0);
    expect(sender().sent).toHaveLength(0);
    // the database itself refuses too (service role, no approval row)
    const direct = await db.from("email_sends").insert({ draft_id: draft.id, send_key: `${tag}-direct`, inbox_id: inboxId, recipient_email: `asha@${D("ok")}`, subject: "s", body_text: "b", campaign_id: campaignId });
    expect(direct.error?.message).toMatch(/no recorded approval/);
  }, 60_000);

  it("SAFETY: a changed draft, a switched-off flag, an inactive inbox and a DNC contact all block the send", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    await approveSend(draft.id);

    // approved text must stay as approved (database refuses edits after approval)
    const edit = await db.from("email_drafts").update({ body_text: "tampered" }).eq("id", draft.id);
    expect(edit.error?.message).toMatch(/immutable/);

    // flag off
    await db.from("settings").upsert({ key: "flags", value: { ...(previousFlags as object), SENDING_ENABLED: false } as Json }, { onConflict: "key" });
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("SENDING_ENABLED") });
    await db.from("settings").upsert({ key: "flags", value: { ...(previousFlags as object), SENDING_ENABLED: true } as Json }, { onConflict: "key" });

    // inbox not active
    await db.from("inboxes").update({ status: "paused" }).eq("id", inboxId);
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("inbox is not active") });
    await db.from("inboxes").update({ status: "active" }).eq("id", inboxId);

    // do-not-contact added AFTER approval
    await db.from("contacts").update({ dnc: true }).eq("id", leads.ok!.contactId);
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("dnc") });
    await db.from("contacts").update({ dnc: false }).eq("id", leads.ok!.contactId);

    // suppressed after approval
    await db.from("suppression").insert({ email_lower: `asha@${D("ok")}`, scope: "global", reason: `${tag} late opt-out`, source: "itest" });
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("suppressed") });
    await db.from("suppression").delete().eq("reason", `${tag} late opt-out`);

    expect(await sends(draft.id)).toHaveLength(0);
    expect(sender().sent).toHaveLength(0);
  }, 120_000);

  it("approved send goes out exactly once, even when triggered twice at the same time", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    const results = await Promise.all([send(draft.id), send(draft.id)]);
    expect(results.filter((r) => "sent" in r)).toHaveLength(1);
    expect(sender().sent).toHaveLength(1);
    expect(await sends(draft.id)).toEqual([{ status: "sent" }]);
    expect(await send(draft.id)).toMatchObject({ skipped: expect.any(String) }); // a later click does nothing
    expect(sender().sent).toHaveLength(1);
    expect(await lead(leads.ok!.leadId)).toMatchObject({ status: "sent", last_contact_date: expect.any(String) });
    expect((await latestDraft(leads.ok!.leadId)).status).toBe("sent");
    const events = (await db.from("lead_events").select("type").eq("campaign_lead_id", leads.ok!.leadId)).data!.map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["scored", "researched", "draft_ready", "gmail_draft_created", "send_blocked", "sent"]));
  }, 120_000);

  it("a send whose Gmail call fails ends as 'unknown' and is never resent", async () => {
    await mkLead("unk", { first: "Uma" });
    await db.from("campaign_leads").update({ status: "needs_review" }).eq("id", leads.unk!.leadId);
    const { data: d } = await db
      .from("email_drafts")
      .insert({ campaign_lead_id: leads.unk!.leadId, subject: "s", body_text: "b", body_hash: "h-unk", status: "approved", inbox_id: inboxId, gmail_draft_id: `${tag}-gd`, idempotency_key: `${tag}-unk` })
      .select("id")
      .single();
    await db.from("send_approvals").insert({ draft_id: d!.id, approved_by: userId, body_hash: "h-unk" });
    const original = ctx.adapters.gmailSender.sendDraft;
    ctx.adapters.gmailSender.sendDraft = async () => {
      throw new Error("socket hang up");
    };
    try {
      expect(await send(d!.id)).toMatchObject({ unknown: "socket hang up" });
      expect(await sends(d!.id)).toEqual([{ status: "unknown" }]);
      expect(await send(d!.id)).toMatchObject({ skipped: expect.stringContaining("unknown") }); // not resent
    } finally {
      ctx.adapters.gmailSender.sendDraft = original;
    }
  }, 60_000);

  it("Start workflow with Apollo as the lead source: pulls people, dedupes, reveals emails only after qualification", async () => {
    const batchId = await startWorkflow(apolloCampaignId);
    await drain([apolloCampaignId]);
    const batch = (await db.from("pipeline_batches").select("status, totals").eq("id", batchId).single()).data!;
    const pull = (batch.totals as { pull: { source: string; found: number; new: number; duplicates: number } }).pull;
    expect(pull).toMatchObject({ source: "apollo", found: 6, new: 6, duplicates: 0 });
    expect(batch.status).toBe("completed");

    const leadRows = (await db.from("campaign_leads").select("id, status, contacts(email, email_status, profile_url)").eq("campaign_id", apolloCampaignId)).data!;
    expect(leadRows).toHaveLength(6);
    // search returned no emails; revealed ones belong to leads that passed qualification and scoring
    const withEmail = leadRows.filter((l) => l.contacts?.email);
    expect(withEmail.length).toBeGreaterThan(0);
    for (const l of withEmail) expect(["needs_review", "disqualified"]).toContain(l.status);
    expect(leadRows.some((l) => l.status === "needs_review")).toBe(true);
    // credits were recorded for the reveal calls
    expect((await db.from("usage_records").select("operation").eq("campaign_id", apolloCampaignId).eq("provider", "apollo")).data!.some((u) => u.operation === "reveal_email")).toBe(true);

    // Start again: the same people are duplicates, no new leads, nothing re-pulled into the campaign twice
    await startWorkflow(apolloCampaignId);
    await drain([apolloCampaignId]);
    expect((await db.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", apolloCampaignId)).count).toBe(6);
  }, 290_000);

  it("SAFETY: live paid calls need a price row and respect spend caps; nothing is spent otherwise", async () => {
    const liveCtx = { ...ctx, modes: { ...ctx.modes, search: "live" as const } };
    let searched = 0;
    liveCtx.adapters = { ...ctx.adapters, search: { search: async () => { searched++; return { results: [], usage: { units: { search: 1 } } }; } } };
    const spend = makeSpender(liveCtx, { campaignId, leadId: null, jobId: "00000000-0000-4000-8000-0000000000aa", step: "itest" });

    // no price for the provider -> refused before the call (only checkable while the owner has not entered serper prices)
    const realPrices = (await db.from("price_table").select("id").eq("provider", "serper")).data ?? [];
    if (!realPrices.length) {
      await expect(spend("search", "search", () => liveCtx.adapters.search.search({ query: "x" }))).rejects.toBeInstanceOf(MissingPriceError);
      expect(searched).toBe(0);
    }

    // price exists but the campaign cap is below the reservation -> refused, nothing recorded
    await db.from("price_table").insert({ provider: "serper", unit: `search ${tag}`, usd_per_unit: 0.001 });
    await db.from("spend_caps").insert({ scope: "campaign", campaign_id: campaignId, period: "daily", cap_usd: 0.0001 });
    const spendWithPrice = makeSpender(liveCtx, { campaignId, leadId: null, jobId: "00000000-0000-4000-8000-0000000000ab", step: "itest" }); // prices are cached per spender
    await expect(spendWithPrice("search", "search", () => liveCtx.adapters.search.search({ query: "x" }))).rejects.toBeInstanceOf(CapReachedError);
    expect(searched).toBe(0);
    await db.from("spend_caps").delete().eq("campaign_id", campaignId);
    await db.from("price_table").delete().like("unit", `%${tag}%`);
  }, 60_000);
});
