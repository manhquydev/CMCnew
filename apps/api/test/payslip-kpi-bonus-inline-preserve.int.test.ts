/**
 * Invariant: payslipOverrideVariablePay must NOT wipe a KPI bonus that was established
 * via the inline kpiScore input to payslipCompute when no KpiScore row exists for the period.
 *
 * Root cause: the override path used to omit kpiScoreInput → assembleSlipData re-resolved
 * KPI from the KpiScore record → returned 0 when no row existed → kpiBonus dropped to 0
 * (observed: 2,400,000đ KPI bonus silently lost on a commission-only edit).
 *
 * Fix: payslipOverrideVariablePay now passes kpiScoreInput: slip.kpiScore so the frozen
 * value from the original compute is reused, regardless of whether a KpiScore row exists.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

describe('payslipOverrideVariablePay — inline kpiScore KPI bonus preserved', () => {
  const FAC = 1;
  const PERIOD = '2099-11';

  let managerId: string;
  let saleId: string;
  const createdSlipIds: string[] = [];
  const createdUserIds: string[] = [];

  // KPI score passed inline at compute time (no KpiScore row will exist).
  const INLINE_KPI_SCORE = 80; // grade B → 80% of kpiMax

  // Salary rate params chosen to make the KPI bonus large and unambiguous.
  // baseSalary 15_000_000, mealAllowance 1_000_000, kpiMax 3_000_000.
  // Grade B (80–89) = 80% → kpiBonus = 2_400_000đ.
  const BASE_SALARY = 15_000_000;
  const MEAL_ALLOWANCE = 1_000_000;
  const KPI_MAX = 3_000_000;

  let dbReachable = false;

  beforeAll(async () => {
    try {
      managerId = await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — integration tests skipped');
      return;
    }

    const caller = await staffCaller();

    // Create a sale user for the test.
    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sale_kpi_inline') + '@t.com',
          displayName: 'Sale KPI Inline Test',
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

    await caller.payroll.profileUpsert({
      userId: saleId,
      facilityId: FAC,
      position: 'sale',
      dependents: 0,
    });

    await caller.payroll.rateCreate({
      userId: saleId,
      facilityId: FAC,
      baseSalary: BASE_SALARY,
      mealAllowance: MEAL_ALLOWANCE,
      otherAllowance: 0,
      kpiMax: KPI_MAX,
      monthlyQuota: 20_000_000,
      effectiveFrom: '2099-10-01',
    });

    // Compute slip with inline kpiScore — NO KpiScore row is created for PERIOD.
    // This is the supported path (payslipCompute.input.kpiScore is optional).
    const slip = await caller.payroll.payslipCompute({
      userId: saleId,
      facilityId: FAC,
      periodKey: PERIOD,
      standardDays: 22,
      workdays: 22,
      kpiScore: INLINE_KPI_SCORE,
      variablePay: 0,
      insuranceDeduction: 0,
    });
    createdSlipIds.push(slip.id);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'payslip', entityId: { in: createdSlipIds } } });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }
      await tx.salaryRate.deleteMany({ where: { userId: saleId } });
      // Confirm no KpiScore row exists (was never created — that's the point of this test).
      await tx.kpiScore.deleteMany({ where: { userId: saleId } });
      await tx.employmentProfile.deleteMany({ where: { userId: saleId } });
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
    });
  });

  it('kpiBonus is unchanged after variablePay override when kpiScore came from inline input (no KpiScore row)', async () => {
    if (!dbReachable) return;

    // Confirm no KpiScore row exists for this user+period (the bug's precondition).
    const kpiRow = await withRls(SUPER, (tx) =>
      tx.kpiScore.findUnique({
        where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } },
      }),
    );
    expect(kpiRow).toBeNull(); // pre-condition for this bug path

    const beforeSlip = await withRls(SUPER, (tx) =>
      tx.payslip.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }),
    );

    // Confirm the initial KPI bonus is non-zero before override (grade B = 80% of 3M = 2,400,000đ).
    expect(beforeSlip.kpiScore).toBe(INLINE_KPI_SCORE);
    expect(beforeSlip.kpiBonus).toBeGreaterThan(0);
    const expectedKpiBonus = beforeSlip.kpiBonus; // freeze for comparison

    // Override only the variablePay (commission). Manager has tree-authority over sale.
    const mgr = await staffCaller({
      userId: managerId,
      roles: [Role.quan_ly],
      primaryRole: Role.quan_ly,
      isSuperAdmin: false,
      facilityIds: [FAC],
    });

    const overrideAmount = 500_000;
    await mgr.payroll.payslipOverrideVariablePay({
      userId: saleId,
      periodKey: PERIOD,
      amount: overrideAmount,
      reason: 'Điều chỉnh HH tháng thử nghiệm',
    });

    const afterSlip = await withRls(SUPER, (tx) =>
      tx.payslip.findUniqueOrThrow({ where: { userId_periodKey: { userId: saleId, periodKey: PERIOD } } }),
    );

    // variablePay updated to the override amount.
    expect(afterSlip.variablePay).toBe(overrideAmount);

    // kpiScore must be unchanged (frozen from original compute).
    expect(afterSlip.kpiScore).toBe(INLINE_KPI_SCORE);

    // kpiBonus must be UNCHANGED — the bug caused it to drop to 0 (2,400,000đ silently lost).
    expect(afterSlip.kpiBonus).toBe(expectedKpiBonus);
    expect(afterSlip.kpiBonus).toBeGreaterThan(0);

    // Net income must be higher than before-override due to variablePay increase.
    // (Before: variablePay=0; After: variablePay=500_000 — net must be larger.)
    expect(afterSlip.netIncome).toBeGreaterThan(beforeSlip.netIncome);
  });
});
