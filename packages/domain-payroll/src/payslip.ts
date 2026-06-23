/** Pure payslip assembly: prorate by workdays, KPI grade → ratio, then gross → tax → net.
 * The DB enforces idempotency ((employee, periodKey)) and finalize gating; this is the math. */
import { taxableIncome, computePit } from './pit.js';

/** Prorate a monthly amount by actual workdays over the standard workdays (rounded VND). */
export function prorate(monthlyAmount: number, workdays: number, standardDays: number): number {
  if (!Number.isInteger(monthlyAmount) || monthlyAmount < 0) throw new Error('monthlyAmount must be a non-negative integer');
  if (!Number.isInteger(workdays) || workdays < 0) throw new Error('workdays must be a non-negative integer');
  if (!Number.isInteger(standardDays) || standardDays <= 0) throw new Error('standardDays must be a positive integer');
  return Math.round((monthlyAmount * workdays) / standardDays);
}

export type KpiGrade = 'A' | 'B' | 'C' | 'D';

/** KPI score (0–100) → grade + payout ratio (charter: A 100%, B 90%, C 80%, D 0%). */
export function kpiGradeFromScore(score: number): { grade: KpiGrade; ratio: number } {
  if (score < 0 || score > 100) throw new Error(`kpi score must be 0..100, got ${score}`);
  if (score >= 85) return { grade: 'A', ratio: 1.0 };
  if (score >= 70) return { grade: 'B', ratio: 0.9 };
  if (score >= 50) return { grade: 'C', ratio: 0.8 };
  return { grade: 'D', ratio: 0 };
}

export interface PayslipInput {
  baseSalary: number; // monthly base (LCB)
  mealAllowance: number;
  otherAllowance: number;
  kpiMax: number;
  kpiScore: number; // 0..100
  workdays: number;
  standardDays: number;
  /** Commission / overtime / other variable earnings entered for the period. */
  variablePay?: number;
  insuranceDeduction?: number;
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
  taxableIncome: number;
  pitAmount: number;
  netIncome: number;
}

/** Assemble a full payslip from a rate + period inputs. Single source of truth so the router,
 * any preview UI, and reports agree byte-for-byte. */
export function assemblePayslip(input: PayslipInput): PayslipResult {
  const baseEarned = prorate(input.baseSalary, input.workdays, input.standardDays);
  const allowanceEarned = prorate(input.mealAllowance + input.otherAllowance, input.workdays, input.standardDays);
  const { grade, ratio } = kpiGradeFromScore(input.kpiScore);
  if (!Number.isInteger(input.kpiMax) || input.kpiMax < 0) throw new Error('kpiMax must be a non-negative integer');
  const kpiBonus = Math.round(input.kpiMax * ratio);
  const variablePay = input.variablePay ?? 0;
  if (!Number.isInteger(variablePay) || variablePay < 0) throw new Error('variablePay must be a non-negative integer');
  const grossIncome = baseEarned + allowanceEarned + kpiBonus + variablePay;
  const insuranceDeduction = input.insuranceDeduction ?? 0;
  const dependents = input.dependents ?? 0;
  const taxable = taxableIncome(grossIncome, insuranceDeduction, dependents);
  const pitAmount = computePit(taxable);
  return {
    baseEarned,
    allowanceEarned,
    kpiGrade: grade,
    kpiRatio: ratio,
    kpiBonus,
    variablePay,
    grossIncome,
    insuranceDeduction,
    taxableIncome: taxable,
    pitAmount,
    netIncome: grossIncome - insuranceDeduction - pitAmount,
  };
}
