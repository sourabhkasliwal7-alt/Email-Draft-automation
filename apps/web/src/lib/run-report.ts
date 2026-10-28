import { parseWorkflowConfig, runReportCsv, runReportFileName, WORKFLOW_SETTINGS_KEY, type RunReportLead } from "@outreach/core";
import { gmailDraftUrl } from "@/lib/plain";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

const CHUNK = 100;
const FACT_TITLE = /^\[([a-z-]+)\] ([\s\S]*)$/;
const MAX_FACTS = 12;

const chunks = <T>(xs: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined && (x as unknown) !== ""))];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Everything the report needs for one lead, as the database returns it. Missing or odd values are fine: they become empty cells. */
export interface RawReportLead {
  lead: {
    status: string;
    reason_codes?: string[] | null;
    lead_score?: number | null;
    trigger?: string | null;
    trigger_date?: string | null;
    trigger_source?: string | null;
    lead_source?: string | null;
    source_detail?: string | null;
    score_components?: unknown;
  };
  contact?: { first_name?: string | null; last_name?: string | null; job_title?: string | null; email?: string | null; email_status?: string | null; profile_url?: string | null; country?: string | null; company_name?: string | null } | null;
  company?: { name?: string | null; domain?: string | null; country?: string | null; employee_count?: number | null; industry?: string | null } | null;
  facts?: { statement: string; url: string }[];
  draft?: { subject: string; body_text: string; claim_check?: unknown; gmail_draft_id?: string | null; gmail_message_id?: string | null } | null;
  mailbox?: string | null;
  offerName?: string | null;
  caseStudy?: string | null;
  costUsd?: number | null;
  cutoff?: number | null;
  wouldApprove?: boolean;
}

/** One database lead -> one report row's data. Pure: no database, no clock. */
export function toReportLead(raw: RawReportLead): RunReportLead {
  const sc = obj(raw.lead.score_components);
  const screen = obj(sc.screen);
  const research = obj(sc.research);
  const check = obj(research.facts_check);
  const comp = obj(sc.components);
  const c = raw.contact ?? {};
  const co = raw.company ?? {};
  const given = num(check.given);
  const kept = num(check.kept);
  const fit = str(screen.fit);
  const attempts = num(obj(raw.draft?.claim_check).attempts);
  const hasComponents = Object.keys(comp).length > 0;
  return {
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    jobTitle: c.job_title ?? null,
    email: c.email ?? null,
    emailStatus: c.email_status ?? null,
    profileUrl: c.profile_url ?? null,
    companyName: co.name ?? c.company_name ?? null,
    domain: co.domain ?? null,
    country: co.country ?? c.country ?? null,
    employeeCount: co.employee_count ?? null,
    industry: co.industry ?? null,
    businessType: str(screen.business_type),
    leadSource: raw.lead.lead_source ?? null,
    sourceDetail: raw.lead.source_detail ?? null,
    quickCheck: fit ? { fit, reason: str(screen.reason) ?? "" } : null,
    pagesVisited: strs(research.pages_visited),
    hiringRoles: strs(research.hiring_roles),
    facts: raw.facts ?? [],
    factsGiven: given,
    factsKept: kept,
    trigger: raw.lead.trigger ?? null,
    triggerDate: raw.lead.trigger_date ?? null,
    triggerUrl: raw.lead.trigger_source ?? null,
    score: raw.lead.lead_score ?? null,
    components: hasComponents ? { fit: num(comp.fit) ?? undefined, trigger: num(comp.trigger) ?? undefined, role: num(comp.role) ?? undefined, size: num(comp.size) ?? undefined, data: num(comp.data) ?? undefined } : null,
    cutoff: raw.cutoff ?? null,
    status: raw.lead.status,
    reasonCodes: raw.lead.reason_codes ?? [],
    wouldApprove: raw.wouldApprove ?? false,
    offerName: raw.offerName ?? null,
    caseStudy: raw.caseStudy ?? null,
    draft: raw.draft ? { subject: raw.draft.subject, body: raw.draft.body_text, attempts } : null,
    gmailLink: raw.draft?.gmail_draft_id && raw.mailbox ? gmailDraftUrl(raw.mailbox, raw.draft.gmail_message_id) : null,
    mailbox: raw.mailbox ?? null,
    costUsd: raw.costUsd ?? null,
  };
}

