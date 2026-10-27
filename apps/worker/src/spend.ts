import type { AdapterName, Usage } from "@outreach/adapters";
import { MissingPriceError, PROVIDER_FOR_ADAPTER, computeCostUsd, usageKey, type PipelineAdapterName, type PriceRow } from "@outreach/core";
import type { WorkerCtx } from "./ctx";

export class CapReachedError extends Error {
  constructor(public readonly detail: Record<string, unknown>) {
    super(`Spend cap reached: ${JSON.stringify(detail)}`);
    this.name = "CapReachedError";
  }
}

/**
 * Reservation sizes for the cap check ONLY (what we hold back before a live call). The recorded cost is always
 * usage x price_table; these numbers never appear in reports.
 */
const RESERVE_USD: Record<string, number> = { anthropic: 0.05, serper: 0.002, apollo: 0.1, verifier: 0.01, crunchbase: 0.05, fetcher: 0 };

async function loadPrices(ctx: WorkerCtx): Promise<PriceRow[]> {
  const { data, error } = await ctx.db.from("price_table").select("provider, unit, usd_per_unit, effective_from");
  if (error) throw new Error(`load prices: ${error.message}`);
  return data.map((p) => ({ provider: p.provider, unit: p.unit, usdPerUnit: Number(p.usd_per_unit), effectiveFrom: new Date(p.effective_from) }));
}

export interface SpendScope {
  campaignId: string | null;
  leadId: string | null;
  jobId: string;
  step: string;
}

/**
 * Every paid call goes through this. Before the call it reserves the estimated cost against the daily/monthly caps
 * (global, provider, campaign) in one atomic database function; after the call it records the real units and the cost
 * computed from the editable price table. Mock adapters are recorded too, at $0, so usage is visible.
 * At a cap it throws CapReachedError (the job fails with that reason; nothing is spent).
 */
export function makeSpender(ctx: WorkerCtx, scope: SpendScope) {
  let seq = 0;
  let prices: PriceRow[] | null = null;
  return async function paid<T extends { usage: Usage }>(adapter: PipelineAdapterName & AdapterName, operation: string, call: () => Promise<T>): Promise<T> {
    const provider = PROVIDER_FOR_ADAPTER[adapter];
    const mock = ctx.modes[adapter] === "mock";
    const idem = usageKey(scope.jobId, scope.step, provider, operation, seq++);
    const reserve = mock ? 0 : (RESERVE_USD[provider] ?? 0);

    if (!mock) {
      // no price row for this provider = no live call (costs come from the price table, never from code)
      prices ??= await loadPrices(ctx);
      if (!prices.some((p) => p.provider === provider)) throw new MissingPriceError(provider, "*");
    }

    if (!ctx.pg) {
      if (!mock) throw new Error(`DATABASE_URL is required for live ${adapter} calls (spend-cap guard)`);
      const result = await call();
      await ctx.db.from("usage_records").upsert(
        { provider, operation, units: result.usage.units, cost_usd: 0, campaign_id: scope.campaignId, campaign_lead_id: scope.leadId, job_id: scope.jobId, idempotency_key: idem, status: "recorded", is_mock: true, step: scope.step },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      return result;
    }

    const { rows } = await ctx.pg.query("select private.reserve_spend($1,$2,$3,$4,$5,$6,$7,$8,$9) as r", [idem, provider, operation, reserve, scope.campaignId, scope.leadId, scope.jobId, scope.step, mock]);
    const reservation = rows[0].r as { ok: boolean; usage_id?: string } & Record<string, unknown>;
    if (!reservation.ok) throw new CapReachedError(reservation);
    const usageId = reservation.usage_id!;

    let result: T;
    try {
      result = await call();
    } catch (e) {
      await ctx.pg.query("select private.release_spend($1)", [usageId]);
      throw e;
    }
    let cost = 0;
    if (!mock) {
      prices ??= await loadPrices(ctx);
      try {
        cost = computeCostUsd(provider, result.usage.units, prices);
      } catch (e) {
        if (e instanceof MissingPriceError) cost = 0; // already paid: record the usage and surface the missing price in the log
        ctx.log(`missing price: ${(e as Error).message}`);
      }
    }
    await ctx.pg.query("select private.settle_spend($1,$2,$3)", [usageId, JSON.stringify(result.usage.units), cost]);
    return result;
  };
}
