import { sha256Hex } from "@outreach/importer";
import {
  bracketNote,
  buildEmailCheckPrompt,
  buildWritePrompt,
  checkEmailCode,
  chooseCaseStudyByRules,
  chooseOfferByRules,
  draftKey,
  duplicateOf,
  emailCheckPasses,
  emailCheckSchema,
  firstSentence,
  parseJsonLoose,
  senderIdentity,
  type LeadSignals,
  toolsFor,
  withFooter,
  writeSchema,
  type EmailCheck,
  type WorkflowConfig,
  type WriteContext,
  type WriteResult,
} from "@outreach/core";
import type { Json } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { must, type LeadBundle } from "./common";
import type { Fact } from "./stages";

type Paid = ReturnType<typeof import("../spend").makeSpender>;

export const bodyHash = (subject: string, body: string) => sha256Hex(new TextEncoder().encode(`${subject}\n${body}`));

/** What the offer rules look at for one lead: the quick check's business type, the company's industry and description, and the best trigger. */
export function leadSignals(lead: LeadBundle): LeadSignals {
  const sc = (lead.score_components ?? {}) as { screen?: { business_type?: string }; trigger_type?: string };
  const company = lead.contacts?.companies;
  return { businessType: sc.screen?.business_type ?? lead.icp_segment ?? null, industry: company?.industry ?? null, about: company?.summary ?? null, triggerType: sc.trigger_type ?? null };
}

/**
 * The offer for this lead, then the case study of that offer. Both are chosen by rules in code (packages/core/src/offers.ts), never by
 * the model: the campaign's offers in the order they were ticked, the default offer when no rule matches, and the case study whose
 * industries fit the company best.
 */
export async function chooseOffer(ctx: WorkerCtx, lead: LeadBundle) {
  const campaign = lead.campaigns;
  const ids = [...new Set([...(campaign?.offer_ids ?? []), ...(campaign?.offer_id ? [campaign.offer_id] : [])])];
  if (!ids.length) return { offer: null, caseStudy: null, offerReason: "This campaign has no offer." };
  const rows = must(await ctx.db.from("offers").select("id, name, match_terms, trigger_types").in("id", ids).is("deleted_at", null), "load offers");
  const live = ids.flatMap((id) => rows.filter((r) => r.id === id));
  const choice = chooseOfferByRules(live.map((o) => ({ id: o.id, name: o.name, matchTerms: o.match_terms, triggerTypes: o.trigger_types })), campaign?.offer_id ?? null, leadSignals(lead));
  const offer = live.find((o) => o.id === choice.offerId) ?? null;
  if (!offer) return { offer: null, caseStudy: null, offerReason: choice.reason };
  const studies = must(await ctx.db.from("case_studies").select("id, title, summary, allowed_numbers, industries").eq("offer_id", offer.id).is("deleted_at", null).order("created_at"), "load case studies");
  const picked = chooseCaseStudyByRules(studies.map((s) => ({ id: s.id, title: s.title, industries: s.industries })), leadSignals(lead));
  return { offer, caseStudy: studies.find((s) => s.id === picked.caseStudyId) ?? null, offerReason: choice.reason };
}

export interface WrittenEmail {
  subject: string;
  body: string; // with footer
  fact: Fact;
  checkTotal: number;
  warnings: string[];
  attempts: number;
  offerId: string | null;
  offerReason: string;
  caseStudyId: string | null;
}

/**
 * Writes the email from verified facts only, then checks it in code (W1-W8) and with a second model pass (C4, at
 * least 9 of 12 and no zero). One rewrite with the problems as feedback; a second failure returns the problems.
 */
