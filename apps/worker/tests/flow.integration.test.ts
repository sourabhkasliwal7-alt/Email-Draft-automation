import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@outreach/db";
import { mockRevealLog } from "@outreach/adapters";
import { REVEAL_FLAGS, WORKFLOW_SETTINGS_KEY, normText, parseWorkflowConfig } from "@outreach/core";
import { MissingPriceError } from "@outreach/core";
import { CapReachedError, makeSpender } from "../src/spend";
import { runOneJob } from "../src/jobs/runner";
import { startRun } from "@outreach/db";
import { sendJob } from "../src/jobs/send";
import { loadLead } from "../src/pipeline/common";
import { creditsUsed, revealWithGuard } from "../src/pipeline/reveal";
import { cleanup, hasIntegrationDb, makeCtx, newTag } from "./helpers/itest";

const enabled = hasIntegrationDb();
if (!enabled) console.warn("[worker tests] DATABASE_URL / Supabase keys missing: the core-flow integration tests are NOT run.");

/**
 * The SRS core flow against the real dev database with MOCK adapters only:
 * Start -> Apollo search -> clean -> quick check -> research + exact-quote facts -> score -> approve top-N -> credit-guarded
 * reveal -> verify -> write + check -> Gmail draft (label, note). Plus the safety rules around revealing and sending.
 */
