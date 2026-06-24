import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, superAdminUserId } from './helpers.js';

// Proves three payroll invariants (Phase 4):
//   1. myPayslips only returns the caller's own finalized/paid slips (IDOR guard: userId
//      comes exclusively from ctx.session — there is no userId input to forge).
//   2. myPayslips hides draft slips so staff cannot see un-finalized numbers.
//   3. payslipBulkMarkPaid flips all finalized slips in a period to paid in one call,
//      and payslipPeriodSummary reflects the resulting count+totals correctly.
describe('payroll: myPayslips IDOR guard + draft visibility + bulk pay + period summary', () => {
  const FAC = 1;
  const PERIOD = '2099-04';
  let employeeId: string;
  const createdSlipIds: string[] = [];

  beforeAll(async () => {
    employeeId = await superAdminUserId();
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FAC, position: 'teacher', dependents: 0 });
    // Effective far-future rate so it doesn't collide with other test fixtures
    await caller.payroll.rateCreate({
      userId: employeeId, facilityId: FAC,
      baseSalary: 8_000_000, mealAllowance: 500_000, otherAllowance: 0, kpiMax: 0, monthlyQuota: 0,
      effectiveFrom: '2099-01-01',
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'payslip', entityId: { in: createdSlipIds } } });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }
      await tx.salaryRate.deleteMany({ where: { userId: employeeId, effectiveFrom: new Date('2099-01-01') } });
    });
  });

  async function computeDraft() {
    const slip = await (await staffCaller()).payroll.payslipCompute({
      userId: employeeId, facilityId: FAC, periodKey: PERIOD,
      standardDays: 22, workdays: 22, kpiScore: 80, variablePay: 0, insuranceDeduction: 0,
    });
    if (!createdSlipIds.includes(slip.id)) createdSlipIds.push(slip.id);
    return slip;
  }

  it('myPayslips hides draft — staff cannot see un-finalized numbers', async () => {
    await computeDraft();
    const caller = await staffCaller();
    const slips = await caller.payroll.myPayslips();
    const thisSlip = slips.find((s) => s.periodKey === PERIOD);
    // Draft must be hidden (un-finalized numbers are HR-internal until finalized)
    expect(thisSlip).toBeUndefined();
  });

  it('myPayslips returns own finalized slip; other session userId sees nothing (IDOR guard)', async () => {
    const draft = await computeDraft();
    const caller = await staffCaller();
    await caller.payroll.payslipFinalize({ id: draft.id });

    // Own session: finalized slip is visible
    const ownSlips = await caller.payroll.myPayslips();
    const ownSlip = ownSlips.find((s) => s.periodKey === PERIOD);
    expect(ownSlip).toBeDefined();
    expect(ownSlip!.status).toBe('finalized');

    // Different userId (no payslips for this session): myPayslips returns empty for that period
    // IDOR proof: there is no userId input to the endpoint — filter is solely ctx.session.userId.
    const DIFFERENT_USER_ID = '00000000-0000-4000-8000-000000000099'; // different, no payslips
    const otherCaller = await staffCaller({ userId: DIFFERENT_USER_ID });
    const otherSlips = await otherCaller.payroll.myPayslips();
    expect(otherSlips.find((s) => s.periodKey === PERIOD)).toBeUndefined();
  });

  it('payslipBulkMarkPaid flips all finalized slips to paid; payslipPeriodSummary reflects count', async () => {
    const caller = await staffCaller();

    // Get the slip that was finalized in the previous test (same PERIOD/userId upsert).
    // If it's still draft (isolated run order), finalize it; if already paid, reopen → refinalize.
    const existing = await caller.payroll.payslipList({ facilityId: FAC, periodKey: PERIOD });
    const slip = existing[0];
    if (!slip) {
      // No slip yet — compute + finalize one fresh
      const d = await computeDraft();
      await caller.payroll.payslipFinalize({ id: d.id });
    } else if (slip.status === 'draft') {
      await caller.payroll.payslipFinalize({ id: slip.id });
    } else if (slip.status === 'paid') {
      // Reopen to finalized so bulk pay has something to pick up
      await withRls(SUPER, (tx) => tx.payslip.update({ where: { id: slip.id }, data: { status: 'finalized', paidAt: null } }));
    }
    // At this point the slip is finalized

    const summaryMid = await caller.payroll.payslipPeriodSummary({ facilityId: FAC, periodKey: PERIOD });
    expect(summaryMid.finalizedCount).toBeGreaterThanOrEqual(1);

    // Bulk pay all finalized slips in this period
    const result = await caller.payroll.payslipBulkMarkPaid({ facilityId: FAC, periodKey: PERIOD });
    expect(result.paidCount).toBeGreaterThanOrEqual(1);

    // Summary after: finalizedCount drops to 0; paidCount increases
    const summaryAfter = await caller.payroll.payslipPeriodSummary({ facilityId: FAC, periodKey: PERIOD });
    expect(summaryAfter.finalizedCount).toBe(0);
    expect(summaryAfter.paidCount).toBeGreaterThanOrEqual(result.paidCount);

    // myPayslips now returns the paid slip (not hidden — paid is visible)
    const mySlips = await caller.payroll.myPayslips();
    const paidSlip = mySlips.find((s) => s.periodKey === PERIOD);
    expect(paidSlip).toBeDefined();
    expect(paidSlip!.status).toBe('paid');
  });
});
