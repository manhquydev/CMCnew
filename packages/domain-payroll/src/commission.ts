/** Sales-block commission + teaching overtime — pure rate tables.
 *  COMMISSION follows PA2 (the chosen policy — "Mẫu đánh giá KPI -kinh doanh" 17/06/2026,
 *  transcribed in docs/reference/mau-kpi-kinh-doanh-2026-pa2.md): commission is a function of
 *  QUOTA ATTAINMENT (% of monthly target), not absolute revenue. OVERTIME & PARTTIME come from
 *  the teaching-block decision (docs/reference/co-cau-thu-nhap-khoi-dao-tao-2026.md), unaffected
 *  by the PA1/PA2 split. All amounts VND integer; rates are fractions (0.01 = 1%).
 *  Boundary convention follows the published bands: "100-120%" is inclusive of 1.2; ">120-≤150%"
 *  covers (1.2, 1.5]; ">150%" is the top band. */

export type SalesRole = 'cvtv' | 'tpkd' | 'gdtt';

/** New-customer commission RATE by quota attainment (1 = 100% of the monthly target).
 *  CVTV: <50%→0 · 50–<80%→1% · 80–<100%→2% · 100–120%→3% · >120–150%→4% · >150%→4.5%. */
export function cvtvNewCustomerRate(quotaRatio: number): number {
  if (quotaRatio < 0) throw new Error('quotaRatio must be >= 0');
  if (quotaRatio < 0.5) return 0;
  if (quotaRatio < 0.8) return 0.01;
  if (quotaRatio < 1.0) return 0.02;
  if (quotaRatio <= 1.2) return 0.03;
  if (quotaRatio <= 1.5) return 0.04;
  return 0.045;
}

export type ManagerRole = 'tpkd' | 'gdtt';

/** New-customer commission RATE for a manager by quota attainment.
 *  TPKD: <80%→0 · 80–<100%→0.6% · 100–120%→1% · >120–150%→1.2% · >150%→1.5%.
 *  GĐTT: <80%→0 · 80–<100%→0.4% · 100–120%→0.6% · >120–150%→0.8% · >150%→1%. */
export function managerNewCustomerRate(role: ManagerRole, quotaRatio: number): number {
  if (quotaRatio < 0) throw new Error('quotaRatio must be >= 0');
  if (quotaRatio < 0.8) return 0;
  if (role === 'tpkd') {
    if (quotaRatio < 1.0) return 0.006;
    if (quotaRatio <= 1.2) return 0.01;
    if (quotaRatio <= 1.5) return 0.012;
    return 0.015;
  }
  if (quotaRatio < 1.0) return 0.004;
  if (quotaRatio <= 1.2) return 0.006;
  if (quotaRatio <= 1.5) return 0.008;
  return 0.01;
}

export type RenewalRole = 'cvtv' | 'tpkd' | 'gdtt' | 'gv' | 'cskh';

/** Renewal (tái tục) commission RATE — PA2 uses a FLAT rate per role, gated by the centre's
 *  retention rate being ≥ 50% (below that, no renewal commission). Rates (primary "% Thưởng"):
 *  CVTV 2.2% · TPKD 0.5% · GĐTT 0.5% · GV/TNGV 1% · CSKH 0.8%. */
export function renewalRate(role: RenewalRole, centreRetentionRatio: number): number {
  if (centreRetentionRatio < 0) throw new Error('retention ratio must be >= 0');
  if (centreRetentionRatio < 0.5) return 0;
  switch (role) {
    case 'cvtv': return 0.022;
    case 'tpkd': return 0.005;
    case 'gdtt': return 0.005;
    case 'gv': return 0.01;
    case 'cskh': return 0.008;
  }
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