describe.skipIf(!enabled)("core flow (mock adapters, real database)", () => {
  const tag = newTag();
  const ctx = makeCtx("flow-worker", (m) => console.warn(`[worker] ${m}`));
  const { db } = ctx;
  const D = (s: string) => `${s}-${tag}.example.com`;
  let csvCampaignId = "";
  let apolloCampaignId = "";
  let dryCampaignId = "";
  let inboxId = "";
  let userId = "";
  let previousFlags: Json | null | undefined;
  let previousWorkflow: Json | null | undefined;
  const leads: Record<string, { leadId: string; contactId: string; companyId: string }> = {};

  const sender = () => (ctx.adapters as unknown as { gmailSender: { sent: unknown[] } }).gmailSender;
  const gmail = () => (ctx.adapters as unknown as { gmail: { drafts: Map<string, { to: string; subject: string; bodyText: string; label?: string }> } }).gmail;

  async function setWorkflow(patch: Record<string, unknown>) {
    const value = { postal_address: `${tag} Street 1, Pune 411001, India`, optout_line: "Reply STOP and I will not write again.", ...patch };
    await db.from("settings").upsert({ key: WORKFLOW_SETTINGS_KEY, value: value as Json }, { onConflict: "key" });
  }

  async function mkLead(key: string, o: { email?: string | null; first: string; title?: string; dnc?: boolean; company?: string; campaign?: string }) {
    const { data: company } = await db
      .from("companies")
      .insert({ domain: D(key), name: o.company ?? `${key} ${tag}`, industry: "logistics", employee_count: 80, country: "IN" })
      .select("id")
      .single();
    const { data: contact } = await db
      .from("contacts")
      .insert({ first_name: o.first, last_name: `Tester ${tag}`, full_name: `${o.first} Tester ${tag}`, job_title: o.title ?? "COO", email: o.email === undefined ? `${o.first.toLowerCase()}@${D(key)}` : o.email, company_id: company!.id, country: "IN", dnc: o.dnc ?? false })
      .select("id")
      .single();
    const { data: lead } = await db.from("campaign_leads").insert({ campaign_id: o.campaign ?? csvCampaignId, contact_id: contact!.id, status: "imported", lead_source: "itest" }).select("id").single();
    leads[key] = { leadId: lead!.id, contactId: contact!.id, companyId: company!.id };
    return leads[key]!;
  }

  async function drain(campaigns: string[]) {
    while (await runOneJob(ctx, { campaignIds: campaigns })) {
      /* keep draining */
    }
    const stuck = (await db.from("jobs").select("type, status, attempts, last_error").in("campaign_id", campaigns).in("status", ["failed", "pending"])).data ?? [];
    for (const j of stuck) console.warn(`[flow] ${j.type} ${j.status} (attempt ${j.attempts}): ${j.last_error}`);
  }
  async function run(campaignId: string, dryRun = false) {
    const batchId = await startRun(db, campaignId, { startedBy: null, dryRun, label: `${tag} run` });
    await drain([campaignId]);
    return (await db.from("pipeline_batches").select("*").eq("id", batchId).single()).data!;
  }
  const latestDraft = async (leadId: string) => (await db.from("email_drafts").select("*").eq("campaign_lead_id", leadId).order("version", { ascending: false }).limit(1).single()).data!;
  const lead = async (id: string) => (await db.from("campaign_leads").select("*").eq("id", id).single()).data!;
  const approveSend = async (draftId: string) => {
    const d = (await db.from("email_drafts").select("body_hash").eq("id", draftId).single()).data!;
    const { error } = await db.from("send_approvals").insert({ draft_id: draftId, approved_by: userId, body_hash: d.body_hash });
    expect(error).toBeNull();
  };
  const send = (draftId: string) => sendJob(ctx, { draftId }, { jobId: "itest", attempts: 1 });
  const sends = async (draftId: string) => (await db.from("email_sends").select("status").eq("draft_id", draftId)).data ?? [];

  beforeAll(async () => {
    const { data: u, error } = await db.auth.admin.createUser({ email: `${tag}@example.com`, password: `${tag}-Aa1!x${tag}`, email_confirm: true });
    expect(error).toBeNull();
    userId = u!.user!.id;
    previousFlags = (await db.from("settings").select("value").eq("key", "flags").maybeSingle()).data?.value;
    previousWorkflow = (await db.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle()).data?.value;
    await db.from("settings").upsert({ key: "flags", value: { ...(previousFlags as object), SENDING_ENABLED: false } as Json }, { onConflict: "key" });
    await setWorkflow({ excluded_domains: [D("excl")] });
    // research caches from earlier manual runs would hide the fact check, so clear them for the shared mock companies
    await db.from("companies").update({ research_cached_at: null }).like("domain", "apollo-co-%");

    const { data: inbox } = await db.from("inboxes").insert({ email: `${tag}-inbox@example.com`, display_name: "Sam", status: "active", daily_send_cap: 50, daily_draft_cap: 50, min_seconds_between_sends: 0 }).select("id").single();
    inboxId = inbox!.id;
    const { data: offer } = await db.from("offers").insert({ name: `Audit ${tag}`, allowed_claims: ["Fixed-scope, two-week audit"], cta_options: ["Open to a quick call next week?"] }).select("id").single();
    await db.from("case_studies").insert({ offer_id: offer!.id, title: `Logistics case ${tag}`, summary: "Illustrative", allowed_numbers: { hours: 12 }, industries: ["logistics"] });
    const base = { offer_id: offer!.id, inbox_id: inboxId, cta: "Open to a quick call next week?", daily_cap: 6 };
    csvCampaignId = (await db.from("campaigns").insert({ name: `${tag} csv`, ...base, icp: { leadSource: "csv", requireEmail: true } as Json }).select("id").single()).data!.id;
    dryCampaignId = (await db.from("campaigns").insert({ name: `${tag} dry`, ...base, icp: { leadSource: "csv", requireEmail: true } as Json }).select("id").single()).data!.id;
    apolloCampaignId = (
      await db.from("campaigns").insert({ name: `${tag} apollo`, ...base, icp: { leadSource: "apollo", requireEmail: false, countries: [], industries: [], employeeMin: 10, employeeMax: 500 } as Json }).select("id").single()
    ).data!.id;
    await db.from("suppression").insert({ email_lower: `blocked@${D("sup")}`, scope: "global", reason: `${tag} opted out`, source: "itest" });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    const restore = async (key: string, v: Json | null | undefined) => {
      if (v === undefined) await db.from("settings").delete().eq("key", key);
      else await db.from("settings").upsert({ key, value: v }, { onConflict: "key" });
    };
    await restore("flags", previousFlags);
    await restore(WORKFLOW_SETTINGS_KEY, previousWorkflow);
    await cleanup(tag);
    if (userId) await db.auth.admin.deleteUser(userId);
    await ctx.pool.end();
  }, 120_000);

  it("Apollo run end to end: top leads approved, credits spent only on them, drafts land in Gmail with label and note, nothing is sent", async () => {
    const before = gmail().drafts.size;
    const revealsBefore = mockRevealLog.length;
    const batch = await run(apolloCampaignId);
    const totals = batch.totals as { target: number; leadIds: string[]; log: { step: string; count: number | null }[]; summary: { drafts: number; skipped: Record<string, number>; creditsUsed: number } };
    expect(batch.status).toBe("completed");
    expect(totals.target).toBe(6);
    expect(totals.leadIds.length).toBe(8); // 6 / 0.75 = 8 leads searched for
    expect(totals.log.map((l) => l.step)).toEqual(expect.arrayContaining(["target", "search", "clean", "quick check", "research and score", "approve", "reveal and verify", "done"]));

    const rows = (await db.from("campaign_leads").select("id, contact_id, status, reason_codes, lead_score").in("id", totals.leadIds)).data!;
    const drafted = rows.filter((r) => r.status === "draft_ready");
    expect(drafted.length).toBeGreaterThanOrEqual(4);
    expect(drafted.length).toBeLessThanOrEqual(6);
    expect(totals.summary.drafts).toBe(drafted.length);
    expect(gmail().drafts.size - before).toBe(drafted.length);

    // approval rule: only leads at/above the cut-off were approved; nothing past today's number; nobody else had an email revealed
    for (const r of drafted) expect(r.lead_score).toBeGreaterThanOrEqual(55);
    const revealedContacts = (await db.from("credit_ledger").select("contact_id, status, credits, flags, is_mock, apollo_person_id").eq("batch_id", batch.id)).data!;
    const draftedContactIds = new Set((await db.from("campaign_leads").select("contact_id").in("id", drafted.map((d) => d.id))).data!.map((c) => c.contact_id));
    expect(revealedContacts.length).toBeLessThanOrEqual(6);
    for (const c of revealedContacts) {
      expect(c.flags).toEqual(REVEAL_FLAGS);
      expect(c.is_mock).toBe(true);
    }
    for (const id of draftedContactIds) expect(revealedContacts.some((c) => c.contact_id === id && c.status === "done" && c.credits === 1)).toBe(true);
    expect(mockRevealLog.length - revealsBefore).toBe(revealedContacts.length);
    for (const call of mockRevealLog.slice(revealsBefore)) expect(call.flags).toEqual({ revealPersonalEmails: false, revealPhoneNumber: false, waterfallEmail: false, waterfallPhone: false, webhookUrl: null });
    for (const s of rows.filter((r) => r.status === "disqualified")) {
      expect(s.reason_codes[0]).toBeTruthy();
      if (["below-threshold", "over-quota", "screen-failed", "no-data", "no-verified-fact", "extraction-suspect"].includes(s.reason_codes[0]!)) expect(revealedContacts.some((c) => c.contact_id === s.contact_id)).toBe(false);
    }
    // the invented facts of "Apollo Co 7" fail the exact-quote check (more than 40%): that lead is skipped with a reason
    expect(rows.some((r) => r.reason_codes[0] === "extraction-suspect")).toBe(true);

    // every Gmail draft: label, bracketed note on top (score, trigger, source), footer, white-label line, no links
    for (const d of drafted) {
      const dr = await latestDraft(d.id);
      expect(dr).toMatchObject({ status: "approved", step: 0 });
      expect(dr.warnings).toEqual([]);
      const g = gmail().drafts.get(dr.gmail_draft_id!)!;
      expect(g.label).toBe("AI-Outreach");
      expect(g.bodyText).toMatch(/^\[AI note, delete before sending: score \d+; trigger: .+; source: https:\/\//);
      expect(g.bodyText).toContain(`${tag} Street 1, Pune`);
      expect(g.bodyText).toContain("Reply STOP");
      expect(g.bodyText).toContain("white-label work");
      expect(dr.body_text).not.toMatch(/https?:\/\//);
      expect(dr.quality_score).toBeGreaterThanOrEqual(75);
      // the used fact is stored evidence with the exact quote
      const ev = (await db.from("evidence_items").select("url, snippet, retrieved_at").eq("id", (dr.facts as string[])[0]!).single()).data!;
      expect(ev.url).toMatch(/^https:\/\//);
      expect(ev.retrieved_at).toBeTruthy();
      expect(normText(dr.body_text)).toContain(normText(ev.snippet!));
    }
    // nothing was sent, no send row exists
    expect(sender().sent).toHaveLength(0);
    expect((await db.from("email_sends").select("id").eq("campaign_id", apolloCampaignId)).data).toHaveLength(0);
    // spend is recorded as mock at $0
    expect((await db.from("usage_records").select("is_mock, cost_usd").eq("campaign_id", apolloCampaignId)).data!.every((u) => u.is_mock && Number(u.cost_usd) === 0)).toBe(true);
  }, 290_000);

  it("resume: running the same batch again repeats no paid step (no new reveal, no new draft)", async () => {
    const batch = (await db.from("pipeline_batches").select("id").eq("campaign_id", apolloCampaignId).single()).data!;
    const reveals = mockRevealLog.length;
    const ledger = (await db.from("credit_ledger").select("id", { count: "exact", head: true }).eq("batch_id", batch.id)).count;
    const gmailDrafts = gmail().drafts.size;
    const usage = (await db.from("usage_records").select("id", { count: "exact", head: true }).eq("campaign_id", apolloCampaignId)).count;
    await db.from("pipeline_batches").update({ status: "running", finished_at: null }).eq("id", batch.id);
    await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `run:${batch.id}:2`, payload: { batchId: batch.id } as Json, campaign_id: apolloCampaignId, batch_id: batch.id });
    await drain([apolloCampaignId]);
    expect(mockRevealLog.length).toBe(reveals);
    expect((await db.from("credit_ledger").select("id", { count: "exact", head: true }).eq("batch_id", batch.id)).count).toBe(ledger);
    expect(gmail().drafts.size).toBe(gmailDrafts);
    expect((await db.from("usage_records").select("id", { count: "exact", head: true }).eq("campaign_id", apolloCampaignId)).count).toBe(usage);
    expect((await db.from("pipeline_batches").select("status").eq("id", batch.id).single()).data!.status).toBe("completed");
  }, 120_000);

  it("clean + checks on CSV leads: suppressed, DNC, excluded domain, role address and invalid email are skipped with a reason; a bad first draft gets one rewrite; a bad second draft goes to Needs attention", async () => {
    await mkLead("ok", { first: "Asha" });
    await mkLead("sup", { first: "Blocked", email: `blocked@${D("sup")}` });
    await mkLead("dnc", { first: "Dina", dnc: true });
    await mkLead("excl", { first: "Eve" });
    await mkLead("role", { first: "Rita", email: `info@${D("role")}` });
    await mkLead("bad", { first: "Bob", email: `invalid.bob@${D("bad")}` }); // mock verifier marks "invalid" local parts as invalid
    await mkLead("nofit", { first: "Nina" });
    await db.from("companies").update({ domain: `nofit-${tag}.example.com` }).eq("id", leads.nofit!.companyId);
    await mkLead("rew", { first: "Rex", company: `Badwrite ${tag}` });
    await mkLead("fail", { first: "Fay", company: `Failwrite Badwrite ${tag}` });
    await setWorkflow({ excluded_domains: [D("excl")] });
    // 9 leads in the campaign, but only 6/0.75 = 8 are picked: the oldest first
    const batch = await run(csvCampaignId);
    expect(batch.status).toBe("completed");

    expect(await lead(leads.ok!.leadId)).toMatchObject({ status: "draft_ready", next_action: "wait-send" });
    expect(await lead(leads.sup!.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["suppressed"] });
    expect(await lead(leads.dnc!.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["suppressed"] });
    expect(await lead(leads.excl!.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["excluded", "domain"] });
    expect(await lead(leads.role!.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["role-address", "info"] });
    expect(await lead(leads.bad!.leadId)).toMatchObject({ status: "disqualified", reason_codes: ["bad-email", "invalid"] });
    expect((await lead(leads.nofit!.leadId)).reason_codes[0]).toBe("screen-failed");
    for (const k of ["sup", "dnc", "excl", "nofit"]) expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", leads[k]!.leadId)).data).toHaveLength(0);
    // the verifier result for the bad address also suppresses it for good
    expect((await db.from("suppression").select("id").eq("email_lower", `invalid.bob@${D("bad")}`)).data).toHaveLength(1);

    // draft rewrite: first attempt breaks a rule (exclamation mark), the one rewrite fixes it
    const rew = await lead(leads.rew!.leadId);
    expect(rew.status).toBe("draft_ready");
    expect(((await latestDraft(leads.rew!.leadId)).claim_check as { attempts: number }).attempts).toBe(2);
    // second failure: no draft is created, the lead waits in "Needs attention" with the problems
    const fail = await lead(leads.fail!.leadId);
    expect(fail).toMatchObject({ status: "disqualified" });
    expect(fail.reason_codes[0]).toBe("draft-failed");
    expect(fail.reason_codes[1]).toContain("W4");
    expect((await db.from("email_drafts").select("id").eq("campaign_lead_id", leads.fail!.leadId)).data).toHaveLength(0);
    // no credit was used for leads that already had an email
    expect((await db.from("credit_ledger").select("id").eq("batch_id", batch.id)).data).toHaveLength(0);
    expect(sender().sent).toHaveLength(0);
  }, 290_000);

  it("DRY RUN: searches, checks and scores, but spends no credits and creates no Gmail drafts", async () => {
    await mkLead("dry1", { first: "Dora", campaign: dryCampaignId });
    const reveals = mockRevealLog.length;
    const drafts = gmail().drafts.size;
    const batch = await run(dryCampaignId, true);
    expect(batch.status).toBe("completed");
    expect(await lead(leads.dry1!.leadId)).toMatchObject({ status: "scored" });
    expect(mockRevealLog.length).toBe(reveals);
    expect(gmail().drafts.size).toBe(drafts);
    expect((await db.from("credit_ledger").select("id").eq("batch_id", batch.id)).data).toHaveLength(0);
    expect((batch.totals as { wouldApprove: string[] }).wouldApprove).toContain(leads.dry1!.leadId);
  }, 120_000);

  it("SAFETY: the credit guard refuses unapproved leads, repeat reveals and anything past the daily or monthly cap", async () => {
    const cfg = parseWorkflowConfig({});
    const job = (await db.from("jobs").insert({ type: "workflow.run", idempotency_key: `${tag}-guard`, payload: {} as Json, campaign_id: csvCampaignId, status: "completed" }).select("id").single()).data!;
    const paid = makeSpender(ctx, { campaignId: csvCampaignId, leadId: null, jobId: job.id, step: "itest" });
    // a person who could be revealed (Apollo id stored), with the lead in different states
    const c = await mkLead("rev", { first: "Reva", email: null });
    await db.from("enrichment_results").insert({ contact_id: c.contactId, provider: "apollo", result: { person_id: "apollo-mock-059" } as Json, credits_used: 0 });
    const batchId = (await db.from("pipeline_batches").select("id").eq("campaign_id", csvCampaignId).limit(1).single()).data!.id;
    const before = mockRevealLog.length;

    // not approved -> refused
    expect(await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), cfg, batchId, false)).toMatchObject({ ok: false });
    // approved but over the daily cap -> refused, no ledger row, no call
    await db.from("campaign_leads").update({ status: "approved", next_action: "reveal" }).eq("id", c.leadId);
    const used = await creditsUsed(ctx);
    const capped = await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), { ...cfg, daily_reveal_cap: used.today }, batchId, false);
    expect(capped).toMatchObject({ ok: false, reason: "credit-cap" });
    const monthly = await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), { ...cfg, monthly_credit_cap: used.month }, batchId, false);
    expect(monthly).toMatchObject({ ok: false, reason: "credit-cap" });
    // dry run -> refused
    expect(await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), cfg, batchId, true)).toMatchObject({ ok: false, reason: "dry-run" });
    expect(mockRevealLog.length).toBe(before);
    expect((await db.from("credit_ledger").select("id").eq("contact_id", c.contactId)).data).toHaveLength(0);

    // allowed once: ledger row done, flags all false ...
    const ok = await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), cfg, batchId, false);
    expect(ok).toMatchObject({ ok: true, revealed: true });
    expect(mockRevealLog.length).toBe(before + 1);
    // ... and never twice, even if the lead is approved again and the email is cleared
    await db.from("contacts").update({ email: null }).eq("id", c.contactId);
    expect(await revealWithGuard(ctx, paid, await loadLead(db, c.leadId), cfg, batchId, false)).toMatchObject({ ok: false });
    expect(mockRevealLog.length).toBe(before + 1);
    expect((await db.from("credit_ledger").select("id").eq("contact_id", c.contactId)).data).toHaveLength(1);

    // a reveal that died half-way stays "uncertain" and is not retried
    const u = await mkLead("unc", { first: "Uri", email: null });
    await db.from("enrichment_results").insert({ contact_id: u.contactId, provider: "apollo", result: { person_id: "apollo-mock-058" } as Json, credits_used: 0 });
    await db.from("campaign_leads").update({ status: "approved", next_action: "reveal" }).eq("id", u.leadId);
    await db.from("credit_ledger").insert({ contact_id: u.contactId, campaign_lead_id: u.leadId, batch_id: batchId, provider: "apollo", status: "started", credits: 1, is_mock: true });
    expect(await revealWithGuard(ctx, paid, await loadLead(db, u.leadId), cfg, batchId, false)).toMatchObject({ ok: false, reason: "credit-uncertain" });
    expect(mockRevealLog.length).toBe(before + 1);
  }, 120_000);

  it("SAFETY: nothing is sent without a recorded approval, and SENDING_ENABLED is off by default", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("SENDING_ENABLED") });
    await db.from("settings").upsert({ key: "flags", value: { ...(previousFlags as object), SENDING_ENABLED: true } as Json }, { onConflict: "key" });
    const r = await send(draft.id);
    expect(r).toMatchObject({ blocked: expect.stringContaining("no recorded send approval") });
    expect(await sends(draft.id)).toHaveLength(0);
    expect(sender().sent).toHaveLength(0);
    // the database itself refuses too (service role, no approval row)
    const direct = await db.from("email_sends").insert({ draft_id: draft.id, send_key: `${tag}-direct`, inbox_id: inboxId, recipient_email: `asha@${D("ok")}`, subject: "s", body_text: "b", campaign_id: csvCampaignId });
    expect(direct.error?.message).toMatch(/no recorded approval/);
  }, 60_000);

  it("SAFETY: a changed draft, an inactive inbox, a DNC contact and a suppressed address all block the send", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    await approveSend(draft.id);
    const edit = await db.from("email_drafts").update({ body_text: "tampered" }).eq("id", draft.id);
    expect(edit.error?.message).toMatch(/immutable/);

    await db.from("inboxes").update({ status: "paused" }).eq("id", inboxId);
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("inbox is not active") });
    await db.from("inboxes").update({ status: "active" }).eq("id", inboxId);

    await db.from("contacts").update({ dnc: true }).eq("id", leads.ok!.contactId);
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("dnc") });
    await db.from("contacts").update({ dnc: false }).eq("id", leads.ok!.contactId);

    await db.from("suppression").insert({ email_lower: `asha@${D("ok")}`, scope: "global", reason: `${tag} late opt-out`, source: "itest" });
    expect(await send(draft.id)).toMatchObject({ blocked: expect.stringContaining("suppressed") });
    await db.from("suppression").delete().eq("reason", `${tag} late opt-out`);

    expect(await sends(draft.id)).toHaveLength(0);
    expect(sender().sent).toHaveLength(0);
  }, 120_000);

  it("an approved send goes out exactly once, even when triggered twice at the same time", async () => {
    const draft = await latestDraft(leads.ok!.leadId);
    const results = await Promise.all([send(draft.id), send(draft.id)]);
    expect(results.filter((r) => "sent" in r)).toHaveLength(1);
    expect(sender().sent).toHaveLength(1);
    expect(await sends(draft.id)).toEqual([{ status: "sent" }]);
    expect(await send(draft.id)).toMatchObject({ skipped: expect.any(String) });
    expect(sender().sent).toHaveLength(1);
    expect(await lead(leads.ok!.leadId)).toMatchObject({ status: "sent" });
  }, 120_000);

  it("a send whose Gmail call fails ends as 'unknown' and is never resent", async () => {
    await mkLead("unk", { first: "Umaa" });
    await db.from("campaign_leads").update({ status: "draft_ready" }).eq("id", leads.unk!.leadId);
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
      expect(await send(d!.id)).toMatchObject({ skipped: expect.stringContaining("unknown") });
    } finally {
      ctx.adapters.gmailSender.sendDraft = original;
    }
  }, 60_000);

  it("SAFETY: live paid calls need a price row and respect spend caps; nothing is spent otherwise", async () => {
    const liveCtx = { ...ctx, modes: { ...ctx.modes, search: "live" as const } };
    let searched = 0;
    liveCtx.adapters = { ...ctx.adapters, search: { search: async () => { searched++; return { results: [], usage: { units: { search: 1 } } }; } } };
    const spend = makeSpender(liveCtx, { campaignId: csvCampaignId, leadId: null, jobId: "00000000-0000-4000-8000-0000000000aa", step: "itest" });
    const realPrices = (await db.from("price_table").select("id").eq("provider", "serper")).data ?? [];
    if (!realPrices.length) {
      await expect(spend("search", "search", () => liveCtx.adapters.search.search({ query: "x" }))).rejects.toBeInstanceOf(MissingPriceError);
      expect(searched).toBe(0);
    }
    await db.from("price_table").insert({ provider: "serper", unit: `search ${tag}`, usd_per_unit: 0.001 });
    await db.from("spend_caps").insert({ scope: "campaign", campaign_id: csvCampaignId, period: "daily", cap_usd: 0.0001 });
    const spendWithPrice = makeSpender(liveCtx, { campaignId: csvCampaignId, leadId: null, jobId: "00000000-0000-4000-8000-0000000000ab", step: "itest" });
    await expect(spendWithPrice("search", "search", () => liveCtx.adapters.search.search({ query: "x" }))).rejects.toBeInstanceOf(CapReachedError);
    expect(searched).toBe(0);
    await db.from("spend_caps").delete().eq("campaign_id", csvCampaignId);
    await db.from("price_table").delete().like("unit", `%${tag}%`);
  }, 60_000);
});
