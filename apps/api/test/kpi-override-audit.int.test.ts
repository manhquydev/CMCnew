import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Invariant (decision 0011): KPI is auto-computed then tree-overridable. A manager (rank above the
// target) may override a subordinate's KPI with a mandatory reason; the change is logged old→new;
// nobody overrides their own KPI; and payslipCompute reads the final (override ?? auto) score.
describe('KPI override + audit + payslip wiring (decision 0011)', () => {
  const FACILITY = 1;
  const PERIOD = '2099-04';
  let saleId: string;
  let managerId: string;

  beforeAll(async () => {
    managerId = await superAdminUserId(); // a real app_user to act as the overriding manager
    const sale = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-sale@cmc.test'), displayName: 'KPI Sale', passwordHash: 'dummy',
          primaryRole: 'sale', roles: ['sale'], isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    saleId = sale.id;

    const su = await staffCaller();
    await su.payroll.profileUpsert({ userId: saleId, facilityId: FACILITY, position: 'sales', dependents: 0 });
    // Salary rate so payslipCompute has something to compute (effective before the period).
    await su.payroll.rateCreate({
      userId: saleId, facilityId: FACILITY,
      baseSalary: 7_000_000, mealAllowance: 0, otherAllowance: 0, kpiMax: 1_000_000, monthlyQuota: 0,
      effectiveFrom: '2099-04-01',
    });
    // Auto KPI = 72 (sales block).
    await su.payroll.kpiSetAuto({ userId: saleId, facilityId: FACILITY, periodKey: PERIOD, block: 'sales', autoScore: 72 });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score' } });
      await tx.payslip.deleteMany({ where: { userId: saleId } });
      await tx.kpiScore.deleteMany({ where: { userId: saleId } });
      await tx.salaryRate.deleteMany({ where: { userId: saleId } });
      await tx.employmentProfile.deleteMany({ where: { userId: saleId } });
      await tx.appUser.deleteMany({ where: { id: saleId } });
    });
  });

  const managerCaller = () =>
    staffCaller({ userId: managerId, roles: [Role.quan_ly], primaryRole: Role.quan_ly, isSuperAdmin: false, facilityIds: [FACILITY] });

  it('manager (tree) overrides a subordinate KPI and logs old→new + reason', async () => {
    const mgr = await managerCaller();
    await mgr.payroll.kpiOverride({ userId: saleId, periodKey: PERIOD, overrideScore: 85, reason: 'Bù điểm dự giờ thực tế' });

    const row = await withRls(SUPER, (tx) => tx.kpiScore.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }));
    expect(row.overrideScore).toBe(85);
    expect(row.autoScore).toBe(72); // auto preserved

    const log = await withRls(SUPER, (tx) => tx.recordEvent.findFirst({ where: { entityType: 'kpi_score' }, orderBy: { createdAt: 'desc' } }));
    expect(log?.body).toContain('72→85');
    expect(log?.body).toContain('Bù điểm dự giờ');
  });

  it('nobody can override their own KPI', async () => {
    // Actor whose userId == target, even with manager role → forbidden by the own-guard.
    const selfAsManager = await staffCaller({ userId: saleId, roles: [Role.quan_ly], primaryRole: Role.quan_ly, isSuperAdmin: false, facilityIds: [FACILITY] });
    await expect(
      selfAsManager.payroll.kpiOverride({ userId: saleId, periodKey: PERIOD, overrideScore: 100, reason: 'tự nâng' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('payslipCompute ignores an un-approved KPI, then uses the override once approved', async () => {
    const su = await staffCaller();
    // Decision 0011: only an APPROVED KPI sheet feeds payroll. The sheet here is still draft (override
    // applied but not approved) → its score must NOT flow into salary.
    const draftSlip = await su.payroll.payslipCompute({
      userId: saleId, facilityId: FACILITY, periodKey: PERIOD,
      standardDays: 22, workdays: 22, insuranceDeduction: 0,
    });
    expect(draftSlip.kpiScore).toBe(0);

    // Approve the sheet carrying the override → the final (override) score now feeds payroll.
    await withRls(SUPER, (tx) =>
      tx.kpiScore.update({
        where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } },
        data: { status: 'approved' },
      }),
    );
    const slip = await su.payroll.payslipCompute({
      userId: saleId, facilityId: FACILITY, periodKey: PERIOD,
      standardDays: 22, workdays: 22, insuranceDeduction: 0,
      // No kpiScore passed → must use the approved override (85).
    });
    expect(slip.kpiScore).toBe(85);
    // Sales band: 85 → grade B (70–90) → ratio 0.8 → bonus = 1,000,000 × 0.8 = 800,000.
    expect(slip.kpiGrade).toBe('B');
    expect(slip.kpiBonus).toBe(800_000);
  });
});