export async function writeEmail(
  ctx: WorkerCtx,
  paid: Paid,
  cfg: WorkflowConfig,
  lead: LeadBundle,
  facts: Fact[],
  sender: { displayName: string | null; email: string | null },
  seen: { subject: string; opening: string }[],
): Promise<{ ok: true; email: WrittenEmail } | { ok: false; problems: string[] }> {
  const contact = lead.contacts!;
  const company = contact.companies!;
  const { offer, caseStudy, offerReason } = await chooseOffer(ctx, lead);
  // recorded at once, so the run page and report show the choice even when the email later fails its checks
  must(await ctx.db.from("campaign_leads").update({ offer_id: offer?.id ?? null, case_study_id: caseStudy?.id ?? null, offer_reason: offerReason }).eq("id", lead.id), "record the chosen offer");
  const businessType = (lead.score_components as { screen?: { business_type?: string } } | null)?.screen?.business_type ?? lead.icp_segment ?? "";
  const top = facts.slice(0, 3);
  const who = senderIdentity({ displayName: sender.displayName, email: sender.email, company: cfg.sender_company });
  const wctx: WriteContext = {
    firstName: contact.first_name ?? "", title: contact.job_title, company: company.name ?? company.domain, businessType, senderFirstName: who.firstName, senderName: who.name, senderCompany: who.company, offerName: offer?.name ?? null,
    caseStudy: caseStudy ? { code: caseStudy.id, title: caseStudy.title, summary: caseStudy.summary, allowedNumbers: caseStudy.allowed_numbers as Record<string, number> } : null,
    facts: top.map((f) => ({ id: f.evidenceId, type: f.type, statement: f.statement, quote: f.quote, sourceUrl: f.url })),
    tools: toolsFor(businessType, cfg.tools_by_industry, company.industry),
    config: { style_guide: cfg.style_guide, reference_emails: cfg.reference_emails, white_label_line: cfg.white_label_line, banned_phrases: cfg.banned_phrases },
  };
  const codeCtx = {
    facts: wctx.facts, firstName: wctx.firstName, company: wctx.company, caseStudyNumbers: Object.values(wctx.caseStudy?.allowedNumbers ?? {}), whiteLabelLine: cfg.white_label_line, bannedPhrases: cfg.banned_phrases,
    offerName: offer?.name ?? null, senderName: who.name, senderCompany: who.company,
  };

  let feedback: string[] = [];
  let problems: string[] = [];
  let previous: { subject: string; body: string } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // the rewrite is told the exact rules that failed (with the rule text) and sees its own last attempt
    const { system, prompt } = buildWritePrompt(wctx, feedback, previous);
    const res = await paid("llm", "write", () => ctx.adapters.llm.complete({ tier: "strong", model: cfg.model_write, system, prompt, maxTokens: 700 }));
    const parsed = writeSchema.safeParse(parseJsonLoose(res.text));
    if (!parsed.success) {
      problems = ["the writer returned unreadable output"];
      feedback = problems;
      continue;
    }
    const w: WriteResult = parsed.data;
    previous = { subject: w.subject, body: w.body };
    const flags = checkEmailCode(w, codeCtx);
    if (duplicateOf(w, seen)) flags.push("W8: subject or opening matches another draft in this run");

    let llm: EmailCheck | null = null;
    if (flags.length === 0) {
      const cp = buildEmailCheckPrompt(w, wctx);
      const cres = await paid("llm", "check_email", () => ctx.adapters.llm.complete({ tier: "cheap", model: cfg.model_screen, system: cp.system, prompt: cp.prompt, maxTokens: 300 }));
      const cparsed = emailCheckSchema.safeParse(parseJsonLoose(cres.text));
      if (cparsed.success) llm = cparsed.data;
      else flags.push("the email check returned unreadable output");
    }
    if (llm && !emailCheckPasses(llm)) {
      const weak = Object.entries(llm.scores).filter(([, v]) => v < 2).map(([k]) => k.replace(/_/g, " "));
      flags.push(`C4: score ${Object.values(llm.scores).reduce((a, b) => a + b, 0)}/12 (needs 9 with no zero); weak: ${weak.join(", ") || "none"}`, ...llm.problems);
    }
    if (flags.length === 0 && llm) {
      const usedId = w.fact_ids_used[0];
      const fact = top.find((f) => f.evidenceId === usedId) ?? top[0]!;
      seen.push({ subject: w.subject, opening: firstSentence(w.body) });
      return {
        ok: true,
        email: {
          subject: w.subject.trim(), body: withFooter(w.body, cfg.postal_address, cfg.optout_line), fact, checkTotal: Object.values(llm.scores).reduce((a, b) => a + b, 0), warnings: [], attempts: attempt,
          offerId: offer?.id ?? null, offerReason, caseStudyId: caseStudy?.id ?? null,
        },
      };
    }
    problems = flags;
    feedback = flags;
  }
  return { ok: false, problems };
}

/** Saves the draft as a new version (idempotent per lead + version). Gmail comes next, in the run job. */
export async function saveEmailDraft(ctx: WorkerCtx, lead: LeadBundle, e: WrittenEmail, inboxId: string | null) {
  const { data: last } = await ctx.db.from("email_drafts").select("version").eq("campaign_lead_id", lead.id).eq("step", 0).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const saved = must(
    await ctx.db
      .from("email_drafts")
      .upsert(
        {
          campaign_lead_id: lead.id, step: 0, version, subject: e.subject, body_text: e.body, body_hash: bodyHash(e.subject, e.body), facts: [e.fact.evidenceId] as unknown as Json,
          claim_check: { fact: { id: e.fact.evidenceId, statement: e.fact.statement, quote: e.fact.quote, url: e.fact.url }, checkTotal: e.checkTotal, attempts: e.attempts } as Json,
          quality_score: Math.round((e.checkTotal / 12) * 100), warnings: e.warnings, status: "draft", inbox_id: inboxId, idempotency_key: draftKey(lead.id, 0, version),
        },
        { onConflict: "idempotency_key" },
      )
      .select("id, version")
      .single(),
    "save draft",
  );
  must(await ctx.db.from("campaign_leads").update({ offer_id: e.offerId, case_study_id: e.caseStudyId, offer_reason: e.offerReason }).eq("id", lead.id), "link offer to lead");
  return saved;
}

export { bracketNote };
