import { describe, it, expect } from 'vitest';
import {
  cvtvNewCustomerRate,
  managerNewCustomerRate,
  renewalRate,
  commissionAmount,
  overtimeUnitPrice,
  overtimePay,
  parttimePackageGross,
} from './commission.js';
import { kpiGradeFromScore } from './payslip.js';
import { compensationParamsSchema, DEFAULT_PARAMS, type CompensationParams } from './params.js';

describe('cvtvNewCustomerRate — PA2 quota bands (from DEFAULT_PARAMS)', () => {
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

describe('renewalRate — flat per role, gated by centre retention ≥ 50%', () => {
  it('below floor → 0', () => {
    for (const role of ['cvtv', 'tpkd', 'gdtt', 'gv', 'cskh'] as const) {
      expect(renewalRate(role, 0.49)).toBe(0);
    }
  });
  it('at/above floor → role flat rate', () => {
    expect(renewalRate('cvtv', 0.5)).toBe(0.022);
    expect(renewalRate('tpkd', 0.9)).toBe(0.005);
    expect(renewalRate('gdtt', 0.9)).toBe(0.005);
    expect(renewalRate('gv', 0.9)).toBe(0.01);
    expect(renewalRate('cskh', 0.9)).toBe(0.008);
  });
});

describe('commissionAmount / overtime / parttime', () => {
  it('commission rounds revenue × rate', () => {
    expect(commissionAmount(123_456_789, 0.03)).toBe(Math.round(123_456_789 * 0.03));
  });
  it('overtime unit price by grade + pay', () => {
    expect(overtimeUnitPrice('B2')).toBe(120_000);
    expect(overtimeUnitPrice('B4')).toBe(150_000);
    expect(overtimeUnitPrice('Z9')).toBe(0); // untabled grade
    expect(overtimePay(20, overtimeUnitPrice('B2'))).toBe(20 * 120_000);
  });
  it('parttime package gross', () => {
    expect(parttimePackageGross('PT3')).toBe(3_000_000);
    expect(parttimePackageGross('PT5')).toBe(5_000_000);
    expect(parttimePackageGross('PTx')).toBe(0);
  });
});

describe('params are editable — a custom policy changes the rates', () => {
  it('cvtv new rate follows the policy params, not a hardcoded table', () => {
    const custom: CompensationParams = {
      ...DEFAULT_PARAMS,
      commission: { ...DEFAULT_PARAMS.commission, cvtvNewRates: [0, 0.02, 0.04, 0.06, 0.08, 0.1] },
    };
    expect(cvtvNewCustomerRate(0.5, custom)).toBe(0.02); // doubled vs default 0.01
    expect(cvtvNewCustomerRate(3.0, custom)).toBe(0.1);
    expect(cvtvNewCustomerRate(0.5)).toBe(0.01); // default unchanged
  });
  it('renewal floor is editable', () => {
    const custom: CompensationParams = {
      ...DEFAULT_PARAMS,
      commission: { ...DEFAULT_PARAMS.commission, retentionFloor: 0.7 },
    };
    expect(renewalRate('cvtv', 0.6, custom)).toBe(0); // below the raised floor
    expect(renewalRate('cvtv', 0.6)).toBe(0.022); // default floor 0.5
  });
});

describe('kpiGradeFromScore — data-driven bands', () => {
  it('training band (default)', () => {
    expect(kpiGradeFromScore(85)).toEqual({ grade: 'A', ratio: 1.0 });
    expect(kpiGradeFromScore(70)).toEqual({ grade: 'B', ratio: 0.9 });
    expect(kpiGradeFromScore(50)).toEqual({ grade: 'C', ratio: 0.8 });
    expect(kpiGradeFromScore(49)).toEqual({ grade: 'D', ratio: 0 });
  });
  it('sales band differs (A from 90)', () => {
    expect(kpiGradeFromScore(90, 'sales').grade).toBe('A');
    expect(kpiGradeFromScore(88, 'sales').grade).not.toBe('A');
  });
  it('bands come from params (custom band changes grading)', () => {
    const custom: CompensationParams = {
      ...DEFAULT_PARAMS,
      kpi: { ...DEFAULT_PARAMS.kpi, training: [{ minScore: 95, grade: 'A', ratio: 1 }, { minScore: 0, grade: 'F', ratio: 0 }] },
    };
    expect(kpiGradeFromScore(94, 'training', custom)).toEqual({ grade: 'F', ratio: 0 });
    expect(kpiGradeFromScore(95, 'training', custom)).toEqual({ grade: 'A', ratio: 1 });
  });
});

describe('DEFAULT_PARAMS validates against its own Zod schema', () => {
  it('passes compensationParamsSchema', () => {
    expect(() => compensationParamsSchema.parse(DEFAULT_PARAMS)).not.toThrow();
  });
  it('rejects an out-of-range rate', () => {
    const bad = { ...DEFAULT_PARAMS, commission: { ...DEFAULT_PARAMS.commission, retentionFloor: 5 } };
    expect(() => compensationParamsSchema.parse(bad)).toThrow();
  });
});
