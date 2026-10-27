import { sha256Hex } from "@outreach/importer";
import {
  buildCheckPrompt,
  buildDraftPrompt,
  checkDraft,
  checkOutputSchema,
  draftKey,
  draftOutputSchema,
  parseJsonLoose,
  type DraftContext,
  type DraftOutput,
  type EvidenceRef,
} from "@outreach/core";
import type { Json } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { must, type LeadBundle } from "./common";
import type { EvidenceRow } from "./research";

type Paid = ReturnType<typeof import("../spend").makeSpender>;

export const bodyHash = (subject: string, body: string) => sha256Hex(new TextEncoder().encode(`${subject}\n${body}`));

/** Deterministic offer / case-study choice: the campaign's offer, and the case study whose industries match the company. */
export async function chooseOffer(ctx: WorkerCtx, lead: LeadBundle) {
  const offerId = lead.offer_id ?? lead.campaigns?.offer_id ?? null;
  if (!offerId) return { offer: null, caseStudy: null };
  const offer = must(await ctx.db.from("offers").select("id, name, allowed_claims, cta_options").eq("id", offerId).is("deleted_at", null).maybeSingle(), "load offer");
  const studies = must(await ctx.db.from("case_studies").select("id, title, summary, allowed_numbers, industries").eq("offer_id", offerId).is("deleted_at", null), "load case studies");
  const industry = (lead.contacts?.companies?.industry ?? "").toLowerCase();
  const match = industry ? studies.find((s) => s.industries.some((i) => i.toLowerCase() === industry)) : undefined;
  return { offer, caseStudy: match ?? null };
}

const toRef = (e: EvidenceRow): EvidenceRef => ({ id: e.id, snippet: e.snippet, url: e.url, date: e.signal_date });

export async function buildDraftContext(ctx: WorkerCtx, lead: LeadBundle, evidence: EvidenceRow[]): Promise<{ context: DraftContext; offerId: string | null; caseStudyId: string | null }> {
  const { offer, caseStudy } = await chooseOffer(ctx, lead);
  const campaign = lead.campaigns!;
  const contact = lead.contacts!;
  const inbox = campaign.inbox_id ? (await ctx.db.from("inboxes").select("display_name").eq("id", campaign.inbox_id).maybeSingle()).data : null;
  const context: DraftContext = {
    firstName: contact.first_name,
    company: contact.companies?.name ?? contact.company_name ?? contact.companies?.domain ?? "your company",
    jobTitle: contact.job_title,
    offerName: offer?.name ?? null,
    offerClaims: offer?.allowed_claims ?? [],
    caseStudy: caseStudy ? { title: caseStudy.title, summary: caseStudy.summary, allowedNumbers: caseStudy.allowed_numbers as Record<string, number> } : null,
    cta: campaign.cta ?? offer?.cta_options?.[0] ?? "Open to a quick call next week?",
    tone: campaign.tone,
    signature: `Best regards, ${inbox?.display_name ?? "the team"}`,
    evidence: evidence.slice(0, 3).map(toRef),
  };
  return { context, offerId: offer?.id ?? null, caseStudyId: caseStudy?.id ?? null };
}

async function generate(ctx: WorkerCtx, paid: Paid, context: DraftContext, feedback?: string[]): Promise<DraftOutput> {
  const { system, prompt } = buildDraftPrompt(context, feedback);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await paid("llm", "draft", () => ctx.adapters.llm.complete({ tier: "strong", system, prompt, maxTokens: 700 }));
    const parsed = draftOutputSchema.safeParse(parseJsonLoose(res.text));
    if (parsed.success) return parsed.data;
  }
  throw new Error("the model returned invalid draft JSON twice");
}

/** Generate; if the deterministic check fails, regenerate ONCE with the flags as feedback. Keeps the best attempt. */
export async function draftWithCheck(ctx: WorkerCtx, paid: Paid, context: DraftContext) {
  let draft = await generate(ctx, paid, context);
  let check = checkDraft(draft, context);
  let regenerated = false;
  if (!check.pass) {
    regenerated = true;
    const second = await generate(ctx, paid, context, check.flags);
    const secondCheck = checkDraft(second, context);
    if (secondCheck.pass || secondCheck.flags.length <= check.flags.length) {
      draft = second;
      check = secondCheck;
    }
  }
  return { draft, check, regenerated };
}

/** The second, model-based pass: every claim must be directly supported by an evidence line. */
export async function llmFactCheck(ctx: WorkerCtx, paid: Paid, draft: DraftOutput, context: DraftContext) {
  const { system, prompt } = buildCheckPrompt(draft, context.evidence);
  const res = await paid("llm", "check", () => ctx.adapters.llm.complete({ tier: "cheap", system, prompt, maxTokens: 400 }));
  const parsed = checkOutputSchema.safeParse(parseJsonLoose(res.text));
  return parsed.success ? parsed.data : { pass: false, flags: ["fact check returned unreadable output"] };
}

/** Saves a new version of the lead's first-touch draft (idempotent per lead + version). */
export async function saveDraft(
  ctx: WorkerCtx,
  lead: LeadBundle,
  draft: DraftOutput,
  meta: { evidenceIds: string[]; claimCheck: Record<string, unknown>; flags: string[]; passed: boolean; offerId: string | null; caseStudyId: string | null },
) {
  const { data: last } = await ctx.db.from("email_drafts").select("version").eq("campaign_lead_id", lead.id).eq("step", 0).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const row = {
    campaign_lead_id: lead.id,
    step: 0,
    version,
    subject: draft.subject.trim(),
    body_text: draft.body_text.trim(),
    body_hash: bodyHash(draft.subject.trim(), draft.body_text.trim()),
    facts: meta.evidenceIds as unknown as Json,
    claim_check: meta.claimCheck as Json,
    quality_score: meta.passed ? 100 : Math.max(0, 70 - 10 * meta.flags.length),
    warnings: meta.flags,
    status: "needs_review",
    inbox_id: lead.campaigns?.inbox_id ?? null,
    idempotency_key: draftKey(lead.id, 0, version),
  };
  const saved = must(await ctx.db.from("email_drafts").upsert(row, { onConflict: "idempotency_key" }).select("id, version").single(), "save draft");
  must(await ctx.db.from("campaign_leads").update({ offer_id: meta.offerId, case_study_id: meta.caseStudyId }).eq("id", lead.id), "link offer to lead");
  return saved;
}
