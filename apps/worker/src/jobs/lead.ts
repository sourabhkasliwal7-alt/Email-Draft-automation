import { decideBand, qualifyV0, scoreV0, type HaltReason, type Icp } from "@outreach/core";
import type { Json } from "@outreach/db";
import type { JobInfo, WorkerCtx } from "../ctx";
import { makeSpender } from "../spend";
import { haltLead, leadEvent, loadLead, must, refreshBatch, runStep, type LeadBundle, type StepOutput } from "../pipeline/common";
import { buildDraftContext, draftWithCheck, llmFactCheck, saveDraft } from "../pipeline/draft";
import { loadEvidence, researchCompany, type EvidenceRow } from "../pipeline/research";
import { loadSuppression } from "./import";

export interface LeadJobPayload {
  batchId: string;
  campaignLeadId: string;
}

/** Do-not-contact check used at the start and again right before drafting. */
export async function suppressionHalt(ctx: WorkerCtx, lead: LeadBundle): Promise<HaltReason | null> {
  const c = lead.contacts!;
  if (c.dnc) return "dnc";
  if (c.email_status === "invalid") return "invalid_email";
  const sup = await loadSuppression(ctx.db, lead.campaign_id);
  const emailDomain = c.email_lower?.split("@")[1];
  if ((c.email_lower && sup.emails.has(c.email_lower)) || (emailDomain && sup.domains.has(emailDomain)) || (c.companies?.domain && sup.domains.has(c.companies.domain))) return "suppressed";
  return null;
}

async function verifyEmail(ctx: WorkerCtx, spend: ReturnType<typeof makeSpender>, lead: LeadBundle, email: string): Promise<HaltReason | null> {
  const c = lead.contacts!;
  if (c.email_status !== "unknown") return c.email_status === "invalid" ? "invalid_email" : null;
  const res = await spend("verifier", "verify", () => ctx.adapters.verifier.verify(email));
  must(await ctx.db.from("contacts").update({ email_status: res.status === "unknown" ? "unknown" : res.status }).eq("id", c.id), "save email status");
  if (res.status === "invalid") {
    await ctx.db.from("suppression").insert({ email_lower: email.toLowerCase(), scope: "global", reason: "invalid email (verifier)", source: "verifier" });
    return "invalid_email";
  }
  return null;
}

/**
 * suppressionCheck -> qualify -> research -> score -> enrich -> draft -> qualityCheck -> awaitReview.
 * Each step is recorded in job_steps and skipped on a rerun; a lead that fails a gate stops with a stated reason.
 */
