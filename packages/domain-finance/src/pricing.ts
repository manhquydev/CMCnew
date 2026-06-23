/** Pure receipt pricing logic for Phase 3 (Doanh thu).
 *
 * The DB enforces atomicity (voucher consume `UPDATE … WHERE used_count < max_uses`,
 * 0-row = CONFLICT) and effective-dated price selection at write time; this module is the
 * deterministic money math: pick the price in effect on a date, stack the year-tier discount
 * with a voucher under the 35% cap, and compute the net. All amounts are integer VND. */

/** Total discount can never exceed this, however tier + voucher stack (charter §4). */
export const DISCOUNT_CAP_PERCENT = 35;

/** Year-prepaid → discount %: 1y=15, 2y=20, 3y=30 (charter default; configurable per facility). */
export interface DiscountTier {
  years: number;
  percent: number;
}
export const DEFAULT_DISCOUNT_TIERS: readonly DiscountTier[] = [
  { years: 1, percent: 15 },
  { years: 2, percent: 20 },
  { years: 3, percent: 30 },
];

export interface CoursePriceLike {
  /** Inclusive start of this price's validity. */
  effectiveFrom: Date;
  /** Integer VND. */
  amount: number;
}

function assertVndAmount(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer VND, got ${n}`);
  }
}

function assertPercent(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error(`${label} must be an integer 0..100, got ${n}`);
  }
}

/**
 * The price in effect on `asOf` = the latest record whose `effectiveFrom` is on or before
 * `asOf`. Returns null when no price has taken effect yet. Per spec, the receipt resolves
 * its gross from this against the receipt's creation date.
 */
export function resolvePrice(prices: readonly CoursePriceLike[], asOf: Date): number | null {
  const cutoff = asOf.getTime();
  let best: CoursePriceLike | null = null;
  for (const p of prices) {
    if (p.effectiveFrom.getTime() > cutoff) continue;
    if (!best || p.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = p;
  }
  return best ? best.amount : null;
}

/** Discount % for a number of prepaid years. Throws if no tier matches (caller validates 1..3). */
export function tierPercentForYears(
  years: number,
  tiers: readonly DiscountTier[] = DEFAULT_DISCOUNT_TIERS,
): number {
  const tier = tiers.find((t) => t.years === years);
  if (!tier) throw new Error(`no discount tier for ${years} year(s)`);
  return tier.percent;
}

/** Stack tier + voucher, then cap at 35% (charter: cộng dồn rồi cap về 35%). */
export function effectiveDiscountPercent(
  tierPercent: number,
  voucherPercent = 0,
  cap = DISCOUNT_CAP_PERCENT,
): number {
  assertPercent(tierPercent, 'tierPercent');
  assertPercent(voucherPercent, 'voucherPercent');
  return Math.min(tierPercent + voucherPercent, cap);
}

/** Net = gross × (1 − effectiveDiscount/100), rounded to the nearest VND. */
export function netAmount(gross: number, effectiveDiscount: number): number {
  assertVndAmount(gross, 'gross');
  assertPercent(effectiveDiscount, 'effectiveDiscount');
  return Math.round((gross * (100 - effectiveDiscount)) / 100);
}

export interface ReceiptPricing {
  grossAmount: number;
  tierPercent: number;
  voucherPercent: number;
  effectiveDiscountPercent: number;
  netAmount: number;
}

/**
 * End-to-end receipt pricing from a resolved gross, prepaid years, and an optional voucher %.
 * Single source of truth so the router and any preview UI agree byte-for-byte.
 */
export function priceReceipt(input: {
  gross: number;
  years: number;
  voucherPercent?: number;
  tiers?: readonly DiscountTier[];
}): ReceiptPricing {
  assertVndAmount(input.gross, 'gross');
  const tierPercent = tierPercentForYears(input.years, input.tiers);
  const voucherPercent = input.voucherPercent ?? 0;
  const effective = effectiveDiscountPercent(tierPercent, voucherPercent);
  return {
    grossAmount: input.gross,
    tierPercent,
    voucherPercent,
    effectiveDiscountPercent: effective,
    netAmount: netAmount(input.gross, effective),
  };
}
