export interface PriceRow {
  provider: string;
  unit: string;
  usdPerUnit: number;
  effectiveFrom: Date;
}

export class MissingPriceError extends Error {
  constructor(provider: string, unit: string) {
    super(`No price for ${provider}/${unit} in price_table; add it before making this call`);
    this.name = "MissingPriceError";
  }
}

/** Latest price at or before `at`; undefined when none. */
export function findPrice(prices: PriceRow[], provider: string, unit: string, at: Date): PriceRow | undefined {
  return prices
    .filter((p) => p.provider === provider && p.unit === unit && p.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}

/**
 * cost = sum(units[unit] * price(unit)). Costs are never hard-coded: every unit used must have a row in
 * the editable price table, otherwise this throws MissingPriceError (so no unpriced paid call goes through).
 */
export function computeCostUsd(
  provider: string,
  units: Record<string, number>,
  prices: PriceRow[],
  at: Date = new Date(),
): number {
  let total = 0;
  for (const [unit, qty] of Object.entries(units)) {
    if (qty === 0) continue;
    // A unit can name its model ("input_token@anthropic/claude-haiku-5.5") so two models with different prices are costed
    // correctly; without a row for that exact unit the plain unit ("input_token") is used.
    const p = findPrice(prices, provider, unit, at) ?? (unit.includes("@") ? findPrice(prices, provider, unit.slice(0, unit.indexOf("@")), at) : undefined);
    if (!p) throw new MissingPriceError(provider, unit);
    total += qty * p.usdPerUnit;
  }
  return Math.round(total * 1e6) / 1e6;
}
