import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, superAdminUserId } from './helpers.js';

describe('payslipBulkPay (by-ID) — failed bucket partition + authz', () => {
  const FAC_A = 1;
  const FAC_B = 2;
  const PERIOD = '2099-05';

  let employeeId: string;
  let slip1Id: string;
  let slip2Id: string;
  const createdSlipIds: string[] = [];

  beforeAll(async () => {
    employeeId = await superAdminUserId();
    const caller = await staffCaller();

    await caller.payroll.profileUpsert({
      userId: employeeId,
      facilityId: FAC_A,
      position: 'teacher',
      dependents: 0,
    });

    await caller.payroll.rateCreate({
      userId: employeeId,
      facilityId: FAC_A,
      baseSalary: 8_000_000,
      mealAllowance: 500_000,
      otherAllowance: 0,
      kpiMax: 0,
      monthlyQuota: 0,
      effectiveFrom: '2099-04-01',
    });

    const s1 = await caller.payroll.payslipCompute({
      userId: employeeId,
      facilityId: FAC_A,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: 80,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    slip1Id = s1.id;
    createdSlipIds.push(slip1Id);
    await caller.payroll.payslipFinalize({ id: slip1Id });

    const s2 = await caller.payroll.payslipCompute({
      userId: employeeId,
      facilityId: FAC_A,
      periodKey: '2099-06',
      standardDays: 22,
      workdays: 22,
      kpiScore: 80,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    slip2Id = s2.id;
    createdSlipIds.push(slip2Id);
    await caller.payroll.payslipFinalize({ id: slip2Id });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'payslip', entityId: { in: createdSlipIds } } });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }
      await tx.salaryRate.deleteMany({ where: { userId: employeeId, effectiveFrom: new Date('2099-04-01') } });
    });
  });

  it('non-HR caller gets FORBIDDEN', async () => {
    const nonHrCaller = await staffCaller({
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FAC_A],
    });
    await expect(nonHrCaller.payroll.payslipBulkPay({ ids: [slip1Id] })).rejects.toThrow(
      /FORBIDDEN|UNAUTHORIZED/i,
    );
  });

  it('happy path: all finalized IDs succeed, status becomes paid', async () => {
    // Ensure both slips are finalized (reopen if needed from a prior test run)
    await withRls(SUPER, (tx) =>
      tx.payslip.updateMany({
        where: { id: { in: [slip1Id, slip2Id] }, status: 'paid' },
        data: { status: 'finalized', paidAt: null },
      }),
    );

    const caller = await staffCaller({ facilityIds: [FAC_A], roles: [Role.hr], primaryRole: Role.hr, isSuperAdmin: false });
    const result = await caller.payroll.payslipBulkPay({ ids: [slip1Id, slip2Id] });
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    const slips = await withRls(SUPER, (tx) =>
      tx.payslip.findMany({ where: { id: { in: [slip1Id, slip2Id] } }, select: { status: true } }),
    );
    expect(slips.every((s) => s.status === 'paid')).toBe(true);
  });

  it('non-finalized (draft) and bogus IDs go to failed', async () => {
    // Reopen slip1 to draft
    await withRls(SUPER, (tx) =>
      tx.payslip.update({
        where: { id: slip1Id },
        data: { status: 'draft', finalizedById: null, finalizedAt: null },
      }),
    );

    const bogusId = '00000000-0000-4000-8000-000000000099';
    const caller = await staffCaller({ facilityIds: [FAC_A], roles: [Role.hr], primaryRole: Role.hr, isSuperAdmin: false });
    const result = await caller.payroll.payslipBulkPay({ ids: [slip1Id, bogusId] });
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toContain(slip1Id);
    expect(result.failed).toContain(bogusId);

    // restore slip1 to finalized for subsequent tests
    await withRls(SUPER, (tx) =>
      tx.payslip.update({ where: { id: slip1Id }, data: { status: 'finalized' } }),
    );
  });

  it('already-paid IDs go to failed', async () => {
    // slip2 was paid in the happy-path test
    const caller = await staffCaller({ facilityIds: [FAC_A], roles: [Role.hr], primaryRole: Role.hr, isSuperAdmin: false });
    const result = await caller.payroll.payslipBulkPay({ ids: [slip2Id] });
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toContain(slip2Id);
  });

  it('cross-facility IDs go to failed when caller is scoped to facilityId=1 only', async () => {
    // Create a slip in FAC_B via SUPER directly so we have an FK-valid slip
    const slip = await withRls(SUPER, (tx) =>
      tx.payslip.create({
        data: {
          facilityId: FAC_B,
          userId: employeeId,
          periodKey: '2099-07',
          standardDays: 22,
          workdays: 22,
          kpiScore: 80,
          kpiGrade: 'B',
          baseEarned: 7_000_000,
          allowanceEarned: 500_000,
          kpiBonus: 0,
          variablePay: 0,
          insuranceDeduction: 0,
          dependents: 0,
          grossIncome: 7_500_000,
          taxableIncome: 7_500_000,
          pitAmount: 0,
          netIncome: 7_500_000,
          status: 'finalized',
          computedById: employeeId,
        },
      }),
    );
    createdSlipIds.push(slip.id);

    const scopedCaller = await staffCaller({
      isSuperAdmin: false,
      facilityIds: [FAC_A],
      roles: [Role.hr],
      primaryRole: Role.hr,
    });
    const result = await scopedCaller.payroll.payslipBulkPay({ ids: [slip.id] });
    expect(result.failed).toContain(slip.id);
    expect(result.succeeded).not.toContain(slip.id);
  });
});
