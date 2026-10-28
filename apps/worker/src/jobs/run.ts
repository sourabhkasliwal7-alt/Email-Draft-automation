import {
  ATTENTION_REASONS,
  EMAIL_DOMAIN_MISMATCH,
  approveTop,
  bracketNote,
  dailyTarget,
  emailDomainMismatch,
  icpSchema,
  isNeverFetched,
  istDayStartIso,
  leadsToFind,
  normalizeEmailStatus,
  sourcesOf,
  validateWorkflowConfig,
  type SkipReason,
  type WorkflowConfig,
} from "@outreach/core";
import type { Json, Tables } from "@outreach/db";
import { RetryLater, type JobInfo, type WorkerCtx } from "../ctx";
import { makeSpender } from "../spend";
import { leadEvent, loadLead, must, type LeadBundle } from "../pipeline/common";
import { creditsUsed, revealWithGuard } from "../pipeline/reveal";
import { acquireRunLock, heartbeatRunLock, isSkipped, loadWorkflowConfig, mapLimit, patchTotals, RunStopped, skipLead } from "../pipeline/run-common";
import { RESEARCH_LIVE, loadFacts, researchIsLive, researchLead, scoreStoredLead, screenLead } from "../pipeline/stages";
import { type PullResult, apolloFiltersFor, pullFromApollo } from "./apollo-pull";
import { saveEmailDraft, writeEmail } from "../pipeline/write";
import { loadSuppression } from "./import";
import { suppressionHalt } from "./suppression";
import { discoverFromWeb, webSkipReason } from "./web-discovery";

export interface RunPayload {
  batchId: string;
}

const GMAIL_LABEL = "AI-Outreach";
const ROLE_LOCALS = new Set(["info", "sales", "contact", "hello", "admin", "support", "office", "team", "hr", "careers", "jobs", "marketing", "enquiries", "inquiries", "mail", "billing", "accounts", "noreply", "no-reply", "help"]);
const CONCURRENCY = 3;

type Campaign = Tables<"campaigns">;
type FunnelCounts = { found: number; checked: number; researched: number; approved: number; drafted: number };

// ---------------------------------------------------------------- A4: today's number
export async function computeTarget(ctx: WorkerCtx, campaign: Campaign, cfg: WorkflowConfig, dryRun: boolean): Promise<{ target: number; reasons: string[] }> {
  const since = istDayStartIso(new Date());
  const reasons: string[] = [];
  const { count: campaignToday } = await ctx.db
    .from("email_drafts")
    .select("id, campaign_leads!inner(campaign_id)", { count: "exact", head: true })
    .eq("campaign_leads.campaign_id", campaign.id)
    .not("status", "in", "(superseded,rejected)")
    .gte("created_at", since);
  let dailyLimit = Math.max(0, campaign.daily_cap - (campaignToday ?? 0));
  if (campaign.inbox_id) {
    const inbox = must(await ctx.db.from("inboxes").select("daily_draft_cap, email, status").eq("id", campaign.inbox_id).single(), "load mailbox");
    if (!dryRun && ctx.modes.gmail === "live" && inbox.status !== "active") {
      // a mailbox that Google no longer accepts must not cost any research or writing money
      const why = inbox.status === "needs_reconnect" ? "needs to be reconnected" : inbox.status === "disconnected" ? "is not connected to Google" : `is ${inbox.status}`;
      return { target: 0, reasons: [`mailbox ${inbox.email} ${why}: fix it on the Mailboxes page, then start the run again`] };
    }
    const { count: inboxToday } = await ctx.db.from("email_drafts").select("id", { count: "exact", head: true }).eq("inbox_id", campaign.inbox_id).not("gmail_draft_id", "is", null).gte("created_at", since);
    dailyLimit = Math.min(dailyLimit, Math.max(0, inbox.daily_draft_cap - (inboxToday ?? 0)));
  } else if (!dryRun) {
    dailyLimit = 0;
    reasons.push("no mailbox chosen on the campaign");
  }
  // Apollo credits only limit leads that need an email revealed: a CSV lead already has its email, so it never costs a credit.
  // CSV only: no limit. Apollo or web discovery: the credits left. A mix with CSV: the credits left plus the leads that already have an email.
  const sources = sourcesOf(icpSchema.parse(campaign.icp ?? {}));
  const usesCredits = sources.some((s) => s !== "csv");
  const free = usesCredits && sources.includes("csv") ? await countOpenLeadsWithEmail(ctx, campaign.id) : 0;
  const used = await creditsUsed(ctx);
  const dailyCreditsLeft = Math.max(0, cfg.daily_reveal_cap - used.today) + free;
  const monthlyLeft = Math.max(0, cfg.monthly_credit_cap - used.month) + free;
  if (!dryRun && usesCredits) dailyLimit = Math.min(dailyLimit, dailyCreditsLeft);
  const total = dailyTarget([{ id: campaign.inbox_id ?? "none", dailyLimit }], dryRun || !usesCredits ? Number.MAX_SAFE_INTEGER : monthlyLeft).total;
  if (total === 0 && reasons.length === 0) reasons.push("today's limits are already used (campaign, mailbox or credits)");
  return { target: total, reasons };
}

