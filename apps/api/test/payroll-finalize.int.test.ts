import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { staffCaller, withRls, SUPER, superAdminUserId } from './helpers.js';

// Invariant (spec Phase 4, fixes legacy M6): payslip lifecycle draft → finalized → paid.
// Amounts may be recomputed ONLY while draft; finalize freezes them; recomputing a
// finalized slip is a CONFLICT. Reopen (finalized → draft) is explicit and audited.
describe('payslip finalize gating (payroll invariant)', () => {
  const FACILITY = 1;
  const PERIOD = '2099-01'; // future, isolated from any real data
  let employeeId: string;

  beforeAll(async () => {
    employeeId = await superAdminUserId();
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'teacher', dependents: 0 });
    await caller.payroll.rateCreate({
      userId: employeeId, facilityId: FACILITY,
      baseSalary: 10_000_000, mealAllowance: 0, otherAllowance: 0, kpiMax: 1_000_000, monthlyQuota: 0,
      effectiveFrom: '2020-01-01',
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.payslip.deleteMany({ where: { userId: employeeId, periodKey: PERIOD } });
      await tx.salaryRate.deleteMany({ where: { userId: employeeId, effectiveFrom: new Date('2020-01-01') } });
    });
  });

  it('recompute is blocked once finalized (CONFLICT), allowed again after reopen', async () => {
    const caller = await staffCaller();
    const compute = () => caller.payroll.payslipCompute({
      userId: employeeId, facilityId: FACILITY, periodKey: PERIOD,
      standardDays: 22, workdays: 22, kpiScore: 90, variablePay: 0, insuranceDeduction: 0,
    });

    const draft = await compute();
    expect(draft.status).toBe('draft');

    // draft → recompute OK
    const recomputed = await compute();
    expect(recomputed.status).toBe('draft');

    await caller.payroll.payslipFinalize({ id: draft.id });

    // finalized → recompute must CONFLICT
    await expect(compute()).rejects.toMatchObject({ code: 'CONFLICT' });

    // reopen → draft, recompute allowed again
    await caller.payroll.payslipReopen({ id: draft.id });
    const afterReopen = await compute();
    expect(afterReopen.status).toBe('draft');
  });
});