/** The leads of a run: the ones it worked on plus those skipped before the work list and the companies without a contact. */
export function runLeadIds(totals: unknown): string[] {
  const t = obj(totals);
  return unique([...strs(t.leadIds), ...strs(t.reportExtraIds)]);
}

/** Approved and drafted first, then the rest; the best score first inside each group. */
export function sortReportLeads(leads: RunReportLead[]): RunReportLead[] {
  const rank = (l: RunReportLead) => (l.status === "approved" || l.status === "draft_ready" ? 0 : l.status === "disqualified" ? 2 : 1);
  return [...leads].sort((a, b) => rank(a) - rank(b) || (b.score ?? -1) - (a.score ?? -1));
}

export interface LoadedRun {
  batch: { id: string; campaign_id: string; started_at: string; finished_at: string | null; totals: unknown; estimate: unknown };
  leads: RunReportLead[];
}

/** Loads a run and one row of data per lead, as the signed-in person (row level security applies). Null when the run does not exist. */
export async function loadRunReportLeads(supabase: Db, batchId: string): Promise<LoadedRun | null> {
  const { data: batch } = await supabase.from("pipeline_batches").select("id, campaign_id, started_at, finished_at, totals, estimate").eq("id", batchId).maybeSingle();
  if (!batch) return null;
  const totals = obj(batch.totals);
  const ids = runLeadIds(totals);
  const wouldApprove = new Set(strs(totals.wouldApprove));

  let cutoff = num(totals.approveCutoff);
  if (cutoff === null) {
    const { data: setting } = await supabase.from("settings").select("value").eq("key", WORKFLOW_SETTINGS_KEY).maybeSingle();
    cutoff = parseWorkflowConfig(setting?.value).approve_threshold;
  }

  type LeadRow = { id: string; contact_id: string; offer_id: string | null; case_study_id: string | null; status: string; contacts: (NonNullable<RawReportLead["contact"]> & { company_id?: string | null; companies?: RawReportLead["company"] }) | null } & RawReportLead["lead"];
  const leadRows: LeadRow[] = [];
  for (const part of chunks(ids)) {
    const { data } = await supabase.from("campaign_leads").select("*, contacts(*, companies(*))").in("id", part);
    leadRows.push(...((data ?? []) as unknown as LeadRow[]));
  }

  // latest first-step draft per lead (gmail_message_id is newer than the generated types, so whole rows are read)
  type DraftRow = { campaign_lead_id: string; step: number; version: number; subject: string; body_text: string; claim_check: unknown; gmail_draft_id: string | null; gmail_message_id?: string | null; inbox_id: string | null };
  const draftOf = new Map<string, DraftRow>();
  for (const part of chunks(ids)) {
    const { data } = await supabase.from("email_drafts").select("*").in("campaign_lead_id", part).eq("step", 0).order("version", { ascending: false });
    for (const d of (data ?? []) as unknown as DraftRow[]) if (!draftOf.has(d.campaign_lead_id)) draftOf.set(d.campaign_lead_id, d);
  }

  const lookup = async <T extends { id: string }>(table: "inboxes" | "offers" | "case_studies", select: string, wanted: string[]): Promise<Map<string, T>> => {
    const out = new Map<string, T>();
    for (const part of chunks(wanted)) {
      const { data } = await supabase.from(table).select(select).in("id", part);
      for (const r of (data ?? []) as unknown as T[]) out.set(r.id, r);
    }
    return out;
  };
  const inboxes = await lookup<{ id: string; email: string }>("inboxes", "id, email", unique([...draftOf.values()].map((d) => d.inbox_id)));
  const offers = await lookup<{ id: string; name: string }>("offers", "id, name", unique(leadRows.map((l) => l.offer_id)));
  const studies = await lookup<{ id: string; title: string }>("case_studies", "id, title", unique(leadRows.map((l) => l.case_study_id)));

  // verified facts: the stored evidence rows of each company, newest first
  const factsOf = new Map<string, { statement: string; url: string }[]>();
  const companyIds = unique(leadRows.map((l) => l.contacts?.company_id));
  for (const part of chunks(companyIds)) {
    const { data } = await supabase.from("evidence_items").select("company_id, title, url, retrieved_at").in("company_id", part).order("retrieved_at", { ascending: false });
    for (const e of data ?? []) {
      const m = FACT_TITLE.exec(e.title ?? "");
      if (!m) continue;
      const list = factsOf.get(e.company_id) ?? [];
      if (list.length < MAX_FACTS) list.push({ statement: m[2]!, url: e.url });
      factsOf.set(e.company_id, list);
    }
  }

  // cost per lead from the recorded usage (null when nothing was recorded for the lead)
  const cost = new Map<string, number>();
  for (const part of chunks(ids)) {
    const { data } = await supabase.from("usage_records").select("campaign_lead_id, cost_usd").in("campaign_lead_id", part);
    for (const u of data ?? []) if (u.campaign_lead_id) cost.set(u.campaign_lead_id, (cost.get(u.campaign_lead_id) ?? 0) + Number(u.cost_usd));
  }

  const leads = leadRows.map((l) => {
    const d = draftOf.get(l.id);
    return toReportLead({
      lead: l,
      contact: l.contacts,
      company: l.contacts?.companies ?? null,
      facts: l.contacts?.company_id ? (factsOf.get(l.contacts.company_id) ?? []) : [],
      draft: d ?? null,
      mailbox: d?.inbox_id ? (inboxes.get(d.inbox_id)?.email ?? null) : null,
      offerName: l.offer_id ? (offers.get(l.offer_id)?.name ?? null) : null,
      caseStudy: l.case_study_id ? (studies.get(l.case_study_id)?.title ?? null) : null,
      costUsd: cost.has(l.id) ? cost.get(l.id)! : null,
      cutoff,
      wouldApprove: wouldApprove.has(l.id),
    });
  });
  return { batch, leads: sortReportLeads(leads) };
}