// ---------------------------------------------------------------- B2: clean (excluded, suppressed, same company) and pick the leads to work on
async function cleanAndSelect(ctx: WorkerCtx, campaign: Campaign, cfg: WorkflowConfig, want: number) {
  const redone = await redoDemoResearch(ctx, campaign.id);
  const candidates = must(
    await ctx.db
      .from("campaign_leads")
      .select("id, contact_id, status, next_action, contacts(id, company_id, job_title, country, dnc, email_lower, companies(id, domain))")
      .eq("campaign_id", campaign.id)
      .in("status", ["imported", "researching", "researched", "scored", "approved"])
      .order("created_at")
      .limit(1000),
    "load candidate leads",
  );
  // An "approved" lead that is still waiting for its email, text or Gmail draft (a mailbox needed reconnecting, a limit paused the run)
  // is picked up again and continues where it stopped: no step that already ran is repeated or paid for twice.
  const WAITING = ["reveal", "draft", "deliver"];
  const waiting = new Set(candidates.filter((l) => l.status === "approved" && WAITING.includes(l.next_action ?? "")).map((l) => l.id));
  const open = candidates.filter((l) => l.status !== "approved" || waiting.has(l.id));
  const sup = await loadSuppression(ctx.db, campaign.id);
  const since = new Date(Date.now() - cfg.same_company_cooldown_days * 86_400_000).toISOString();
  const recent = must(await ctx.db.from("email_drafts").select("campaign_lead_id, campaign_leads!inner(contacts!inner(company_id))").gte("created_at", since).neq("status", "superseded").limit(5000), "load recent drafts");
  // a waiting lead's own draft must not make its company look "recently contacted"
  const recentCompanies = new Set(
    recent.filter((d) => !waiting.has(d.campaign_lead_id)).map((d) => (d as unknown as { campaign_leads: { contacts: { company_id: string | null } } }).campaign_leads.contacts.company_id).filter(Boolean) as string[],
  );

  // people who have no email and no Apollo id cannot get one, so they stop here (Needs attention) before any research is paid for
  const contactIds = open.map((l) => l.contact_id);
  const hasApolloId = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 200) {
    const rows = must(await ctx.db.from("enrichment_results").select("contact_id").eq("provider", "apollo").in("contact_id", contactIds.slice(i, i + 200)), "load apollo ids");
    for (const r of rows) hasApolloId.add(r.contact_id);
  }

  const picked: string[] = [];
  const skippedBy: Record<string, number> = {};
  const seenCompanies = new Set<string>();
  let resumed = 0;
  const skippedIds: string[] = [];
  const skip = async (l: { id: string; contact_id: string }, reason: SkipReason, detail?: string) => {
    await skipLead(ctx.db, l, reason, detail);
    skippedIds.push(l.id);
    skippedBy[reason] = (skippedBy[reason] ?? 0) + 1;
  };
  const excludedDomains = cfg.excluded_domains.map((d) => d.toLowerCase().replace(/^www\./, ""));
  const excludedTitles = cfg.excluded_titles.map((t) => t.toLowerCase());
  for (const l of open) {
    if (picked.length >= want) break;
    const c = l.contacts as unknown as { company_id: string | null; job_title: string | null; country: string | null; dnc: boolean; email_lower: string | null; companies: { domain: string } | null } | null;
    if (!c) continue;
    const domain = c.companies?.domain ?? null;
    const emailDomain = c.email_lower?.split("@")[1];
    if (c.dnc || (c.email_lower && sup.emails.has(c.email_lower)) || (emailDomain && sup.domains.has(emailDomain)) || (domain && sup.domains.has(domain))) { await skip(l, "suppressed"); continue; }
    if (waiting.has(l.id)) {
      // already approved and paid for: continue it, but never past a suppression (checked above)
      if (c.company_id) seenCompanies.add(c.company_id);
      picked.push(l.id);
      resumed++;
      continue;
    }
    if (!c.email_lower && !hasApolloId.has(l.contact_id)) { await skip(l, "no-email", "no email in the CSV and no Apollo id to reveal one"); continue; }
    if (!domain) { await skip(l, "no-data", "no company website"); continue; }
    if (excludedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) { await skip(l, "excluded", "domain"); continue; }
    if (isNeverFetched(`https://${domain}/`, { linkedinEnabled: cfg.linkedin_enabled })) { await skip(l, "excluded", "website is LinkedIn or Crunchbase (never read)"); continue; }
    if (c.job_title && excludedTitles.some((t) => c.job_title!.toLowerCase().includes(t))) { await skip(l, "excluded", "title"); continue; }
    if (cfg.countries_in_scope.length && c.country && !cfg.countries_in_scope.some((x) => x.toLowerCase() === c.country!.toLowerCase())) { await skip(l, "excluded", "country"); continue; }
    if (c.company_id && (recentCompanies.has(c.company_id) || seenCompanies.has(c.company_id))) { await skip(l, "same-company"); continue; }
    if (c.company_id) seenCompanies.add(c.company_id);
    picked.push(l.id);
  }
  return { picked, skippedBy, skippedIds, resumed, redone, openBefore: open.length };
}

