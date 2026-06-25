import { DEFAULT_PARAMS, type CompensationParams } from './params.js';

/** Sales-block commission + teaching overtime (tài liệu "Cơ cấu thu nhập CMC 2026").
 *  CVTV new-customer commission = rate by ABSOLUTE monthly new revenue (tiered); renewal = rate by
 *  centre retention (tiered). Manager (TPKD/GĐTT) rates stay quota-attainment but are DEFERRED
 *  (team rollup, not wired in v1). Rate VALUES + thresholds come from CompensationParams (editable
 *  per effective-dated policy). All amounts VND integer. */

export type ManagerRole = 'tpkd' | 'gdtt';
export type RenewalRole = 'cvtv' | 'tpkd' | 'gdtt' | 'gv' | 'cskh';

/** CVTV new-customer band index (6 bands): <50 · 50–<80 · 80–<100 · 100–120 · >120–150 · >150
 *  (quota attainment %). Boundary: 100–120% includes 1.2; >120–150% covers (1.2,1.5]. */
function cvtvBandIndex(q: number): number {
  if (q < 0.5) return 0;
  if (q < 0.8) return 1;
  if (q < 1.0) return 2;
  if (q <= 1.2) return 3;
  if (q <= 1.5) return 4;
  return 5;
}

/** Manager new-customer band index (5 bands): <80 · 80–<100 · 100–120 · >120–150 · >150 (quota %). */
function managerBandIndex(q: number): number {
  if (q < 0.8) return 0;
  if (q < 1.0) return 1;
  if (q <= 1.2) return 2;
  if (q <= 1.5) return 3;
  return 4;
}

/** New-customer commission RATE for a CVTV by QUOTA-ATTAINMENT ratio (1 = 100% of target). Excel
 *  PHỤ LỤC 02 "Theo tỷ lệ hoàn thành chỉ tiêu của cá nhân" (nguồn chuẩn, chốt 2026-06-25). */
export function cvtvNewCustomerRate(quotaRatio: number, params: CompensationParams = DEFAULT_PARAMS): number {
  if (quotaRatio < 0) throw new Error('quotaRatio must be >= 0');
  return params.commission.cvtvNewRates[cvtvBandIndex(quotaRatio)] ?? 0;
}

/** New-customer commission RATE for a manager by quota attainment. DEFERRED (v1 CVTV-only). */
export function managerNewCustomerRate(role: ManagerRole, quotaRatio: number, params: CompensationParams = DEFAULT_PARAMS): number {
  if (quotaRatio < 0) throw new Error('quotaRatio must be >= 0');
  const rates = role === 'tpkd' ? params.commission.tpkdNewRates : params.commission.gdttNewRates;
  return rates[managerBandIndex(quotaRatio)] ?? 0;
}

/** Renewal commission RATE by centre retention ratio. CVTV uses the tiered table (tài liệu);
 *  other roles use a flat rate gated by retentionFloor (deferred refinement). */
export function renewalRate(role: RenewalRole, centreRetentionRatio: number, params: CompensationParams = DEFAULT_PARAMS): number {
  if (centreRetentionRatio < 0) throw new Error('retention ratio must be >= 0');
  if (role === 'cvtv') {
    const tiers = [...params.commission.cvtvRenewalTiers].sort((a, b) => b.minRetention - a.minRetention);
    for (const t of tiers) {
      if (centreRetentionRatio >= t.minRetention) return t.rate;
    }
    return 0;
  }
  if (centreRetentionRatio < params.commission.retentionFloor) return 0;
  return params.commission.renewal[role];
}

/** Commission amount = collected revenue × rate, rounded to VND integer. */
export function commissionAmount(revenueVnd: number, rate: number): number {
  if (!Number.isInteger(revenueVnd) || revenueVnd < 0) throw new Error('revenue must be a non-negative integer VND');
  if (rate < 0) throw new Error('rate must be >= 0');
  return Math.round(revenueVnd * rate);
}

/** Teaching overtime unit price (VND/hour) for a grade, from the policy (0 if grade not tabled). */
export function overtimeUnitPrice(grade: string, params: CompensationParams = DEFAULT_PARAMS): number {
  return params.overtimeRates[grade] ?? 0;
}

/** Overtime pay = overtime hours × unit price (rounded VND). */
export function overtimePay(hours: number, unitPriceVnd: number): number {
  if (hours < 0) throw new Error('hours must be >= 0');
  if (!Number.isInteger(unitPriceVnd) || unitPriceVnd < 0) throw new Error('unit price must be a non-negative integer VND');
  return Math.round(hours * unitPriceVnd);
}

/** Part-time package flat monthly gross from the policy (0 if package not tabled). */
export function parttimePackageGross(code: string, params: CompensationParams = DEFAULT_PARAMS): number {
  return params.parttimePackages[code] ?? 0;
}
