import { describe, it, expect } from 'vitest';
import {
  computePit,
  taxableIncome,
  SELF_RELIEF,
  prorate,
  kpiGradeFromScore,
  assemblePayslip,
} from './index.js';

describe('computePit (7-bracket progressive)', () => {
  it('is 0 at zero taxable', () => {
    expect(computePit(0)).toBe(0);
  });
  it('taxes only within the first bracket (5%)', () => {
    expect(computePit(5_000_000)).toBe(250_000); // 5M * 5%
  });
  it('crosses into the second bracket per-portion', () => {
    // 5M*5% + 3M*10% = 250k + 300k
    expect(computePit(8_000_000)).toBe(550_000);
  });
  it('matches a known mid-scale figure', () => {
    // taxable 20M: 250k + 500k + 1.2M(8M*15%) + 400k(2M*20%) = 2,350,000
    expect(computePit(20_000_000)).toBe(2_350_000);
  });
  it('applies 35% only to the portion above 80M', () => {
    // taxable 100M: full scale to 80M = 18,150,000; +20M*35% = 7,000,000 => 25,150,000
    expect(computePit(100_000_000)).toBe(25_150_000);
  });
});

describe('taxableIncome (reliefs)', () => {
  it('subtracts self relief and floors at 0', () => {
    expect(taxableIncome(SELF_RELIEF, 0, 0)).toBe(0);
    expect(taxableIncome(SELF_RELIEF - 1_000_000, 0, 0)).toBe(0);
  });
  it('subtracts dependent relief', () => {
    // 20M gross, 1 dependent: 20M - 11M - 4.4M = 4.6M
    expect(taxableIncome(20_000_000, 0, 1)).toBe(4_600_000);
  });
  it('subtracts insurance too', () => {
    expect(taxableIncome(20_000_000, 2_000_000, 0)).toBe(7_000_000);
  });
});

describe('prorate', () => {
  it('returns full amount at full attendance', () => {
    expect(prorate(5_700_000, 26, 26)).toBe(5_700_000);
  });
  it('halves at half attendance (rounded)', () => {
    expect(prorate(5_700_000, 13, 26)).toBe(2_850_000);
  });
  it('rejects zero standard days', () => {
    expect(() => prorate(1000, 1, 0)).toThrow();
  });
});

describe('kpiGradeFromScore', () => {
  it('grades A/B/C/D at the boundaries', () => {
    expect(kpiGradeFromScore(85)).toEqual({ grade: 'A', ratio: 1.0 });
    expect(kpiGradeFromScore(84)).toEqual({ grade: 'B', ratio: 0.9 });
    expect(kpiGradeFromScore(70)).toEqual({ grade: 'B', ratio: 0.9 });
    expect(kpiGradeFromScore(69)).toEqual({ grade: 'C', ratio: 0.8 });
    expect(kpiGradeFromScore(50)).toEqual({ grade: 'C', ratio: 0.8 });
    expect(kpiGradeFromScore(49)).toEqual({ grade: 'D', ratio: 0 });
  });
  it('rejects out-of-range scores', () => {
    expect(() => kpiGradeFromScore(101)).toThrow();
    expect(() => kpiGradeFromScore(-1)).toThrow();
  });
});

describe('assemblePayslip (end-to-end, teacher B1 full month, grade A)', () => {
  // GV bậc 1: LCB 5.7M, ăn trưa 500k, định mức 2.8M, KPI max 1M (from the real structure).
  const r = assemblePayslip({
    baseSalary: 5_700_000,
    mealAllowance: 500_000,
    otherAllowance: 2_800_000,
    kpiMax: 1_000_000,
    kpiScore: 90,
    workdays: 26,
    standardDays: 26,
  });

  it('earns full base + allowances at full attendance', () => {
    expect(r.baseEarned).toBe(5_700_000);
    expect(r.allowanceEarned).toBe(3_300_000);
  });
  it('pays full KPI bonus at grade A', () => {
    expect(r.kpiGrade).toBe('A');
    expect(r.kpiBonus).toBe(1_000_000);
  });
  it('grosses to 10,000,000 (matches the published total)', () => {
    expect(r.grossIncome).toBe(10_000_000);
  });
  it('has no PIT (gross under the 11M self relief)', () => {
    expect(r.taxableIncome).toBe(0);
    expect(r.pitAmount).toBe(0);
    expect(r.netIncome).toBe(10_000_000);
  });
});

describe('assemblePayslip (manager with variable pay → PIT applies)', () => {
  const r = assemblePayslip({
    baseSalary: 7_000_000,
    mealAllowance: 800_000,
    otherAllowance: 12_200_000,
    kpiMax: 5_000_000,
    kpiScore: 100,
    workdays: 26,
    standardDays: 26,
    variablePay: 0,
  });
  it('grosses to 25,000,000 (GĐ bậc 3 total)', () => {
    expect(r.grossIncome).toBe(25_000_000);
  });
  it('computes PIT on taxable after self relief', () => {
    // taxable = 25M - 11M = 14M → 250k + 500k + 600k(4M*15%) = 1,350,000
    expect(r.taxableIncome).toBe(14_000_000);
    expect(r.pitAmount).toBe(1_350_000);
    expect(r.netIncome).toBe(25_000_000 - 1_350_000);
  });
});

describe('assemblePayslip (grade D zeroes the KPI bonus; partial month prorates)', () => {
  const r = assemblePayslip({
    baseSalary: 5_700_000,
    mealAllowance: 500_000,
    otherAllowance: 2_800_000,
    kpiMax: 1_000_000,
    kpiScore: 40,
    workdays: 13,
    standardDays: 26,
  });
  it('zeroes KPI at grade D', () => {
    expect(r.kpiGrade).toBe('D');
    expect(r.kpiBonus).toBe(0);
  });
  it('prorates base + allowances to half', () => {
    expect(r.baseEarned).toBe(2_850_000);
    expect(r.allowanceEarned).toBe(1_650_000);
    expect(r.grossIncome).toBe(4_500_000);
  });
});