/**
 * A real run (real pages, search and model) must not build emails on research that the mock adapters invented. Leads that were
 * screened, researched or scored earlier on mock adapters are put back to "imported" so the real steps redo them. Nothing is
 * deleted: the demo evidence stays in the database but is ignored (see loadFacts).
 */
export async function redoDemoResearch(ctx: WorkerCtx, campaignId: string): Promise<number> {
  if (!researchIsLive(ctx)) return 0;
  const rows = must(
    await ctx.db.from("campaign_leads").select("id, contact_id, status, next_action, contacts(company_id)").eq("campaign_id", campaignId).in("status", ["researching", "researched", "scored", "approved"]).limit(1000),
    "load leads to check",
  );
  const stale = rows.filter((l) => l.status !== "approved" || ["reveal", "draft", "deliver"].includes(l.next_action ?? ""));
  const companyIds = [...new Set(stale.map((l) => l.contacts?.company_id).filter((x): x is string => Boolean(x)))];
  const live = new Set<string>();
  for (let i = 0; i < companyIds.length; i += 200) {
    const runs = must(await ctx.db.from("research_runs").select("company_id").eq("provider", RESEARCH_LIVE).in("company_id", companyIds.slice(i, i + 200)), "load research runs");
    for (const r of runs) live.add(r.company_id);
  }
  let redone = 0;
  for (const l of stale) {
    const companyId = l.contacts?.company_id;
    if (companyId && live.has(companyId)) continue; // real research exists for this company
    must(await ctx.db.from("campaign_leads").update({ status: "imported", next_action: null, lead_score: null, score_components: {}, trigger: null, trigger_date: null, trigger_source: null, reason_codes: [] }).eq("id", l.id), "restart lead");
    await leadEvent(ctx.db, { id: l.id, contact_id: l.contact_id }, "restarted", { why: "its research was demo text from mock adapters" });
    redone++;
  }
  return redone;
}

/** A step that threw an error: the lead stays where it is (so the next run retries it) and is listed in Needs attention with the reason. */
async function recordStepFailure(db: WorkerCtx["db"], leadId: string, step: string, message: string) {
  const { data: lead } = await db.from("campaign_leads").select("id, contact_id").eq("id", leadId).maybeSingle();
  if (!lead) return;
  must(await db.from("campaign_leads").update({ reason_codes: ["step-failed", `${step}: ${message}`.slice(0, 400)] }).eq("id", leadId), "save step failure");
  await leadEvent(db, lead, "step_failed", { step, error: message });
}

/** Adds a data-problem note to the lead (score_components.data_flags), once. It is shown in the run report; it never stops the lead. */
export async function flagLead(db: WorkerCtx["db"], lead: { id: string; score_components: unknown }, flag: string) {
  const sc = ((lead.score_components as Record<string, unknown> | null) ?? {}) as { data_flags?: string[] };
  if (sc.data_flags?.includes(flag)) return;
  must(await db.from("campaign_leads").update({ score_components: { ...sc, data_flags: [...(sc.data_flags ?? []), flag] } as unknown as Json }).eq("id", lead.id), "flag lead");
}

// ---------------------------------------------------------------- the run