export async function leadPipelineJob(ctx: WorkerCtx, payload: LeadJobPayload, job: JobInfo) {
  const { db } = ctx;
  const spendFor = (lead: LeadBundle, step: string) => makeSpender(ctx, { campaignId: lead.campaign_id, leadId: lead.id, jobId: job.jobId, step });
  const { data: batchRow } = await db.from("pipeline_batches").select("status").eq("id", payload.batchId).maybeSingle();
  if (batchRow?.status === "cancelled") return { halted: "batch_cancelled" };
  let lead = await loadLead(db, payload.campaignLeadId);
  const campaign = lead.campaigns!;
  const finish = async (halted: string | null) => {
    await refreshBatch(db, payload.batchId);
    return { halted };
  };
  const stop = (out: StepOutput) => (out.halt ? out.halt : null);

  // 1. do-not-contact / suppression (checked again before drafting)
  const s1 = await runStep(db, job.jobId, "suppressionCheck", async () => {
    const reason = await suppressionHalt(ctx, lead);
    return reason ? haltLead(db, lead, reason) : { ok: true };
  });
  if (stop(s1)) return finish(stop(s1));

  // 2. qualify (deterministic ICP rules)
  const s2 = await runStep(db, job.jobId, "qualify", async () => {
    const c = lead.contacts!;
    const r = qualifyV0(campaign.icp as Partial<Icp>, {
      industry: c.companies?.industry, country: c.country ?? c.companies?.country, employeeCount: c.companies?.employee_count,
      jobTitle: c.job_title, companyName: c.companies?.name ?? c.company_name, summary: c.companies?.summary, targetRoles: campaign.target_roles,
    });
    must(await db.from("campaign_leads").update({ reason_codes: r.reasonCodes }).eq("id", lead.id), "save qualify reasons");
    return r.pass ? { ok: true, reasonCodes: r.reasonCodes } : haltLead(db, lead, "not_qualified", r.reasonCodes);
  });
  if (stop(s2)) return finish(stop(s2));
  const qualifyReasons = (s2.reasonCodes as string[] | undefined) ?? [];

  // 3. research (website, careers, search -> guarded extraction -> evidence + signals)
  const s3 = await runStep(db, job.jobId, "research", async () => {
    must(await db.from("campaign_leads").update({ status: "researching" }).eq("id", lead.id), "status researching");
    const company = lead.contacts!.companies;
    let evidence: EvidenceRow[] = [];
    let dropped = 0;
    let lowConfidence = true;
    if (company) {
      const r = await researchCompany(ctx, spendFor(lead, "research"), company, { jobId: job.jobId, campaignLeadId: lead.id }, campaign.research_depth as "light" | "standard" | "deep");
      evidence = r.evidence;
      dropped = r.dropped;
      lowConfidence = r.lowConfidence;
    }
    const top = evidence.find((e) => e.verification === "verified") ?? evidence[0];
    must(
      await db.from("campaign_leads").update({ status: "researched", trigger: top ? top.snippet.slice(0, 200) : null, trigger_date: top?.signal_date ?? null, trigger_source: top?.url ?? null }).eq("id", lead.id),
      "save trigger",
    );
    await leadEvent(db, lead, "researched", { evidence: evidence.length, dropped, lowConfidence });
    return { evidenceCount: evidence.length, lowConfidence, dropped };
  });

  // 4. score (deterministic, explainable)
  const s4 = await runStep(db, job.jobId, "score", async () => {
    lead = await loadLead(db, lead.id);
    const c = lead.contacts!;
    const s = scoreV0({
      qualifyReasons, evidenceCount: s3.evidenceCount as number, jobTitle: c.job_title, hasTargetRoles: campaign.target_roles.length > 0, hasOffer: Boolean(campaign.offer_id),
      emailStatus: c.email_status, hasEmail: Boolean(c.email), employeeKnown: c.companies?.employee_count != null, industryKnown: Boolean(c.companies?.industry),
    });
    const band = decideBand(s.score, campaign.score_draft_min, campaign.score_review_min);
    must(
      await db.from("campaign_leads").update({ status: "scored", lead_score: s.score, score_components: s.components as unknown as Json, reason_codes: [...new Set([...qualifyReasons, ...s.reasonCodes])], review_required: band === "review" }).eq("id", lead.id),
      "save score",
    );
    await leadEvent(db, lead, "scored", { score: s.score, band, components: s.components });
    return band === "skip" ? haltLead(db, lead, "low_score", s.reasonCodes) : { ok: true, score: s.score, band };
  });
  if (stop(s4)) return finish(stop(s4));

  // 5. enrich: reveal the email only now (after qualification), then verify it
  const s5 = await runStep(db, job.jobId, "enrich", async () => {
    lead = await loadLead(db, lead.id);
    const c = lead.contacts!;
    const spend = spendFor(lead, "enrich");
    let email = c.email;
    if (!email) {
      const { data: enr } = await db.from("enrichment_results").select("result").eq("contact_id", c.id).eq("provider", "apollo").limit(1).maybeSingle();
      const personId = (enr?.result as { person_id?: string } | null)?.person_id;
      if (!personId) return haltLead(db, lead, "missing_data", ["no_email", "no_apollo_id"]);
      const rev = await spend("apollo", "reveal_email", () => ctx.adapters.apollo.revealEmail({ personId }));
      await db.from("enrichment_results").insert({ contact_id: c.id, provider: "apollo", result: { person_id: personId, revealed: Boolean(rev.email) } as Json, credits_used: rev.usage.units.credit ?? 0 });
      if (!rev.email) return haltLead(db, lead, "missing_data", ["no_email_revealed"]);
      const { error } = await db.from("contacts").update({ email: rev.email }).eq("id", c.id);
      if (error) return haltLead(db, lead, "missing_data", [error.code === "23505" ? "email_belongs_to_another_contact" : "email_save_failed"]);
      email = rev.email;
      lead = await loadLead(db, lead.id);
    }
    const bad = await verifyEmail(ctx, spend, lead, email);
    if (bad) return haltLead(db, lead, bad);
    return { ok: true, email };
  });
  if (stop(s5)) return finish(stop(s5));

  // 6. draft (do-not-contact is checked again right before drafting)
  const s6 = await runStep(db, job.jobId, "draft", async () => {
    lead = await loadLead(db, lead.id);
    const again = await suppressionHalt(ctx, lead);
    if (again) return haltLead(db, lead, again);
    must(await db.from("campaign_leads").update({ status: "drafting" }).eq("id", lead.id), "status drafting");
    const evidence = lead.contacts!.company_id ? await loadEvidence(ctx, lead.contacts!.company_id) : [];
    const { context, offerId, caseStudyId } = await buildDraftContext(ctx, lead, evidence);
    const { draft, check, regenerated } = await draftWithCheck(ctx, spendFor(lead, "draft"), context);
    const saved = await saveDraft(ctx, lead, draft, {
      evidenceIds: context.evidence.map((e) => e.id), claimCheck: { deterministic: check, regenerated, claims: draft.facts_used }, flags: check.flags, passed: check.pass, offerId, caseStudyId,
    });
    return { ok: true, draftId: saved.id, version: saved.version, evidenceIds: context.evidence.map((e) => e.id), regenerated };
  });
  if (stop(s6)) return finish(stop(s6));

  // 7. quality check: second, model-based pass over the stored draft
  await runStep(db, job.jobId, "qualityCheck", async () => {
    lead = await loadLead(db, lead.id);
    const draft = must(await db.from("email_drafts").select("*").eq("id", s6.draftId as string).single(), "load draft");
    const ids = s6.evidenceIds as string[];
    const rows = ids.length ? must(await db.from("evidence_items").select("id, url, snippet").in("id", ids), "load draft evidence") : [];
    const context = (await buildDraftContext(ctx, lead, [])).context;
    context.evidence = rows.map((r) => ({ id: r.id, snippet: r.snippet ?? "", url: r.url }));
    const facts = ((draft.claim_check as { deterministic?: { flags: string[] } })?.deterministic?.flags ?? []) as string[];
    const claims = ((draft.claim_check as { claims?: { claim: string; evidence_id: string }[] })?.claims ?? []);
    const llm = await llmFactCheck(ctx, spendFor(lead, "qualityCheck"), { subject: draft.subject, body_text: draft.body_text, facts_used: claims }, context);
    const warnings = [...new Set([...facts, ...llm.flags.map((f) => `fact check: ${f}`)])];
    must(
      await db.from("email_drafts").update({ warnings, claim_check: { ...(draft.claim_check as object), llm } as Json, quality_score: warnings.length ? Math.max(0, 70 - 10 * warnings.length) : 100 }).eq("id", draft.id),
      "save quality check",
    );
    must(await db.from("campaign_leads").update({ status: "draft_ready" }).eq("id", lead.id), "status draft_ready");
    return { ok: true, warnings: warnings.length };
  });

  // 8. hand over to a human
  await runStep(db, job.jobId, "awaitReview", async () => {
    must(await db.from("campaign_leads").update({ status: "needs_review", next_action: "Review the draft" }).eq("id", lead.id), "status needs_review");
    await leadEvent(db, lead, "draft_ready", { draft_id: s6.draftId, version: s6.version });
    return { ok: true };
  });
  return finish(null);
}
