/**
 * Choosing the offer and the case study for a lead (SRS E7): by rules in code, never by the model.
 *
 * An offer lists the business types / industries / keywords it fits (`matchTerms`) and, optionally, the trigger types it fits best
 * (`triggerTypes`). Pure functions: no database, no clock, so the same lead always gets the same offer.
 */

/** The trigger types an offer can be tied to. The values are the trigger types the research step stores on a lead. */
export const OFFER_TRIGGER_TYPES = [
  { value: "hiring-developers", label: "Hiring developers" },
  { value: "funding", label: "Funding" },
  { value: "new-product", label: "Launch / new product" },
  { value: "expansion", label: "Expansion" },
  { value: "tech-change", label: "Technology change" },
  { value: "award", label: "Award" },
  { value: "public-talk", label: "Public talk" },
] as const;

export const triggerTypeLabel = (value: string): string => OFFER_TRIGGER_TYPES.find((t) => t.value === value)?.label ?? value;

export interface OfferRule {
  id: string;
  name: string;
  matchTerms: string[];
  triggerTypes: string[];
}

/** What is known about a lead when the offer is chosen. Every field may be missing. */
export interface LeadSignals {
  /** from the quick check, e.g. "Web design agency" */
  businessType?: string | null;
  /** the company's industry from the lead source */
  industry?: string | null;
  /** a short description of the company, if stored */
  about?: string | null;
  /** the lead's best trigger type, e.g. "hiring-developers" ("none" or empty = no trigger) */
  triggerType?: string | null;
}

export interface OfferChoice {
  offerId: string | null;
  /** plain words, stored on the lead and shown on the run page and in the run report */
  reason: string;
  how: "rule" | "default" | "only-offer" | "none";
}

export interface CaseStudyRule {
  id: string;
  title: string;
  industries: string[];
}

export interface CaseStudyChoice {
  caseStudyId: string | null;
  reason: string;
}

// ---------------------------------------------------------------- term matching
/** "Web-design Agencies" -> ["web", "design", "agency"]: lower case, punctuation ignored, plural endings removed. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** True when all the words of `term` appear next to each other, in order, among the words of `text`. */
export function termMatches(term: string, text: string | null | undefined): boolean {
  const t = wordsOf(term);
  if (!t.length || !text) return false;
  const h = wordsOf(text);
  for (let i = 0; i + t.length <= h.length; i++) if (t.every((w, k) => h[i + k] === w)) return true;
  return false;
}

const FIELDS = [
  { key: "businessType", label: "business type", weight: 3 },
  { key: "industry", label: "industry", weight: 2 },
  { key: "about", label: "company description", weight: 1 },
] as const;

interface TermHit {
  term: string;
  field: string;
  weight: number;
}

/** Each of the offer's terms, counted once, at the strongest field it appears in. */
function termHits(terms: string[], lead: LeadSignals): TermHit[] {
  const hits: TermHit[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const term = raw.trim();
    const key = wordsOf(term).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const f = FIELDS.find((x) => termMatches(term, lead[x.key]));
    if (f) hits.push({ term, field: f.label, weight: f.weight });
  }
  return hits;
}

const TRIGGER_WEIGHT = 2;
const triggerOf = (lead: LeadSignals): string => {
  const t = (lead.triggerType ?? "").trim();
  return t === "none" ? "" : t;
};

const quoteList = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");

function describeLead(lead: LeadSignals): string {
  const parts = [lead.businessType && `business type "${lead.businessType}"`, lead.industry && `industry "${lead.industry}"`].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing known about the business";
}

// ---------------------------------------------------------------- the offer
/**
 * Picks the offer for one lead.
 *
 * - One offer on the campaign: that offer, no rules needed.
 * - An offer qualifies when one of its terms matches the lead (business type, industry or description). An offer that lists no terms
 *   but lists trigger types qualifies when the lead's trigger is one of them. A trigger match also adds weight to an offer that
 *   qualifies by terms. An offer with no rules never qualifies by itself.
 * - Highest weight wins (business type 3, industry 2, description 1 per term; trigger +2). A tie goes to the default offer if it is
 *   among the tied offers, otherwise to the one listed first.
 * - Nothing qualifies: the default offer. A default that is not in the list (e.g. it was archived) falls back to the first offer.
 *
 * `offers` is in campaign order and holds only live offers.
 */