export async function workflowRunJob(ctx: WorkerCtx, payload: RunPayload, job: JobInfo) {
  const { db } = ctx;
  const startedAt = Date.now();
  let batch = must(await db.from("pipeline_batches").select("*").eq("id", payload.batchId).single(), "load run");
  if (batch.status !== "running") return { skipped: `run is ${batch.status}` };
  const campaign = must(await db.from("campaigns").select("*").eq("id", batch.campaign_id).single(), "load campaign");
  const cfg = await loadWorkflowConfig(db);
  const dryRun = cfg.dry_run || (batch.estimate as { dryRun?: boolean } | null)?.dryRun === true;

  // run lock: one run at a time
  if (!(await acquireRunLock(ctx, batch.id))) throw new RetryLater("another run is in progress", new Date(Date.now() + 60_000));

  const problems = validateWorkflowConfig(cfg, { forDraftCreation: true });
  if (problems.length) {
    await db.from("pipeline_batches").update({ status: "paused", pause_reason: "manual", paused_at: new Date().toISOString(), pause_detail: { problems } as Json }).eq("id", batch.id);
    await patchTotals(db, batch.id, {}, { step: "settings", count: null, note: `Fix the settings first: ${problems.join("; ")}` });
    return { paused: "settings", problems };
  }

  const deadline = startedAt + cfg.run_limit_minutes * 60_000;
  let lastStatusCheck = 0;
  let stop: RunStopped | null = null;
  const shouldStop = () => stop !== null;
  const checkStop = async () => {
    if (stop) return;
    if (Date.now() > deadline) stop = new RunStopped("time_limit");
    else if (Date.now() - lastStatusCheck > 4000) {
      lastStatusCheck = Date.now();
      const { data } = await db.from("pipeline_batches").select("status").eq("id", batch.id).single();
      if (data?.status === "cancelled") stop = new RunStopped("cancelled");
      else if (data?.status === "paused") stop = new RunStopped("paused");
    }
  };
  const beat = setInterval(() => void heartbeatRunLock(ctx, batch.id, job.jobId).catch((e) => ctx.log(`heartbeat failed: ${(e as Error).message}`)), 30_000);
  let errors = 0;
  /** what the Home page shows: Found -> Checked -> Researched -> Approved -> Drafted */
  const funnel: FunnelCounts = { found: 0, checked: 0, researched: 0, approved: 0, drafted: 0 };
  /** how the emails of this run came out: right the first time, right after the one rewrite, or not at all */
  const quality = { firstTry: 0, afterRewrite: 0, failed: 0 };
  const failures: { lead: string; step: string; message: string }[] = [];
  const safely = async <T>(lead: { id: string }, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    await checkStop();
    if (stop) return undefined;
    try {
      return await fn();
    } catch (e) {
      const n = (e as Error).name;
      if (n === "CapReachedError" || n === "MissingPriceError") throw e;
      errors++;
      const message = ((e as Error).message ?? String(e)).replace(/\s+/g, " ").slice(0, 300);
      ctx.log(`${label} failed for lead ${lead.id}: ${message}`);
      failures.push({ lead: lead.id, step: label, message });
      // never silent: the lead shows up in Needs attention with the step and the reason, and the next run tries it again
      await recordStepFailure(db, lead.id, label, message).catch((err) => ctx.log(`could not save the failure of lead ${lead.id}: ${(err as Error).message}`));
      return undefined;
    }
  };
  /** set when Google stops accepting a mailbox mid-run: nothing more is written (no model spend) until it is reconnected */
  let mailboxDown: string | null = null;
  const labelNotes = new Set<string>();
  const spendFor = (lead: LeadBundle, step: string) => makeSpender(ctx, { campaignId: lead.campaign_id, leadId: lead.id, jobId: job.jobId, step });
  const reload = async () => (await db.from("pipeline_batches").select("*").eq("id", batch.id).single()).data ?? batch;
  const idsOf = () => ((batch.totals as { leadIds?: string[] } | null)?.leadIds ?? []);
  const leadsIn = async (ids: string[]) => {
    const out: LeadBundle[] = [];
    for (const id of ids) out.push(await loadLead(db, id));
    return out;
  };

  try {
    // ------------------------------------------------ 1. today's number, search and clean (once per run)
    if (!(batch.totals as { leadIds?: string[] } | null)?.leadIds) {
      const { target, reasons } = await computeTarget(ctx, campaign, cfg, dryRun);
      // the models this run uses, for the run report ("Model used"); the demo model is named as such
      const modelOf = (m: string) => (ctx.modes.llm === "live" ? m : "mock (demo)");
      await patchTotals(db, batch.id, { target, dryRun, models: { quick_check: modelOf(cfg.model_screen), facts: modelOf(cfg.model_extract), writing: modelOf(cfg.model_write), checker: modelOf(cfg.model_screen) } }, { step: "target", count: target, note: reasons.join("; ") || (dryRun ? "dry run: no credits and no Gmail drafts" : undefined) });
      if (target <= 0) {
        await db.from("pipeline_batches").update({ status: "completed", finished_at: new Date().toISOString(), fanout_done: true }).eq("id", batch.id);
        return { target: 0, reasons };
      }
      const want = leadsToFind(target, cfg.approval_rate);
      const icp = icpSchema.parse(campaign.icp ?? {});
      const sources = sourcesOf(icp);
      // the leads already in the campaign (CSV) come first; Apollo and web discovery only fill what is still missing
      const have = sources.includes("csv") ? await countOpenLeads(ctx, campaign.id) : 0;
      let missing = Math.max(0, want - have);
      let webNoContact = 0;
      let webNoContactIds: string[] = [];
      if (sources.includes("apollo")) {
        // with web discovery as well, Apollo fills half of what is missing and the web fills the rest
        const wantFromApollo = sources.includes("web") ? Math.ceil(missing / 2) : missing;
        const skipWhy = apolloSkipReason(ctx, dryRun, wantFromApollo);
        if (skipWhy) await patchTotals(db, batch.id, {}, { step: "search", count: 0, note: skipWhy });
        else {
          try {
            const pull = await pullFromApollo(ctx, campaign, { id: batch.id, started_by: batch.started_by }, job, wantFromApollo, cfg);
            missing = Math.max(0, missing - pull.imported);
            await patchTotals(db, batch.id, { pull }, { step: "search", count: pull.found, note: pull.note ?? `${pull.imported} new, ${pull.duplicate} duplicates, ${pull.suppressed} suppressed, ${pull.invalid} invalid` });
          } catch (e) {
            const n = (e as Error).name;
            if (n === "CapReachedError" || n === "MissingPriceError") throw e;
            await patchTotals(db, batch.id, {}, { step: "search", count: 0, note: `Apollo search failed (${(e as Error).message}); using the leads already in the campaign` });
          }
        }
      }
      if (sources.includes("web")) {
        const skipWhy = webSkipReason(ctx);
        if (skipWhy) await patchTotals(db, batch.id, {}, { step: "web search", count: 0, note: skipWhy });
        else {
          try {
            const web = await discoverFromWeb(ctx, campaign, { id: batch.id, started_by: batch.started_by }, job, missing, cfg);
            webNoContact = web.noContact;
            webNoContactIds = web.noContactLeadIds;
            const parts = [`${web.queriesRun} search(es), ${web.results} results`, `${web.kept} new company sites`, `${web.checked} checked`, `${web.contacts} with a person to write to`, ...(web.noContact ? [`${web.noContact} with no contact found (in Needs attention)`] : []), ...(web.revived ? [`${web.revived} contact(s) found for companies from earlier runs`] : [])];
            await patchTotals(db, batch.id, { web: { ...web, companies: undefined } }, { step: "web search", count: web.contacts, note: web.note ?? parts.join(", ") });
          } catch (e) {
            const n = (e as Error).name;
            if (n === "CapReachedError" || n === "MissingPriceError") throw e;
            await patchTotals(db, batch.id, {}, { step: "web search", count: 0, note: `Web discovery failed (${(e as Error).message}); using the leads already in the campaign` });
          }
        }
      }
      const { picked, skippedBy, skippedIds, resumed, redone } = await cleanAndSelect(ctx, campaign, cfg, want);
      // companies found on the web with nobody to write to are already parked in Needs attention: they count as found and as skipped
      if (webNoContact) skippedBy["no-contact"] = (skippedBy["no-contact"] ?? 0) + webNoContact;
      funnel.found = picked.length + Object.values(skippedBy).reduce((a, n) => a + n, 0);
      funnel.checked = picked.length;
      const cleanNote = [redone ? `${redone} lead(s) had demo research from mock adapters and were started again with the real ones` : "", resumed ? `${resumed} approved lead(s) continued from an earlier run` : "", Object.keys(skippedBy).length ? `skipped: ${Object.entries(skippedBy).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""].filter(Boolean).join("; ");
      await patchTotals(db, batch.id, { leadIds: picked, cleanSkipped: skippedBy, reportExtraIds: [...skippedIds, ...webNoContactIds].slice(0, 2000), funnel, fanout_done: true }, { step: "clean", count: picked.length, note: cleanNote || undefined });
      await db.from("pipeline_batches").update({ fanout_done: true }).eq("id", batch.id);
      batch = await reload();
    }
    const ids = idsOf();

    // ------------------------------------------------ 2. Stage A: quick check
    const stageA = await mapLimit(ids, CONCURRENCY, shouldStop, (id) =>
      safely({ id }, "quick check", async () => {
        const lead = await loadLead(db, id);
        if (lead.status !== "imported" && lead.status !== "researching") return undefined;
        return screenLead(ctx, spendFor(lead, "screen"), cfg, lead);
      }),
    );
    {
      const didNotPass = stageA.filter(isSkipped).length;
      const checkedNow = stageA.filter((r) => r && !isSkipped(r)).length;
      const past = (await leadsIn(ids)).filter((l) => l.status !== "imported" && l.status !== "disqualified").length; // moved on to research, now or in an earlier run
      const earlier = Math.max(0, past - checkedNow);
      funnel.checked = past;
      await patchTotals(db, batch.id, { funnel }, { step: "quick check", count: past, note: `${past} passed (${checkedNow} checked now${earlier ? `, ${earlier} had already passed in an earlier run` : ""}); ${didNotPass} did not pass` });
    }

    // ------------------------------------------------ 3. Stage B: research, facts with exact quotes, score in code
    await mapLimit(ids, CONCURRENCY, shouldStop, (id) =>
      safely({ id }, "research", async () => {
        let lead = await loadLead(db, id);
        let pages = 2;
        if (lead.status === "researching") {
          const r = await researchLead(ctx, spendFor(lead, "research"), cfg, lead);
          if (isSkipped(r)) return;
          pages = r.pages;
          lead = await loadLead(db, id);
        }
        if (lead.status === "researched") {
          const facts = await loadFacts(ctx, lead.contacts!.company_id!, cfg.developer_keywords);
          await scoreStoredLead(ctx, cfg, lead, facts, pages);
        }
      }),
    );
    let leads = await leadsIn(ids);
    funnel.researched = leads.filter((l) => ["researched", "scored", "approved", "draft_ready"].includes(l.status)).length;
    await patchTotals(db, batch.id, { funnel }, { step: "research and score", count: leads.filter((l) => l.status === "scored" || l.status === "approved" || l.status === "draft_ready").length, note: `${leads.filter((l) => l.status === "disqualified").length} skipped so far` });

    // ------------------------------------------------ 4. approve the best leads (cut-off, up to today's number)
    await checkStop();
    const target = ((await reload()).totals as { target?: number }).target ?? 0;
    const scored = leads.filter((l) => l.status === "scored");
    const alreadyApproved = leads.filter((l) => ["approved", "draft_ready"].includes(l.status)).length;
    const ranked = approveTop(scored.map((l) => ({ id: l.id, score: l.lead_score ?? 0 })), cfg.approve_threshold, Math.max(0, target - alreadyApproved));
    if (dryRun) {
      funnel.approved = alreadyApproved + ranked.approved.length;
      await patchTotals(db, batch.id, { wouldApprove: ranked.approved.map((a) => a.id), approveCutoff: cfg.approve_threshold, funnel }, { step: "approve (dry run)", count: ranked.approved.length, note: "leads left as scored; nothing was spent on credits" });
    } else if (!stop) {
      for (const a of ranked.approved) {
        const lead = leads.find((l) => l.id === a.id)!;
        must(await db.from("campaign_leads").update({ status: "approved", next_action: "reveal" }).eq("id", a.id), "approve lead");
        await leadEvent(db, lead, "approved", { score: a.score });
      }
      for (const b of ranked.below) await skipLead(db, leads.find((l) => l.id === b.id)!, "below-threshold", `score ${b.score}`);
      for (const o of ranked.overQuota) await skipLead(db, leads.find((l) => l.id === o.id)!, "over-quota", `score ${o.score}`);
      funnel.approved = alreadyApproved + ranked.approved.length;
      await patchTotals(db, batch.id, { funnel, approveCutoff: cfg.approve_threshold }, { step: "approve", count: ranked.approved.length, note: `cut-off ${cfg.approve_threshold}, today's number ${target}; ${ranked.below.length} below the cut-off, ${ranked.overQuota.length} over the number` });
    }

    if (!dryRun && !stop) {
      // ------------------------------------------------ 5. credit-guarded reveal, then verify
      await mapLimit(ids, CONCURRENCY, shouldStop, (id) =>
        safely({ id }, "reveal", async () => {
          const lead = await loadLead(db, id);
          if (lead.status !== "approved" || lead.next_action !== "reveal") return;
          const spend = spendFor(lead, "reveal");
          const r = await revealWithGuard(ctx, spend, lead, cfg, batch.id, false);
          if (!r.ok) return skipLead(db, lead, r.reason, r.detail);
          const local = r.email.split("@")[0]!.toLowerCase();
          if (ROLE_LOCALS.has(local)) return skipLead(db, lead, "role-address", local);
          const fresh = await loadLead(db, id);
          const c = fresh.contacts!;
          // one vocabulary: a catch-all address is "risky" (it proves nothing), only a checked address is "valid", anything else stays "unknown"
          let status: string = normalizeEmailStatus(c.email_status);
          if (status !== c.email_status) must(await db.from("contacts").update({ email_status: status }).eq("id", c.id), "save email status");
          // a work address on a different website than the company's is flagged for the person reading the report; it does not stop the lead
          if (emailDomainMismatch(r.email, c.companies?.domain)) await flagLead(db, fresh, EMAIL_DOMAIN_MISMATCH);
          if (status === "unknown" && !cfg.skip_verification) {
            const v = await spend("verifier", "verify", () => ctx.adapters.verifier.verify(r.email));
            status = normalizeEmailStatus(v.status);
            must(await db.from("contacts").update({ email_status: status }).eq("id", c.id), "save email status");
            if (status === "invalid") await db.from("suppression").insert({ email_lower: r.email.toLowerCase(), scope: "global", reason: "invalid email (verifier)", source: "verifier" });
          }
          // with "Skip email verification" (testing only) an unchecked address goes on; a known-bad one never does
          if (status === "invalid" || (status !== "valid" && !cfg.allow_risky && !(cfg.skip_verification && status === "unknown"))) return skipLead(db, lead, "bad-email", status);
          must(await db.from("campaign_leads").update({ next_action: "draft" }).eq("id", id), "ready to write");
          await leadEvent(db, lead, "email_ready", { status, revealed: r.revealed, verification_skipped: cfg.skip_verification && status === "unknown" });
        }),
      );
      leads = await leadsIn(ids);
      const used = await creditsUsed(ctx);
      await patchTotals(db, batch.id, {}, { step: "reveal and verify", count: leads.filter((l) => l.next_action === "draft" || l.status === "draft_ready").length, note: `credits used today ${used.today}/${cfg.daily_reveal_cap}, this month ${used.month}/${cfg.monthly_credit_cap}` });

      // ------------------------------------------------ 6. write, check, Gmail draft
      const inbox = campaign.inbox_id ? (await db.from("inboxes").select("display_name, email").eq("id", campaign.inbox_id).maybeSingle()).data : null;
      const seen: { subject: string; opening: string }[] = [];
      await mapLimit(ids, 1, shouldStop, (id) =>
        safely({ id }, "write", async () => {
          let lead = await loadLead(db, id);
          if (lead.status !== "approved") return;
          if (mailboxDown) return; // leave the lead as it is; the next run continues once the mailbox is reconnected
          if (lead.next_action === "draft") {
            const again = await suppressionHalt(ctx, lead);
            if (again) return skipLead(db, lead, "suppressed", again);
            const company = lead.contacts!.companies;
            if (!lead.contacts!.first_name || !company) return skipLead(db, lead, "no-data", "no first name");
            const facts = await loadFacts(ctx, company.id, cfg.developer_keywords);
            if (!facts.length) return skipLead(db, lead, "no-verified-fact");
            const w = await writeEmail(ctx, spendFor(lead, "write"), cfg, lead, facts, { displayName: inbox?.display_name ?? null, email: inbox?.email ?? null }, seen);
            if (!w.ok) {
              quality.failed++;
              return skipLead(db, lead, "draft-failed", w.problems.join(" | ").slice(0, 600));
            }
            if (w.email.attempts <= 1) quality.firstTry++;
            else quality.afterRewrite++;
            await saveEmailDraft(ctx, lead, w.email, campaign.inbox_id);
            must(await db.from("campaign_leads").update({ next_action: "deliver" }).eq("id", id), "ready to deliver");
            lead = await loadLead(db, id);
          }
          if (lead.next_action === "deliver") {
            const d = await deliverToGmail(ctx, lead, campaign.inbox_id);
            if (d?.labelNote) labelNotes.add(d.labelNote);
            if (d?.needsReconnect) mailboxDown = d.needsReconnect;
          }
        }),
      );
    }

    if (failures.length) {
      const sample = failures.slice(0, 3).map((f) => `${f.step}: ${f.message.slice(0, 120)}`).join(" | ");
      await patchTotals(db, batch.id, { failures: failures.slice(0, 50) }, { step: "errors", count: failures.length, note: `${failures.length} step(s) failed with an error and are in Needs attention. ${sample}` });
    }
    await checkStop();
    const summary = await buildSummary(ctx, batch.id, ids, dryRun, startedAt, quality);
    funnel.drafted = summary.drafts;
    await patchTotals(db, batch.id, { funnel });
    if (stop) {
      const why = (stop as RunStopped).why;
      if (why === "time_limit") {
        await db.from("pipeline_batches").update({ status: "paused", pause_reason: "time_limit", paused_at: new Date().toISOString() }).eq("id", batch.id).eq("status", "running");
        await patchTotals(db, batch.id, { summary }, { step: "stopped", count: null, note: `the ${cfg.run_limit_minutes}-minute limit was reached; press Start to continue without repeating paid steps` });
      } else {
        await patchTotals(db, batch.id, { summary }, { step: "stopped", count: null, note: why });
      }
      return { stopped: why };
    }
    const written = quality.firstTry + quality.afterRewrite + quality.failed;
    const qualityNote = written ? `email quality: ${quality.firstTry} of ${written} right the first time, ${quality.afterRewrite} after a rewrite, ${quality.failed} not good enough` : "";
    const notes = [dryRun ? "test run finished" : `${summary.drafts} Gmail draft(s) created`, ...(qualityNote ? [qualityNote] : []), ...(summary.needsAttention ? [`${summary.needsAttention} lead(s) in Needs attention`] : []), ...(mailboxDown ? [`stopped writing: ${mailboxDown}`] : []), ...labelNotes];
    await patchTotals(db, batch.id, { summary, errors }, { step: "done", count: summary.drafts, note: notes.join("; ") });
    await db.from("pipeline_batches").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", batch.id).eq("status", "running");
    return summary;
  } finally {
    clearInterval(beat);
  }
}

// ---------------------------------------------------------------- 6b. Gmail draft in the right mailbox, label AI-Outreach, bracketed note on top
async function deliverToGmail(ctx: WorkerCtx, lead: LeadBundle, inboxId: string | null): Promise<{ labelNote?: string; needsReconnect?: string } | undefined> {
  const { db } = ctx;
  const draft = must(await db.from("email_drafts").select("*").eq("campaign_lead_id", lead.id).eq("step", 0).order("version", { ascending: false }).limit(1).single(), "load draft");
  const contact = lead.contacts!;
  if (draft.gmail_draft_id) {
    must(await db.from("campaign_leads").update({ status: "draft_ready", next_action: "wait-send" }).eq("id", lead.id), "mark drafted");
    return undefined;
  }
  const halt = await suppressionHalt(ctx, lead);
  if (halt || !contact.email) {
    await skipLead(db, lead, "suppressed", halt ?? "no email");
    return undefined;
  }
  if (!inboxId) {
    await skipLead(db, lead, "gmail-failed", "no mailbox chosen on the campaign");
    return undefined;
  }
  const note = bracketNote({ score: lead.lead_score, trigger: lead.trigger, source: lead.trigger_source });
  try {
    const res = await ctx.adapters.gmail.createDraft({ inboxId, to: contact.email, subject: draft.subject, bodyText: `${note}\n\n${draft.body_text}`, label: GMAIL_LABEL });
    must(await db.from("email_drafts").update({ gmail_draft_id: res.draftId, gmail_message_id_header: res.messageIdHeader, gmail_message_id: res.messageId ?? null, inbox_id: inboxId, status: "approved" }).eq("id", draft.id).is("gmail_draft_id", null), "save gmail draft id");
    must(await db.from("campaign_leads").update({ status: "draft_ready", next_action: "wait-send", reason_codes: [] }).eq("id", lead.id), "mark drafted");
    await leadEvent(db, lead, "gmail_draft_created", { draft_id: draft.id, gmail_draft_id: res.draftId, label: GMAIL_LABEL, label_applied: res.labelApplied ?? null, label_note: res.labelNote ?? null });
    return { labelNote: res.labelNote };
  } catch (e) {
    // the draft text is saved; the lead stays approved and shows in "Needs attention" until a later run retries
    must(await db.from("campaign_leads").update({ reason_codes: ["gmail-failed", (e as Error).message.slice(0, 200)] }).eq("id", lead.id), "note gmail failure");
    await leadEvent(db, lead, "gmail_draft_failed", { reason: (e as Error).message });
    // a revoked or expired sign-in affects this mailbox only: stop writing for it; campaigns on other mailboxes are unaffected
    return (e as Error).name === "MailboxNeedsReconnectError" ? { needsReconnect: (e as Error).message.slice(0, 200) } : undefined;
  }
}

// ---------------------------------------------------------------- daily summary
export async function buildSummary(ctx: WorkerCtx, batchId: string, ids: string[], dryRun: boolean, startedAt: number, quality = { firstTry: 0, afterRewrite: 0, failed: 0 }) {
  const { db } = ctx;
  const leads: { status: string; reason_codes: string[]; next_action: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    leads.push(...must(await db.from("campaign_leads").select("status, reason_codes, next_action").in("id", ids.slice(i, i + 100)), "load summary leads"));
  }
  const skipped: Record<string, number> = {};
  for (const l of leads.filter((x) => x.status === "disqualified")) skipped[l.reason_codes[0] ?? "other"] = (skipped[l.reason_codes[0] ?? "other"] ?? 0) + 1;
  const { data: batch } = await db.from("pipeline_batches").select("started_at, campaign_id, totals").eq("id", batchId).single();
  // leads the clean step already parked (suppressed, no email, excluded ...) are part of today's numbers too
  const cleanSkipped = ((batch?.totals as { cleanSkipped?: Record<string, number> } | null)?.cleanSkipped ?? {});
  for (const [reason, n] of Object.entries(cleanSkipped)) skipped[reason] = (skipped[reason] ?? 0) + n;
  const cleanAttention = Object.entries(cleanSkipped).filter(([reason]) => ATTENTION_REASONS.includes(reason as SkipReason)).reduce((a, [, n]) => a + n, 0);
  const { data: ledger } = await db.from("credit_ledger").select("credits").eq("batch_id", batchId);
  const { data: usage } = await db.from("usage_records").select("cost_usd").eq("campaign_id", batch?.campaign_id ?? "").gte("created_at", batch?.started_at ?? new Date(0).toISOString());
  const drafts = leads.filter((l) => l.status === "draft_ready").length;
  return {
    date: new Date().toISOString(),
    dryRun,
    leads: ids.length,
    byStatus: Object.fromEntries([...new Set(leads.map((l) => l.status))].map((s) => [s, leads.filter((l) => l.status === s).length])),
    skipped,
    needsAttention: leads.filter((l) => ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason)).length + cleanAttention,
    drafts,
    quality,
    creditsUsed: (ledger ?? []).reduce((a, r) => a + r.credits, 0),
    costUsd: Number((usage ?? []).reduce((a, r) => a + Number(r.cost_usd), 0).toFixed(4)),
    minutes: Math.round((Date.now() - startedAt) / 6000) / 10,
  };
}

