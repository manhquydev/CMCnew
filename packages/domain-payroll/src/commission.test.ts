import { describe, it, expect } from 'vitest';
import {
  cvtvNewCustomerRate,
  managerNewCustomerRate,
  renewalRate,
  commissionAmount,
  overtimePay,
  TEACHER_OVERTIME_RATE,
  PARTTIME_PACKAGE,
} from './commission.js';
import { kpiGradeFromScore } from './payslip.js';

const M = 1_000_000;

describe('cvtvNewCustomerRate — tiered by monthly revenue (triệu)', () => {
  it.each([
    [49 * M, 0],
    [50 * M, 0.01],
    [80 * M, 0.01],
    [80 * M + 1, 0.02],
    [100 * M, 0.02], // exact tier edge → lower band
    [100 * M + 1, 0.03],
    [160 * M, 0.03],
    [161 * M, 0.04],
    [240 * M, 0.04],
    [240 * M + 1, 0.05],
    [500 * M, 0.05],
  ])('revenue %d → rate %f', (rev, rate) => {
    expect(cvtvNewCustomerRate(rev)).toBe(rate);
  });
});

describe('managerNewCustomerRate — by quota attainment', () => {
  it('TPKD bands', () => {
    expect(managerNewCustomerRate('tpkd', 0.79)).toBe(0);
    expect(managerNewCustomerRate('tpkd', 0.8)).toBe(0.007);
    expect(managerNewCustomerRate('tpkd', 0.99)).toBe(0.007);
    expect(managerNewCustomerRate('tpkd', 1.0)).toBe(0.01);
    expect(managerNewCustomerRate('tpkd', 1.49)).toBe(0.01);
    expect(managerNewCustomerRate('tpkd', 1.5)).toBe(0.012);
  });
  it('GĐTT bands', () => {
    expect(managerNewCustomerRate('gdtt', 0.79)).toBe(0);
    expect(managerNewCustomerRate('gdtt', 0.8)).toBe(0.006);
    expect(managerNewCustomerRate('gdtt', 1.0)).toBe(0.008);
    expect(managerNewCustomerRate('gdtt', 1.5)).toBe(0.01);
  });
});

describe('renewalRate — by retention rate', () => {
  it('CVTV', () => {
    expect(renewalRate('cvtv', 0.49)).toBe(0);
    expect(renewalRate('cvtv', 0.5)).toBe(0.015);
    expect(renewalRate('cvtv', 0.7)).toBe(0.02);
    expect(renewalRate('cvtv', 0.9)).toBe(0.022);
  });
  it('TPKD / GĐTT / CSKH share the <60% → 0 floor', () => {
    expect(renewalRate('tpkd', 0.59)).toBe(0);
    expect(renewalRate('gdtt', 0.59)).toBe(0);
    expect(renewalRate('cskh', 0.59)).toBe(0);
    expect(renewalRate('tpkd', 0.9)).toBe(0.01);
    expect(renewalRate('gdtt', 0.9)).toBe(0.008);
    expect(renewalRate('cskh', 0.9)).toBe(0.006);
  });
});

describe('commissionAmount', () => {
  it('rounds revenue × rate to VND', () => {
    expect(commissionAmount(123_456_789, 0.03)).toBe(Math.round(123_456_789 * 0.03));
    expect(commissionAmount(0, 0.05)).toBe(0);
  });
  it('rejects negative / non-integer revenue', () => {
    expect(() => commissionAmount(-1, 0.01)).toThrow();
    expect(() => commissionAmount(1.5, 0.01)).toThrow();
  });
});

describe('overtimePay (teaching)', () => {
  it('hours × per-grade unit price', () => {
    expect(overtimePay(20, TEACHER_OVERTIME_RATE.B2!)).toBe(20 * 120_000);
    expect(overtimePay(10, TEACHER_OVERTIME_RATE.B4!)).toBe(10 * 150_000);
    expect(overtimePay(0, TEACHER_OVERTIME_RATE.B1!)).toBe(0);
  });
  it('grade unit prices match the decision table', () => {
    expect(TEACHER_OVERTIME_RATE).toMatchObject({ B1: 100_000, B2: 120_000, B3: 130_000, B4: 150_000 });
  });
});

describe('part-time packages', () => {
  it('flat monthly gross per package', () => {
    expect(PARTTIME_PACKAGE).toMatchObject({ PT3: 3_000_000, PT4: 4_000_000, PT5: 5_000_000 });
  });
});

describe('kpiGradeFromScore — block-aware bands', () => {
  it('training band (default)', () => {
    expect(kpiGradeFromScore(85)).toEqual({ grade: 'A', ratio: 1.0 });
    expect(kpiGradeFromScore(70)).toEqual({ grade: 'B', ratio: 0.9 });
    expect(kpiGradeFromScore(50)).toEqual({ grade: 'C', ratio: 0.8 });
    expect(kpiGradeFromScore(49)).toEqual({ grade: 'D', ratio: 0 });
  });
  it('sales band differs (A from 90, adds D 0.6 + E 0)', () => {
    expect(kpiGradeFromScore(90, 'sales')).toEqual({ grade: 'A', ratio: 1.0 });
    expect(kpiGradeFromScore(89, 'sales')).toEqual({ grade: 'B', ratio: 0.8 });
    expect(kpiGradeFromScore(70, 'sales')).toEqual({ grade: 'B', ratio: 0.8 });
    expect(kpiGradeFromScore(50, 'sales')).toEqual({ grade: 'C', ratio: 0.7 });
    expect(kpiGradeFromScore(40, 'sales')).toEqual({ grade: 'D', ratio: 0.6 });
    expect(kpiGradeFromScore(39, 'sales')).toEqual({ grade: 'E', ratio: 0 });
  });
  it('a score of 88 grades A in training but B in sales (the discrepancy that was the bug)', () => {
    expect(kpiGradeFromScore(88, 'training').grade).toBe('A');
    expect(kpiGradeFromScore(88, 'sales').grade).toBe('B');
  });
});
