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

describe('cvtvNewCustomerRate — PA2: by quota attainment ratio', () => {
  it.each([
    [0.49, 0],
    [0.5, 0.01],
    [0.79, 0.01],
    [0.8, 0.02],
    [0.99, 0.02],
    [1.0, 0.03],
    [1.2, 0.03], // 100–120% inclusive of 1.2
    [1.21, 0.04],
    [1.5, 0.04],
    [1.51, 0.045],
    [3.0, 0.045],
  ])('quota %f → rate %f', (q, rate) => {
    expect(cvtvNewCustomerRate(q)).toBe(rate);
  });
});

describe('managerNewCustomerRate — PA2', () => {
  it('TPKD bands', () => {
    expect(managerNewCustomerRate('tpkd', 0.79)).toBe(0);
    expect(managerNewCustomerRate('tpkd', 0.8)).toBe(0.006);
    expect(managerNewCustomerRate('tpkd', 1.0)).toBe(0.01);
    expect(managerNewCustomerRate('tpkd', 1.2)).toBe(0.01);
    expect(managerNewCustomerRate('tpkd', 1.5)).toBe(0.012);
    expect(managerNewCustomerRate('tpkd', 1.51)).toBe(0.015);
  });
  it('GĐTT bands', () => {
    expect(managerNewCustomerRate('gdtt', 0.79)).toBe(0);
    expect(managerNewCustomerRate('gdtt', 0.8)).toBe(0.004);
    expect(managerNewCustomerRate('gdtt', 1.0)).toBe(0.006);
    expect(managerNewCustomerRate('gdtt', 1.5)).toBe(0.008);
    expect(managerNewCustomerRate('gdtt', 1.6)).toBe(0.01);
  });
});

describe('renewalRate — PA2: flat per role, gated by centre retention ≥ 50%', () => {
  it('below 50% retention → 0 for every role', () => {
    for (const role of ['cvtv', 'tpkd', 'gdtt', 'gv', 'cskh'] as const) {
      expect(renewalRate(role, 0.49)).toBe(0);
    }
  });
  it('at/above 50% retention → the role flat rate', () => {
    expect(renewalRate('cvtv', 0.5)).toBe(0.022);
    expect(renewalRate('tpkd', 0.9)).toBe(0.005);
    expect(renewalRate('gdtt', 0.9)).toBe(0.005);
    expect(renewalRate('gv', 0.9)).toBe(0.01);
    expect(renewalRate('cskh', 0.9)).toBe(0.008);
  });
});

describe('commissionAmount', () => {
  it('rounds revenue × rate to VND', () => {
    expect(commissionAmount(123_456_789, 0.03)).toBe(Math.round(123_456_789 * 0.03));
    expect(commissionAmount(0, 0.045)).toBe(0);
  });
  it('rejects negative / non-integer revenue', () => {
    expect(() => commissionAmount(-1, 0.01)).toThrow();
    expect(() => commissionAmount(1.5, 0.01)).toThrow();
  });
});

describe('overtimePay (teaching — unaffected by PA1/PA2)', () => {
  it('hours × per-grade unit price', () => {
    expect(overtimePay(20, TEACHER_OVERTIME_RATE.B2!)).toBe(20 * 120_000);
    expect(overtimePay(10, TEACHER_OVERTIME_RATE.B4!)).toBe(10 * 150_000);
    expect(overtimePay(0, TEACHER_OVERTIME_RATE.B1!)).toBe(0);
  });
  it('grade unit prices match the decision table', () => {
    expect(TEACHER_OVERTIME_RATE).toMatchObject({ B1: 100_000, B2: 120_000, B3: 130_000, B4: 150_000 });
  });
});

describe('part-time packages (teaching)', () => {
  it('flat monthly gross per package', () => {
    expect(PARTTIME_PACKAGE).toMatchObject({ PT3: 3_000_000, PT4: 4_000_000, PT5: 5_000_000 });
  });
});

describe('kpiGradeFromScore — training band (the confirmed one)', () => {
  it('training band', () => {
    expect(kpiGradeFromScore(85)).toEqual({ grade: 'A', ratio: 1.0 });
    expect(kpiGradeFromScore(70)).toEqual({ grade: 'B', ratio: 0.9 });
    expect(kpiGradeFromScore(50)).toEqual({ grade: 'C', ratio: 0.8 });
    expect(kpiGradeFromScore(49)).toEqual({ grade: 'D', ratio: 0 });
  });
  // NOTE: the sales ('sales') KPI band is PROVISIONAL — PA2's source has internally inconsistent
  // KPI tables (appendix vs test sheets). Pending owner confirmation; we only assert the param is
  // wired, not the exact sales ratios, to avoid locking unconfirmed values.
  it('block param is wired (sales grades A at 90, differs from training at 88)', () => {
    expect(kpiGradeFromScore(90, 'sales').grade).toBe('A');
    expect(kpiGradeFromScore(88, 'sales').grade).not.toBe('A');
  });
});
