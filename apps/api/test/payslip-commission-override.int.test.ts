import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

/**
 * Invariant (phase-07): payslipOverrideVariablePay lets a tree-manager correct a sale's
 * commission on a draft payslip. Gross/PIT/net must be recomputed via the shared
 * assembleSlipData helper (not just a field patch). Self-override and non-tree roles
 * are rejected FORBIDDEN; a non-draft slip is rejected CONFLICT.
 */
describe('payslipOverrideVariablePay — tree-manager commission correction', () => {
  const FAC = 1;
  const PERIOD = '2099-10';

  let managerId: string;
  let saleId: string;
  const createdSlipIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    managerId = await superAdminUserId();
    const caller = await staffCaller();

    // Create a sale user scoped to the test facility.
    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sale_override') + '@t.com',
          displayName: 'Sale Override Test',
          passwordHash: 'x',
          isActive: true,
          roles: ['sale'],
          primaryRole: 'sale',
          facilities: { create: [{ facilityId: FAC }] },
        },
      }),
    );
    saleId = saleUser.id;
    createdUserIds.push(saleId);

    // Employment profile + salary rate for the sale user.
    await caller.payroll.profileUpsert({
      userId: saleId,
      facilityId: FAC,
      position: 'sale',
      dependents: 0,
    });
    await caller.payroll.rateCreate({
      userId: saleId,
      facilityId: FAC,
      baseSalary: 6_000_000,
      mealAllowance: 300_000,
      otherAllowance: 0,
      kpiMax: 500_000,
      monthlyQuota: 10_000_000,
      effectiveFrom: '2099-09-01',
    });

    // Compute the initial draft payslip (no receipts → variablePay=0 from auto-feed).
    const slip = await caller.payroll.payslipCompute({
      userId: saleId,
      facilityId: FAC,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: 75,
      insuranceDeduction: 0,
    });
    if (!createdSlipIds.includes(slip.id)) createdSlipIds.push(slip.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'payslip', entityId: { in: createdSlipIds } } });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }
      await tx.salaryRate.deleteMany({ where: { userId: saleId } });
      await tx.kpiScore.deleteMany({ where: { userId: saleId } });
      await tx.employmentProfile.deleteMany({ where: { userId: saleId } });
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
    });
  });

  // giam_doc_kinh_doanh has tree-authority over sale staff (canOverrideKpi: directors > non-management).
  const managerCaller = () =>
    staffCaller({
      userId: managerId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FAC],
    });

  it('tree-manager overrides variablePay: amount stored, net recomputed, audit logged', async () => {
    const mgr = await managerCaller();
    const overrideAmount = 1_500_000;

    // Capture slip before override for comparison.
    const before = await withRls(SUPER, (tx) =>
      tx.payslip.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }),
    );

    await mgr.payroll.payslipOverrideVariablePay({
      userId: saleId,
      periodKey: PERIOD,
      amount: overrideAmount,
      reason: 'Bù hoa hồng tháng 10 theo kết quả thực tế',
    });

    const after = await withRls(SUPER, (tx) =>
      tx.payslip.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }),
    );

    // variablePay must be the override amount.
    expect(after.variablePay).toBe(overrideAmount);

    // netIncome must have changed (override adds to gross → changes tax → changes net).
    expect(after.netIncome).not.toBe(before.netIncome);
    // grossIncome must include the override amount (baseline was 0 commission).
    expect(after.grossIncome).toBeGreaterThan(before.grossIncome);

    // Audit record logged with old→new and reason.
    const log = await withRls(SUPER, (tx) =>
      tx.recordEvent.findFirst({
        where: { entityType: 'payslip', entityId: after.id },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(log).toBeDefined();
    expect(log?.body).toContain(String(overrideAmount.toLocaleString('vi-VN')));
    expect(log?.body).toContain('Lý do:');
  });

  it('self-override is rejected with FORBIDDEN', async () => {
    // Actor whose userId == target → always blocked by canOverrideKpi's self-guard.
    const selfCaller = await staffCaller({
      userId: saleId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FAC],
    });
    await expect(
      selfCaller.payroll.payslipOverrideVariablePay({
        userId: saleId,
        periodKey: PERIOD,
        amount: 999_999,
        reason: 'tự nâng',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('non-tree role (giao_vien over sale) is rejected with FORBIDDEN', async () => {
    // giao_vien has no tree-authority over sale roles.
    const teacherCaller = await staffCaller({
      userId: managerId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FAC],
    });
    await expect(
      teacherCaller.payroll.payslipOverrideVariablePay({
        userId: saleId,
        periodKey: PERIOD,
        amount: 500_000,
        reason: 'giáo viên không có quyền',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('override on a finalized slip is rejected with CONFLICT', async () => {
    // Finalize the slip first.
    const slip = await withRls(SUPER, (tx) =>
      tx.payslip.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }),
    );
    await withRls(SUPER, (tx) =>
      tx.payslip.update({
        where: { id: slip.id },
        data: { status: 'finalized' },
      }),
    );
    const mgr = await managerCaller();
    await expect(
      mgr.payroll.payslipOverrideVariablePay({
        userId: saleId,
        periodKey: PERIOD,
        amount: 200_000,
        reason: 'phiếu đã chốt',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Restore to draft for cleanup.
    await withRls(SUPER, (tx) =>
      tx.payslip.update({
        where: { id: slip.id },
        data: { status: 'draft' },
      }),
    );
  });
});
