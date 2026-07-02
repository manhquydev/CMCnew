/** Pure payslip assembly: prorate by workdays, KPI grade → ratio, then gross → tax → net.
 * The DB enforces idempotency ((employee, periodKey)) and finalize gating; this is the math. */
import { taxableIncome, computePit } from './pit.js';
import { DEFAULT_PARAMS, type CompensationParams } from './params.js';

/** Prorate a monthly amount by actual workdays over the standard workdays (rounded VND). */
export function prorate(monthlyAmount: number, workdays: number, standardDays: number): number {
  if (!Number.isInteger(monthlyAmount) || monthlyAmount < 0) throw new Error('monthlyAmount must be a non-negative integer');
  if (!Number.isInteger(workdays) || workdays < 0) throw new Error('workdays must be a non-negative integer');
  if (!Number.isInteger(standardDays) || standardDays <= 0) throw new Error('standardDays must be a positive integer');
  return Math.round((monthlyAmount * workdays) / standardDays);
}

export type KpiGrade = string;

/** Which income-structure block's KPI band applies — training (khối Đào tạo) and sales (khối Kinh
 *  doanh) grade the same score differently. The band VALUES live in CompensationParams (editable). */
export type PayBlock = 'training' | 'sales';

/** KPI score (0–100) → grade + payout ratio, from the policy's band for `block`. Bands are
 *  evaluated high→low: the first band whose `minScore ≤ score` wins. Defaults to DEFAULT_PARAMS. */
export function kpiGradeFromScore(
  score: number,
  block: PayBlock = 'training',
  params: CompensationParams = DEFAULT_PARAMS,
): { grade: KpiGrade; ratio: number } {
  if (score < 0 || score > 100) throw new Error(`kpi score must be 0..100, got ${score}`);
  const bands = [...params.kpi[block]].sort((a, b) => b.minScore - a.minScore);
  for (const b of bands) {
    if (score >= b.minScore) return { grade: b.grade, ratio: b.ratio };
  }
  const last = bands[bands.length - 1]!;
  return { grade: last.grade, ratio: last.ratio };
}

export interface PayslipInput {
  baseSalary: number; // monthly base (LCB)
  mealAllowance: number;
  otherAllowance: number;
  kpiMax: number;
  kpiScore: number; // 0..100
  /** KPI band to apply (training vs sales). Defaults to training for backward compatibility. */
  block?: PayBlock;
  workdays: number;
  standardDays: number;
  /** Commission / overtime / other variable earnings entered for the period. */
  variablePay?: number;
  insuranceDeduction?: number;
  /** Attendance penalty deducted after tax. */
  attendanceDeduction?: number;
  dependents?: number;
}

export interface PayslipResult {
  baseEarned: number;
  allowanceEarned: number;
  kpiGrade: KpiGrade;
  kpiRatio: number;
  kpiBonus: number;
  variablePay: number;
  grossIncome: number;
  insuranceDeduction: number;
  attendanceDeduction: number;
  taxableIncome: number;
  pitAmount: number;
  netIncome: number;
}

/** Assemble a full payslip from a rate + period inputs. Single source of truth so the router,
 * any preview UI, and reports agree byte-for-byte. `params` defaults to DEFAULT_PARAMS; the API
 * passes the CompensationPolicy effective at the period so edits apply forward only. */
export function assemblePayslip(input: PayslipInput, params: CompensationParams = DEFAULT_PARAMS): PayslipResult {
  const baseEarned = prorate(input.baseSalary, input.workdays, input.standardDays);
  const allowanceEarned = prorate(input.mealAllowance + input.otherAllowance, input.workdays, input.standardDays);
  const { grade, ratio } = kpiGradeFromScore(input.kpiScore, input.block, params);
  if (!Number.isInteger(input.kpiMax) || input.kpiMax < 0) throw new Error('kpiMax must be a non-negative integer');
  const kpiBonus = Math.round(input.kpiMax * ratio);
  const variablePay = input.variablePay ?? 0;
  if (!Number.isInteger(variablePay) || variablePay < 0) throw new Error('variablePay must be a non-negative integer');
  const grossIncome = baseEarned + allowanceEarned + kpiBonus + variablePay;
  const insuranceDeduction = input.insuranceDeduction ?? 0;
  const attendanceDeduction = input.attendanceDeduction ?? 0;
  if (!Number.isInteger(attendanceDeduction) || attendanceDeduction < 0) {
    throw new Error('attendanceDeduction must be a non-negative integer');
  }
  const dependents = input.dependents ?? 0;
  const taxable = taxableIncome(grossIncome, insuranceDeduction, dependents, params.pit.selfRelief, params.pit.dependentRelief);
  const pitAmount = computePit(taxable, params.pit.brackets);
  return {
    baseEarned,
    allowanceEarned,
    kpiGrade: grade,
    kpiRatio: ratio,
    kpiBonus,
    variablePay,
    grossIncome,
    insuranceDeduction,
    attendanceDeduction,
    taxableIncome: taxable,
    pitAmount,
    // Floor at 0: a pathological attendance penalty exceeding post-tax net must never yield negative pay.
    netIncome: Math.max(0, grossIncome - insuranceDeduction - pitAmount - attendanceDeduction),
  };
}