/** Open leads that already carry an email (CSV leads): they never need a credit. */
async function countOpenLeadsWithEmail(ctx: WorkerCtx, campaignId: string): Promise<number> {
  const { count } = await ctx.db.from("campaign_leads").select("id, contacts!inner(email)", { count: "exact", head: true }).eq("campaign_id", campaignId).in("status", ["imported", "researching", "researched", "scored", "approved"]).not("contacts.email", "is", null);
  return count ?? 0;
}

/** How many leads of the campaign are waiting to be worked on right now (used by "both": CSV leads first, Apollo fills the rest). */
async function countOpenLeads(ctx: WorkerCtx, campaignId: string): Promise<number> {
  const { count } = await ctx.db.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).in("status", ["imported", "researching", "researched", "scored"]);
  return count ?? 0;
}

/**
 * Why Apollo is not searched in this run (null = search). A test run never spends Apollo credits, and a real run never works on
 * the made-up people of the demo adapter: demo people have invented websites and addresses.
 */
export function apolloSkipReason(ctx: WorkerCtx, dryRun: boolean, want: number): string | null {
  if (want <= 0) return "the leads already in the campaign are enough for today";
  if (dryRun && ctx.modes.apollo === "live") return "test run: Apollo is not searched (the company search costs a credit); use Find leads with Apollo first, then test the leads you found";
  if (researchIsLive(ctx) && ctx.modes.apollo !== "live") return "Apollo is in demo mode (no key yet): nothing was searched. Add APOLLO_API_KEY and set ADAPTER_APOLLO=live, then restart";
  return null;
}

export type { PullResult };
export { apolloFiltersFor };
