/** Vietnam personal income tax (TNCN) — monthly progressive scale, 7 brackets, applied
 * per-portion (not a flat top-rate). All amounts integer VND. Reliefs are configurable
 * constants (2026 statutory defaults). */

export interface TaxBracket {
  /** Upper bound of taxable income for this bracket (VND/month); null = no upper bound. */
  upTo: number | null;
  rate: number; // 0..1
}

/** 7-bracket monthly scale (thu nhập tính thuế). */
export const PIT_BRACKETS: readonly TaxBracket[] = [
  { upTo: 5_000_000, rate: 0.05 },
  { upTo: 10_000_000, rate: 0.1 },
  { upTo: 18_000_000, rate: 0.15 },
  { upTo: 32_000_000, rate: 0.2 },
  { upTo: 52_000_000, rate: 0.25 },
  { upTo: 80_000_000, rate: 0.3 },
  { upTo: null, rate: 0.35 },
];

/** Giảm trừ gia cảnh (statutory): bản thân + mỗi người phụ thuộc, per month. */
export const SELF_RELIEF = 11_000_000;
export const DEPENDENT_RELIEF = 4_400_000;

function assertNonNegInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer, got ${n}`);
}

/** Taxable income = gross − insurance − self relief − dependent relief, floored at 0.
 *  Reliefs default to the statutory constants but may be overridden by an effective policy. */
export function taxableIncome(
  gross: number,
  insuranceDeduction: number,
  dependents: number,
  selfRelief: number = SELF_RELIEF,
  dependentRelief: number = DEPENDENT_RELIEF,
): number {
  assertNonNegInt(gross, 'gross');
  assertNonNegInt(insuranceDeduction, 'insuranceDeduction');
  assertNonNegInt(dependents, 'dependents');
  const relief = selfRelief + dependentRelief * dependents;
  return Math.max(0, gross - insuranceDeduction - relief);
}

/** Progressive monthly PIT on taxable income (rounded to VND). */
export function computePit(taxable: number, brackets: readonly TaxBracket[] = PIT_BRACKETS): number {
  assertNonNegInt(taxable, 'taxable');
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (taxable <= lower) break;
    const portion = Math.min(taxable, upper) - lower;
    tax += portion * b.rate;
    lower = upper;
  }
  return Math.round(tax);
}
