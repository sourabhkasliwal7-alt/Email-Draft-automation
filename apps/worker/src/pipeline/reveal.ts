import { REVEAL_FLAGS, istDayStartIso, istMonthStartIso, revealDecision, type SkipReason, type WorkflowConfig } from "@outreach/core";
import type { Json } from "@outreach/db";
import type { WorkerCtx } from "../ctx";
import { suppressionHalt } from "../jobs/suppression";
import { must, type LeadBundle } from "./common";

type Paid = ReturnType<typeof import("../spend").makeSpender>;

export type RevealOutcome = { ok: true; email: string; revealed: boolean } | { ok: false; reason: SkipReason; detail: string };

/** Credits used so far today / this month (IST). Mock and live rows are counted separately so a test run never eats the real budget. */
export async function creditsUsed(ctx: WorkerCtx, now = new Date()): Promise<{ today: number; month: number }> {
  const mock = ctx.modes.apollo === "mock";
  const sum = async (since: string) => {
    const rows = must(await ctx.db.from("credit_ledger").select("credits").eq("is_mock", mock).gte("started_at", since).in("status", ["started", "done", "uncertain"]), "load credit ledger");
    return rows.reduce((a, r) => a + r.credits, 0);
  };
  return { today: await sum(istDayStartIso(now)), month: await sum(istMonthStartIso(now)) };
}

async function apolloPersonId(ctx: WorkerCtx, contactId: string): Promise<string | null> {
  const { data } = await ctx.db.from("enrichment_results").select("result").eq("contact_id", contactId).eq("provider", "apollo").limit(1).maybeSingle();
  return (data?.result as { person_id?: string } | null)?.person_id ?? null;
}

/**
 * THE ONLY PLACE an Apollo email is revealed (SRS 4.3). It reveals only for an approved lead, never twice for the same
 * person, never past the daily/monthly credit caps, never for a suppressed contact, and always with phone, personal
 * email and waterfall switched off. A ledger row is written before the call and completed after it; if the call dies
 * half-way the row stays "started"/"uncertain" and the person is never revealed again automatically.
 */
export async function revealWithGuard(ctx: WorkerCtx, paid: Paid, lead: LeadBundle, cfg: WorkflowConfig, batchId: string, dryRun: boolean): Promise<RevealOutcome> {
  const contact = lead.contacts!;
  if (contact.email) return { ok: true, email: contact.email, revealed: false };

  const { data: prior } = await ctx.db.from("credit_ledger").select("id, status, started_at").eq("contact_id", contact.id).eq("provider", "apollo").maybeSingle();
  if (prior) {
    if (prior.status === "started" || prior.status === "uncertain") {
      await ctx.db.from("credit_ledger").update({ status: "uncertain", finished_at: new Date().toISOString(), error: "the earlier reveal did not finish; not retried automatically" }).eq("id", prior.id);
      return { ok: false, reason: "credit-uncertain", detail: "an earlier reveal did not finish" };
    }
    return { ok: false, reason: "no-email", detail: "already revealed once; no email came back" };
  }

  const personId = await apolloPersonId(ctx, contact.id);
  if (!personId) return { ok: false, reason: "no-email", detail: "no Apollo id on this contact" };

  const halt = await suppressionHalt(ctx, lead);
  const used = await creditsUsed(ctx);
  const decision = revealDecision({
    approved: lead.status === "approved", alreadyRevealed: false, suppressed: Boolean(halt), creditsToday: used.today, creditsThisMonth: used.month,
    dailyCap: cfg.daily_reveal_cap, monthlyCap: cfg.monthly_credit_cap, dryRun,
  });
  if (!decision.allow) {
    const reason: SkipReason = decision.reason === "suppressed" ? "suppressed" : decision.reason === "daily_cap" || decision.reason === "monthly_cap" ? "credit-cap" : decision.reason === "dry_run" ? "dry-run" : "manual";
    return { ok: false, reason, detail: decision.reason };
  }

  const mock = ctx.modes.apollo === "mock";
  const { data: row, error } = await ctx.db
    .from("credit_ledger")
    .insert({ contact_id: contact.id, campaign_lead_id: lead.id, batch_id: batchId, provider: "apollo", apollo_person_id: personId, status: "started", credits: 1, flags: REVEAL_FLAGS as unknown as Json, is_mock: mock })
    .select("id")
    .single();
  if (error) return { ok: false, reason: "no-email", detail: error.code === "23505" ? "another run is revealing this person" : error.message };

  let email: string | null = null;
  try {
    const res = await paid("apollo", "reveal_email", () => ctx.adapters.apollo.revealEmail({ personId, flags: REVEAL_FLAGS }));
    email = res.email;
  } catch (e) {
    const capped = (e as Error).name === "CapReachedError" || (e as Error).name === "MissingPriceError";
    // a refused call (our own cap) spent nothing; any other failure might have
    await ctx.db.from("credit_ledger").update({ status: capped ? "failed" : "uncertain", credits: capped ? 0 : 1, finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 300) }).eq("id", row.id);
    if (capped) throw e;
    return { ok: false, reason: "credit-uncertain", detail: (e as Error).message.slice(0, 120) };
  }

  if (!email) {
    await ctx.db.from("credit_ledger").update({ status: "no_email", credits: 0, finished_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, reason: "no-email", detail: "Apollo returned no email" };
  }
  const saved = await ctx.db.from("contacts").update({ email }).eq("id", contact.id);
  await ctx.db.from("credit_ledger").update({ status: "done", credits: 1, finished_at: new Date().toISOString() }).eq("id", row.id);
  if (saved.error) return { ok: false, reason: "duplicate", detail: saved.error.code === "23505" ? "that email belongs to another contact" : saved.error.message };
  await ctx.db.from("enrichment_results").insert({ contact_id: contact.id, provider: "apollo", result: { person_id: personId, revealed: true } as Json, credits_used: 1 });
  return { ok: true, email, revealed: true };
}