export function chooseOfferByRules(offers: OfferRule[], defaultOfferId: string | null, lead: LeadSignals): OfferChoice {
  if (!offers.length) return { offerId: null, how: "none", reason: "This campaign has no offer." };
  if (offers.length === 1) return { offerId: offers[0]!.id, how: "only-offer", reason: "The only offer on this campaign." };

  const trigger = triggerOf(lead);
  type Scored = { offer: OfferRule; weight: number; hits: TermHit[]; triggerHit: boolean };
  const scored: Scored[] = [];
  for (const offer of offers) {
    const hits = termHits(offer.matchTerms, lead);
    const triggerHit = Boolean(trigger) && offer.triggerTypes.includes(trigger);
    const hasTerms = offer.matchTerms.some((t) => wordsOf(t).length);
    const qualifies = hasTerms ? hits.length > 0 : triggerHit;
    if (!qualifies) continue;
    scored.push({ offer, hits, triggerHit, weight: hits.reduce((n, h) => n + h.weight, 0) + (triggerHit ? TRIGGER_WEIGHT : 0) });
  }

  const fallback = offers.find((o) => o.id === defaultOfferId) ?? offers[0]!;
  if (!scored.length) {
    const why = defaultOfferId && fallback.id === defaultOfferId ? "the default offer" : "the first offer on the campaign (no default offer is set)";
    return { offerId: fallback.id, how: "default", reason: `No offer rule matched (${describeLead(lead)}); used ${why}, "${fallback.name}".` };
  }

  const top = Math.max(...scored.map((s) => s.weight));
  const tied = scored.filter((s) => s.weight === top);
  const win = tied.find((s) => s.offer.id === defaultOfferId) ?? tied[0]!;
  const bits: string[] = [];
  if (win.hits.length) {
    const fields = [...new Set(win.hits.map((h) => h.field))];
    bits.push(`matched ${quoteList(win.hits.map((h) => h.term))} in the ${fields.join(" / ")}`);
  }
  if (win.triggerHit) bits.push(`its trigger "${triggerTypeLabel(trigger)}" fits this offer`);
  const tieNote = tied.length > 1 ? ` (${tied.length} offers fit equally; ${win.offer.id === defaultOfferId ? "the default offer was kept" : "the first listed was used"})` : "";
  return { offerId: win.offer.id, how: "rule", reason: `${bits.join("; ")}${tieNote}.`.replace(/^./, (c) => c.toUpperCase()) };
}

// ---------------------------------------------------------------- the case study
/**
 * Picks the case study of the chosen offer the same way: the one whose industries match the lead best (business type 3, industry 2,
 * description 1 per matching industry); a tie goes to the first listed. Nothing matches: no case study (a case study that does not
 * fit the company is worse than none).
 */
export function chooseCaseStudyByRules(studies: CaseStudyRule[], lead: LeadSignals): CaseStudyChoice {
  if (!studies.length) return { caseStudyId: null, reason: "This offer has no case study." };
  let best: { study: CaseStudyRule; weight: number; hits: TermHit[] } | null = null;
  for (const study of studies) {
    const hits = termHits(study.industries, lead);
    const weight = hits.reduce((n, h) => n + h.weight, 0);
    if (weight > 0 && (!best || weight > best.weight)) best = { study, weight, hits };
  }
  if (!best) return { caseStudyId: null, reason: `No case study fits (${describeLead(lead)}).` };
  return { caseStudyId: best.study.id, reason: `Matched ${quoteList(best.hits.map((h) => h.term))} in the ${[...new Set(best.hits.map((h) => h.field))].join(" / ")}.` };
}
