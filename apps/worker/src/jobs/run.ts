import type { ApolloFilters } from "@outreach/adapters";
import {
  ATTENTION_REASONS,
  approveTop,
  bracketNote,
  dailyTarget,
  icpSchema,
  istDayStartIso,
  leadsToFind,
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
import { loadFacts, researchLead, scoreStoredLead, screenLead } from "../pipeline/stages";
import { saveEmailDraft, writeEmail } from "../pipeline/write";
import { importTable, loadSuppression } from "./import";
import { suppressionHalt } from "./suppression";

export interface RunPayload {
  batchId: string;
}

const GMAIL_LABEL = "AI-Outreach";
const ROLE_LOCALS = new Set(["info", "sales", "contact", "hello", "admin", "support", "office", "team", "hr", "careers", "jobs", "marketing", "enquiries", "inquiries", "mail", "billing", "accounts", "noreply", "no-reply", "help"]);
const CONCURRENCY = 3;

const HEADERS = ["Apollo ID", "First Name", "Last Name", "Title", "Company", "Website", "Industry", "# Employees", "Country", "Profile URL"];
const APOLLO_MAPPING = {
  fields: { first_name: "First Name", last_name: "Last Name", job_title: "Title", company_name: "Company", company_domain: "Website", industry: "Industry", employee_count: "# Employees", country: "Country", profile_url: "Profile URL" },
} as const;

type Campaign = Tables<"campaigns">;
type Batch = Tables<"pipeline_batches">;

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
  // Apollo credits only limit campaigns that find people through Apollo: a CSV lead already has its email, so it never costs a credit
  const usesCredits = icpSchema.parse(campaign.icp ?? {}).leadSource === "apollo";
  const used = await creditsUsed(ctx);
  const dailyCreditsLeft = Math.max(0, cfg.daily_reveal_cap - used.today);
  const monthlyLeft = Math.max(0, cfg.monthly_credit_cap - used.month);
  if (!dryRun && usesCredits) dailyLimit = Math.min(dailyLimit, dailyCreditsLeft);
  const total = dailyTarget([{ id: campaign.inbox_id ?? "none", dailyLimit }], dryRun || !usesCredits ? Number.MAX_SAFE_INTEGER : monthlyLeft).total;
  if (total === 0 && reasons.length === 0) reasons.push("today's limits are already used (campaign, mailbox or credits)");
  return { target: total, reasons };
}

// ---------------------------------------------------------------- B1: Apollo people search (free), imported through the same engine as a CSV
async function pullFromApollo(ctx: WorkerCtx, campaign: Campaign, batch: Batch, job: JobInfo, want: number, cfg: WorkflowConfig) {
  const icp = icpSchema.parse(campaign.icp ?? {});
  const filters: ApolloFilters = {
    titles: campaign.target_roles, seniorities: [], keywords: icp.industries, locations: icp.countries.length ? icp.countries : cfg.countries_in_scope, employeeMin: icp.employeeMin, employeeMax: icp.employeeMax, perPage: 25,
  };
  const spend = makeSpender(ctx, { campaignId: campaign.id, leadId: null, jobId: job.jobId, step: "apolloPull" });
  const people: Awaited<ReturnType<typeof ctx.adapters.apollo.searchPeople>>["people"] = [];
  let page = 1;
  let totalPages = 1;
  while (people.length < want && page <= totalPages && page <= cfg.max_pages_per_run) {
    const res = await spend("apollo", "search_people", () => ctx.adapters.apollo.searchPeople(filters, page));
    people.push(...res.people);
    totalPages = res.totalPages;
    page++;
  }
  const picked = people.slice(0, want);
  if (!picked.length) return { found: 0, imported: 0, duplicate: 0, suppressed: 0, invalid: 0, note: "Apollo returned no people for these filters" };

  const importBatch = must(
    await ctx.db
      .from("import_batches")
      .insert({ file_name: `apollo-pull-${batch.id.slice(0, 8)}`, file_hash: `apollo:${job.jobId}`, campaign_id: campaign.id, mapping: APOLLO_MAPPING as unknown as Json, mode: "add_new", status: "mapped", runs: 1, user_id: batch.started_by })
      .select("*")
      .single(),
    "create apollo import batch",
  );
  const rows = picked.map((p) => [p.id, p.firstName, p.lastName, p.title ?? "", p.organization?.name ?? "", p.organization?.domain ?? "", p.organization?.industry ?? "", String(p.organization?.employeeCount ?? ""), p.country ?? "", p.linkedinUrl ?? ""]);
  const table = { sheetNames: ["apollo"], sheet: "apollo", headers: HEADERS, rawHeaders: HEADERS, hasHeader: true, rows, rowNumbers: rows.map((_, i) => i + 2), blankRows: 0, encoding: null, delimiter: null, warnings: [] };
  const totals = await importTable(ctx.db, importBatch, { requireEmail: false, stored: APOLLO_MAPPING as never, run: 1 }, table, ctx.log);

  // remember each person's Apollo id so the email can be revealed later, after approval
  const imported = must(await ctx.db.from("import_rows").select("contact_id, original").eq("batch_id", importBatch.id).in("status", ["imported", "updated"]), "load imported apollo rows");
  for (const r of imported) {
    if (!r.contact_id) continue;
    const personId = (r.original as Record<string, string>)["Apollo ID"];
    const { data: has } = await ctx.db.from("enrichment_results").select("id").eq("contact_id", r.contact_id).eq("provider", "apollo").limit(1).maybeSingle();
    if (!has && personId) await ctx.db.from("enrichment_results").insert({ contact_id: r.contact_id, provider: "apollo", result: { person_id: personId } as Json, credits_used: 0 });
  }
  return { found: picked.length, imported: totals.imported, duplicate: totals.duplicate, suppressed: totals.suppressed, invalid: totals.invalid, note: undefined as string | undefined };
}

