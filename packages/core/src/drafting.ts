import { z } from "zod";
import { normText } from "./research";

export const draftOutputSchema = z.object({
  subject: z.string().min(1),
  body_text: z.string().min(1),
  facts_used: z.array(z.object({ claim: z.string().min(1), evidence_id: z.string().min(1) })).default([]),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export const checkOutputSchema = z.object({ pass: z.boolean(), flags: z.array(z.string()).default([]) });

export interface EvidenceRef {
  id: string;
  snippet: string;
  url: string;
  /** ISO date of the underlying signal, when known */
  date?: string | null;
}

export interface DraftContext {
  firstName: string | null;
  company: string;
  jobTitle: string | null;
  offerName: string | null;
  offerClaims: string[];
  caseStudy: { title: string; summary: string | null; allowedNumbers: Record<string, number> } | null;
  cta: string | null;
  tone: string | null;
  signature: string;
  evidence: EvidenceRef[];
}

/** "Acme Logistics Pvt Ltd" -> "Acme Logistics" so prose reads naturally. */
export function trimCompanySuffix(name: string): string {
  return name.replace(/[,\s]+(pvt\.?\s*ltd\.?|private limited|ltd\.?|limited|inc\.?|llc|llp|gmbh|corp\.?|co\.?)$/i, "").trim();
}

export function buildDraftPrompt(ctx: DraftContext, feedback?: string[]): { system: string; prompt: string } {
  const system =
    "[task:draft] You write one short, plain, personal cold email (60-120 words). Use ONLY the evidence lines and offer facts given. " +
    "Never state a number, customer, funding amount or claim that is not in them. No links. No hype or guarantees. End with the CTA. " +
    'Return JSON {"subject":string,"body_text":string,"facts_used":[{"claim":string,"evidence_id":string}]} where each claim is copied from the evidence it uses.';
  const lines = [
    `FIRST_NAME: ${ctx.firstName ?? ""}`,
    `COMPANY: ${trimCompanySuffix(ctx.company)}`,
    `JOB_TITLE: ${ctx.jobTitle ?? ""}`,
    `OFFER: ${ctx.offerName ?? ""}`,
    `ALLOWED_CLAIMS: ${ctx.offerClaims.join(" | ")}`,
    `CASE_STUDY: ${ctx.caseStudy ? `${ctx.caseStudy.title} - ${ctx.caseStudy.summary ?? ""} ${JSON.stringify(ctx.caseStudy.allowedNumbers)}` : "none"}`,
    `TONE: ${ctx.tone ?? "plain, specific, short"}`,
    `CTA: ${ctx.cta ?? ""}`,
    `SIGNATURE: ${ctx.signature}`,
    ...ctx.evidence.slice(0, 3).map((e) => `EVIDENCE ${e.id}: ${e.snippet}`),
  ];
  if (feedback?.length) lines.push("FIX THESE PROBLEMS FROM THE LAST ATTEMPT:", ...feedback.map((f) => `- ${f}`));
  return { system, prompt: lines.join("\n") };
}

export function buildCheckPrompt(draft: DraftOutput, evidence: EvidenceRef[]): { system: string; prompt: string } {
  const system =
    '[task:check] You are a strict fact checker. Return JSON {"pass":boolean,"flags":string[]}. Fail if any CLAIM is not directly supported by an EVIDENCE line.';
  const lines = [
    ...evidence.map((e) => `EVIDENCE ${e.id}: ${e.snippet}`),
    ...draft.facts_used.map((f, i) => `CLAIM ${i + 1}: ${f.claim}`),
    "EMAIL:",
    draft.body_text,
  ];
  return { system, prompt: lines.join("\n") };
}

export const BANNED_PHRASES = ["guarantee", "100% free", "act now", "risk-free", "risk free", "limited time", "click here", "no obligation", "make money"];
const INTERNAL_TERMS = ["lead score", "lead_score", "icp", "campaign_lead", "evidence id", "[mock"];

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const numberTokens = (s: string) => (s.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/[,.]+$/, ""));

export interface CheckOptions {
  minWords?: number;
  maxWords?: number;
  now?: Date;
}

/**
 * Deterministic fact and quality check. Every flag is a hard fail: the draft goes to the reviewer with the flags, never
 * straight to Gmail. Invented facts are caught by (1) claim -> evidence id mapping, (2) claim text found in that
 * evidence, (3) every number in the email present in the evidence or the case study's allowed numbers.
 */
export function checkDraft(draft: DraftOutput, ctx: DraftContext, opts: CheckOptions = {}): { pass: boolean; flags: string[] } {
  const flags: string[] = [];
  const minWords = opts.minWords ?? 25;
  const maxWords = opts.maxWords ?? 160;
  const now = opts.now ?? new Date();
  const body = draft.body_text;
  const nBody = normText(body);

  if (!draft.subject.trim()) flags.push("subject_missing");
  else if (draft.subject.length > 90) flags.push("subject_too_long");

  const words = wordCount(body);
  if (words < minWords) flags.push(`too_short:${words}_words`);
  if (words > maxWords) flags.push(`too_long:${words}_words`);

  if (ctx.firstName && !new RegExp(`^\\s*(hi|hello|hey|dear)\\s+${ctx.firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(body)) {
    flags.push("greeting_name_mismatch");
  }

  const byId = new Map(ctx.evidence.map((e) => [e.id, e]));
  for (const f of draft.facts_used) {
    const ev = byId.get(f.evidence_id);
    if (!ev) flags.push(`claim_unknown_evidence:${f.evidence_id}`);
    else if (!normText(ev.snippet).includes(normText(f.claim)) && !normText(f.claim).includes(normText(ev.snippet))) flags.push(`claim_not_in_evidence:${f.evidence_id}`);
  }

  // every number must be traceable
  const allowed = new Set<string>();
  for (const e of ctx.evidence) numberTokens(e.snippet).forEach((n) => allowed.add(n));
  for (const v of Object.values(ctx.caseStudy?.allowedNumbers ?? {})) allowed.add(String(v));
  for (const c of ctx.offerClaims) numberTokens(c).forEach((n) => allowed.add(n));
  // digits that are part of the recipient's own record (company "Acme 2", signature, title) are not claims
  for (const own of [ctx.company, ctx.firstName ?? "", ctx.jobTitle ?? "", ctx.signature, ctx.offerName ?? ""]) numberTokens(own).forEach((n) => allowed.add(n));
  for (const n of numberTokens(body)) if (!allowed.has(n)) flags.push(`number_not_supported:${n}`);

  if (/https?:\/\/|www\./i.test(body)) flags.push("contains_link");
  for (const p of BANNED_PHRASES) if (nBody.includes(p)) flags.push(`banned_phrase:${p}`);
  for (const t of INTERNAL_TERMS) if (nBody.includes(t)) flags.push(`internal_term:${t}`);

  if (ctx.cta && !nBody.includes(normText(ctx.cta))) flags.push("cta_missing");

  if (/\brecent(ly)?\b/i.test(body)) {
    const dated = ctx.evidence.filter((e) => e.date).map((e) => new Date(e.date!));
    if (dated.length && dated.every((d) => now.getTime() - d.getTime() > 180 * 86_400_000)) flags.push("recency_claim_on_stale_evidence");
  }

  return { pass: flags.length === 0, flags };
}