/** The download: the CSV with its file name. 404 when the run does not exist. Pure, so it can be tested without a database. */
export function reportResponse(runId: string, loaded: LoadedRun | null, now = new Date()): Response {
  if (!loaded) return new Response("Not found", { status: 404 });
  return new Response(runReportCsv(loaded.leads), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${runReportFileName(runId, now)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** One compact line per lead for the run page (no facts, drafts or costs). */
export interface RunLeadLine {
  id: string;
  name: string;
  company: string;
  fit: string | null;
  businessType: string | null;
  reason: string | null;
  status: string;
  reasonCodes: string[];
}

/** The first `limit` leads of a run, with their quick-check result. `total` is how many the run has. */
export async function loadRunLeadLines(supabase: Db, totals: unknown, limit = 100): Promise<{ total: number; lines: RunLeadLine[] }> {
  const ids = runLeadIds(totals);
  const lines: RunLeadLine[] = [];
  for (const part of chunks(ids.slice(0, limit))) {
    const { data } = await supabase.from("campaign_leads").select("id, status, reason_codes, score_components, contacts(full_name, company_name, companies(name, domain))").in("id", part);
    for (const l of data ?? []) {
      const screen = obj(obj(l.score_components).screen);
      lines.push({
        id: l.id,
        name: l.contacts?.full_name ?? "",
        company: l.contacts?.companies?.name ?? l.contacts?.company_name ?? l.contacts?.companies?.domain ?? "",
        fit: str(screen.fit),
        businessType: str(screen.business_type),
        reason: str(screen.reason),
        status: l.status,
        reasonCodes: l.reason_codes,
      });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  lines.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { total: ids.length, lines };
}