// ---------------------------------------------------------------- B2: clean (excluded, suppressed, same company) and pick the leads to work on
async function cleanAndSelect(ctx: WorkerCtx, campaign: Campaign, cfg: WorkflowConfig, want: number) {
  const candidates = must(
    await ctx.db
      .from("campaign_leads")
      .select("id, contact_id, status, next_action, contacts(id, company_id, job_title, country, dnc, email_lower, companies(id, domain))")
      .eq("campaign_id", campaign.id)
      .in("status", ["imported", "scored", "approved"])
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
  const skip = async (l: { id: string; contact_id: string }, reason: SkipReason, detail?: string) => {
    await skipLead(ctx.db, l, reason, detail);
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
    if (c.job_title && excludedTitles.some((t) => c.job_title!.toLowerCase().includes(t))) { await skip(l, "excluded", "title"); continue; }
    if (cfg.countries_in_scope.length && c.country && !cfg.countries_in_scope.some((x) => x.toLowerCase() === c.country!.toLowerCase())) { await skip(l, "excluded", "country"); continue; }
    if (c.company_id && (recentCompanies.has(c.company_id) || seenCompanies.has(c.company_id))) { await skip(l, "same-company"); continue; }
    if (c.company_id) seenCompanies.add(c.company_id);
    picked.push(l.id);
  }
  return { picked, skippedBy, resumed };
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
  const safely = async <T>(lead: { id: string }, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    await checkStop();
    if (stop) return undefined;
    try {
      return await fn();
    } catch (e) {
      const n = (e as Error).name;
      if (n === "CapReachedError" || n === "MissingPriceError") throw e;
      errors++;
      ctx.log(`${label} failed for lead ${lead.id}: ${(e as Error).message}`);
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
      await patchTotals(db, batch.id, { target, dryRun }, { step: "target", count: target, note: reasons.join("; ") || (dryRun ? "dry run: no credits and no Gmail drafts" : undefined) });
      if (target <= 0) {
        await db.from("pipeline_batches").update({ status: "completed", finished_at: new Date().toISOString(), fanout_done: true }).eq("id", batch.id);
        return { target: 0, reasons };
      }
      const want = leadsToFind(target, cfg.approval_rate);
      const icp = icpSchema.parse(campaign.icp ?? {});
      if (icp.leadSource === "apollo") {
        try {
          const pull = await pullFromApollo(ctx, campaign, batch, job, want, cfg);
          await patchTotals(db, batch.id, { pull }, { step: "search", count: pull.found, note: pull.note ?? `${pull.imported} new, ${pull.duplicate} duplicates, ${pull.suppressed} suppressed, ${pull.invalid} invalid` });
        } catch (e) {
          const n = (e as Error).name;
          if (n === "CapReachedError" || n === "MissingPriceError") throw e;
          await patchTotals(db, batch.id, {}, { step: "search", count: 0, note: `Apollo search failed (${(e as Error).message}); using leads already in the campaign` });
        }
      }
      const { picked, skippedBy, resumed } = await cleanAndSelect(ctx, campaign, cfg, want);
      const cleanNote = [resumed ? `${resumed} approved lead(s) continued from an earlier run` : "", Object.keys(skippedBy).length ? `skipped: ${Object.entries(skippedBy).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""].filter(Boolean).join("; ");
      await patchTotals(db, batch.id, { leadIds: picked, cleanSkipped: skippedBy, fanout_done: true }, { step: "clean", count: picked.length, note: cleanNote || undefined });
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
    await patchTotals(db, batch.id, {}, { step: "quick check", count: stageA.filter((r) => r && !isSkipped(r)).length, note: `${stageA.filter(isSkipped).length} did not pass` });

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
    await patchTotals(db, batch.id, {}, { step: "research and score", count: leads.filter((l) => l.status === "scored" || l.status === "approved" || l.status === "draft_ready").length, note: `${leads.filter((l) => l.status === "disqualified").length} skipped so far` });

    // ------------------------------------------------ 4. approve the best leads (cut-off, up to today's number)
    await checkStop();
    const target = ((await reload()).totals as { target?: number }).target ?? 0;
    const scored = leads.filter((l) => l.status === "scored");
    const alreadyApproved = leads.filter((l) => ["approved", "draft_ready"].includes(l.status)).length;
    const ranked = approveTop(scored.map((l) => ({ id: l.id, score: l.lead_score ?? 0 })), cfg.approve_threshold, Math.max(0, target - alreadyApproved));
    if (dryRun) {
      await patchTotals(db, batch.id, { wouldApprove: ranked.approved.map((a) => a.id) }, { step: "approve (dry run)", count: ranked.approved.length, note: "leads left as scored; nothing was spent on credits" });
    } else if (!stop) {
      for (const a of ranked.approved) {
        const lead = leads.find((l) => l.id === a.id)!;
        must(await db.from("campaign_leads").update({ status: "approved", next_action: "reveal" }).eq("id", a.id), "approve lead");
        await leadEvent(db, lead, "approved", { score: a.score });
      }
      for (const b of ranked.below) await skipLead(db, leads.find((l) => l.id === b.id)!, "below-threshold", `score ${b.score}`);
      for (const o of ranked.overQuota) await skipLead(db, leads.find((l) => l.id === o.id)!, "over-quota", `score ${o.score}`);
      await patchTotals(db, batch.id, {}, { step: "approve", count: ranked.approved.length, note: `cut-off ${cfg.approve_threshold}, today's number ${target}; ${ranked.below.length} below the cut-off, ${ranked.overQuota.length} over the number` });
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
          let status = c.email_status;
          if (status === "unknown") {
            const v = await spend("verifier", "verify", () => ctx.adapters.verifier.verify(r.email));
            status = v.status;
            must(await db.from("contacts").update({ email_status: v.status }).eq("id", c.id), "save email status");
            if (v.status === "invalid") await db.from("suppression").insert({ email_lower: r.email.toLowerCase(), scope: "global", reason: "invalid email (verifier)", source: "verifier" });
          }
          if (status === "invalid" || (status !== "valid" && !cfg.allow_risky)) return skipLead(db, lead, "bad-email", status);
          must(await db.from("campaign_leads").update({ next_action: "draft" }).eq("id", id), "ready to write");
          await leadEvent(db, lead, "email_ready", { status, revealed: r.revealed });
        }),
      );
      leads = await leadsIn(ids);
      const used = await creditsUsed(ctx);
      await patchTotals(db, batch.id, {}, { step: "reveal and verify", count: leads.filter((l) => l.next_action === "draft" || l.status === "draft_ready").length, note: `credits used today ${used.today}/${cfg.daily_reveal_cap}, this month ${used.month}/${cfg.monthly_credit_cap}` });

      // ------------------------------------------------ 6. write, check, Gmail draft
      const inbox = campaign.inbox_id ? (await db.from("inboxes").select("display_name, email").eq("id", campaign.inbox_id).maybeSingle()).data : null;
      const sender = (inbox?.display_name ?? inbox?.email?.split("@")[0] ?? "").trim().split(/\s+/)[0] ?? "";
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
            const w = await writeEmail(ctx, spendFor(lead, "write"), cfg, lead, facts, sender || "Sourabh", seen);
            if (!w.ok) return skipLead(db, lead, "draft-failed", w.problems.slice(0, 3).join(" | ").slice(0, 400));
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

    await checkStop();
    const summary = await buildSummary(ctx, batch.id, ids, dryRun, startedAt);
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
    const notes = [dryRun ? "dry run finished" : `${summary.drafts} Gmail draft(s) created`, ...(mailboxDown ? [`stopped writing: ${mailboxDown}`] : []), ...labelNotes];
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
    must(await db.from("email_drafts").update({ gmail_draft_id: res.draftId, gmail_message_id_header: res.messageIdHeader, inbox_id: inboxId, status: "approved" }).eq("id", draft.id).is("gmail_draft_id", null), "save gmail draft id");
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
export async function buildSummary(ctx: WorkerCtx, batchId: string, ids: string[], dryRun: boolean, startedAt: number) {
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
    needsAttention: leads.filter((l) => (l.status === "disqualified" && ATTENTION_REASONS.includes(l.reason_codes[0] as SkipReason)) || l.reason_codes[0] === "gmail-failed").length + cleanAttention,
    drafts,
    creditsUsed: (ledger ?? []).reduce((a, r) => a + r.credits, 0),
    costUsd: Number((usage ?? []).reduce((a, r) => a + Number(r.cost_usd), 0).toFixed(4)),
    minutes: Math.round((Date.now() - startedAt) / 6000) / 10,
  };
}
