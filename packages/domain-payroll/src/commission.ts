/** Sales-block commission + teaching overtime — pure rate tables from the 2026 income-structure
 *  decisions (source: "Cơ cấu thu nhập CMC 2026"; summarised in docs/specs/phase-04-payroll.md).
 *  Every amount is VND integer. Rates are fractions (0.01 = 1%). Tier boundaries follow the
 *  published tables; where the source leaves a gap at a boundary we take the lower band inclusive
 *  on its upper edge and the next band exclusive on its lower edge (documented per function). */

const M = 1_000_000;

/** New-customer commission RATE for a CVTV (chuyên viên tư vấn), tiered by monthly collected
 *  revenue (VND). Bands in triệu đồng: <50→0% · 50–≤80→1% · >80–≤100→2% · >100–≤160→3% ·
 *  >160–≤240→4% · >240→5%. Boundary: an exact tier edge (e.g. 100tr) takes the lower band. */
export function cvtvNewCustomerRate(revenueVnd: number): number {
  const m = revenueVnd / M;
  if (m < 50) return 0;
  if (m <= 80) return 0.01;
  if (m <= 100) return 0.02;
  if (m <= 160) return 0.03;
  if (m <= 240) return 0.04;
  return 0.05;
}

export type ManagerRole = 'tpkd' | 'gdtt';

/** New-customer commission RATE for a manager, by quota attainment ratio (1 = 100% of quota).
 *  TPKD: <80%→0 · 80–<100%→0.7% · 100–<150%→1.0% · ≥150%→1.2%.
 *  GĐTT: <80%→0 · 80–<100%→0.6% · 100–<150%→0.8% · ≥150%→1.0%. */
export function managerNewCustomerRate(role: ManagerRole, quotaRatio: number): number {
  if (quotaRatio < 0) throw new Error('quotaRatio must be >= 0');
  if (quotaRatio < 0.8) return 0;
  if (role === 'tpkd') {
    if (quotaRatio < 1.0) return 0.007;
    if (quotaRatio < 1.5) return 0.01;
    return 0.012;
  }
  if (quotaRatio < 1.0) return 0.006;
  if (quotaRatio < 1.5) return 0.008;
  return 0.01;
}

export type RenewalRole = 'cvtv' | 'tpkd' | 'gdtt' | 'cskh';

/** Renewal (tái tục) commission RATE by retention-rate attainment (1 = 100% retention).
 *  CVTV: <50%→0 · 50–<70%→1.5% · 70–<90%→2% · ≥90%→2.2%.
 *  TPKD: <60%→0 · 60–<70%→0.7% · 70–<90%→0.8% · ≥90%→1%.
 *  GĐTT: <60%→0 · 60–<70%→0.6% · 70–<90%→0.7% · ≥90%→0.8%.
 *  CSKH: <60%→0 · 60–<70%→0.4% · 70–<90%→0.5% · ≥90%→0.6%. */
export function renewalRate(role: RenewalRole, retentionRatio: number): number {
  if (retentionRatio < 0) throw new Error('retentionRatio must be >= 0');
  const r = retentionRatio;
  if (role === 'cvtv') {
    if (r < 0.5) return 0;
    if (r < 0.7) return 0.015;
    if (r < 0.9) return 0.02;
    return 0.022;
  }
  if (r < 0.6) return 0;
  if (role === 'tpkd') {
    if (r < 0.7) return 0.007;
    if (r < 0.9) return 0.008;
    return 0.01;
  }
  if (role === 'gdtt') {
    if (r < 0.7) return 0.006;
    if (r < 0.9) return 0.007;
    return 0.008;
  }
  // cskh
  if (r < 0.7) return 0.004;
  if (r < 0.9) return 0.005;
  return 0.006;
}

/** Commission amount = collected revenue × rate, rounded to VND integer. */
export function commissionAmount(revenueVnd: number, rate: number): number {
  if (!Number.isInteger(revenueVnd) || revenueVnd < 0) throw new Error('revenue must be a non-negative integer VND');
  if (rate < 0) throw new Error('rate must be >= 0');
  return Math.round(revenueVnd * rate);
}

/** Teaching overtime unit price (VND/hour) by teacher grade (Phụ lục III). Grades above B4
 *  (lead teacher / director) are not tabled — callers pass an explicit unit price for those. */
export const TEACHER_OVERTIME_RATE: Readonly<Record<string, number>> = {
  B1: 100_000,
  B2: 120_000,
  B3: 130_000,
  B4: 150_000,
};

/** Overtime pay = overtime hours × unit price (rounded VND). Unit price is typically
 *  TEACHER_OVERTIME_RATE[grade]; hours are the hours beyond the grade's quota. */
export function overtimePay(hours: number, unitPriceVnd: number): number {
  if (hours < 0) throw new Error('hours must be >= 0');
  if (!Number.isInteger(unitPriceVnd) || unitPriceVnd < 0) throw new Error('unit price must be a non-negative integer VND');
  return Math.round(hours * unitPriceVnd);
}

/** Part-time package monthly gross (Phụ lục IV) — flat, not prorated by workdays. */
export const PARTTIME_PACKAGE: Readonly<Record<string, number>> = {
  PT3: 3_000_000,
  PT4: 4_000_000,
  PT5: 5_000_000,
};
