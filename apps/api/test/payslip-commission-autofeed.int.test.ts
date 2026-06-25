import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, superAdminUserId, uniq } from './helpers.js';

describe('payslipCompute — commission auto-feed for sale role', () => {
  const FAC = 1;
  const PERIOD_SALE = '2099-08';
  const PERIOD_TEACHER = '2099-09';

  let teacherId: string;
  let saleUserId: string;
  const createdSlipIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    teacherId = await superAdminUserId();
    const caller = await staffCaller();

    // Create a dedicated sale user so roles field can be set correctly
    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sale_emp') + '@t.com',
          displayName: 'Sale Employee',
          passwordHash: 'x',
          isActive: true,
          roles: ['sale'],
          primaryRole: 'sale',
          facilities: { create: [{ facilityId: FAC }] },
        },
      }),
    );
    saleUserId = saleUser.id;
    createdUserIds.push(saleUserId);

    // Profile + rate for teacher
    await caller.payroll.profileUpsert({
      userId: teacherId,
      facilityId: FAC,
      position: 'teacher',
      dependents: 0,
    });
    await caller.payroll.rateCreate({
      userId: teacherId,
      facilityId: FAC,
      baseSalary: 8_000_000,
      mealAllowance: 500_000,
      otherAllowance: 0,
      kpiMax: 0,
      monthlyQuota: 0,
      effectiveFrom: '2099-07-01',
    });

    // Profile + rate for sale employee (monthlyQuota > 0 so commission can be > 0)
    await caller.payroll.profileUpsert({
      userId: saleUserId,
      facilityId: FAC,
      position: 'sale',
      dependents: 0,
    });
    await caller.payroll.rateCreate({
      userId: saleUserId,
      facilityId: FAC,
      baseSalary: 6_000_000,
      mealAllowance: 300_000,
      otherAllowance: 0,
      kpiMax: 0,
      monthlyQuota: 10_000_000,
      effectiveFrom: '2099-07-01',
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'payslip', entityId: { in: createdSlipIds } } });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }
      await tx.salaryRate.deleteMany({ where: { userId: { in: [teacherId, saleUserId] }, effectiveFrom: new Date('2099-07-01') } });
      if (createdUserIds.length > 0) {
        await tx.employmentProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
        await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
      }
    });
  });

  async function computeSlip(userId: string, periodKey: string, variablePay = 0) {
    const caller = await staffCaller();
    const slip = await caller.payroll.payslipCompute({
      userId,
      facilityId: FAC,
      periodKey,
      standardDays: 22,
      workdays: 22,
      kpiScore: 80,
      variablePay,
      insuranceDeduction: 0,
    });
    if (!createdSlipIds.includes(slip.id)) createdSlipIds.push(slip.id);
    return slip;
  }

  it('teacher (non-sale) compute: variablePay reflects caller-supplied input', async () => {
    const slip = await computeSlip(teacherId, PERIOD_TEACHER, 500_000);
    expect(slip.variablePay).toBe(500_000);
  });

  it('sale role auto-feed: variablePay is overridden from commission (not caller input)', async () => {
    // With no receipts seeded, commission = 0 → variablePay should be 0 regardless of input
    const slip = await computeSlip(saleUserId, PERIOD_SALE, 999_999);
    // Commission auto-feed overrides whatever caller supplied — with no receipts commission=0
    expect(slip.variablePay).toBe(0);
  });

  it('double-compute idempotency: second compute returns same result', async () => {
    const first = await computeSlip(saleUserId, PERIOD_SALE, 0);
    const second = await computeSlip(saleUserId, PERIOD_SALE, 0);
    expect(second.variablePay).toBe(first.variablePay);
    expect(second.netIncome).toBe(first.netIncome);
    expect(second.grossIncome).toBe(first.grossIncome);
  });

  it('sale role variableNote contains "Hoa hồng"', async () => {
    const slip = await computeSlip(saleUserId, PERIOD_SALE, 0);
    expect(slip.variableNote).toMatch(/hoa hồng/i);
  });
});
