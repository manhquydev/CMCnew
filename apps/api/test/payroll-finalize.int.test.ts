import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, superAdminUserId } from './helpers.js';

// Invariant (spec Phase 4, fixes legacy M6): payslip lifecycle draft → finalized → paid.
// Amounts may be recomputed ONLY while draft; finalize FREEZES the numbers; recomputing a
// finalized slip is CONFLICT; reopen (finalized → draft) is explicit. PIT is marginal (not flat).
describe('payslip finalize gating + amount freeze (payroll invariant)', () => {
  const FACILITY = 1;
  const PERIOD = '2099-01';
  let employeeId: string;

  beforeAll(async () => {
    employeeId = await superAdminUserId();
    const caller = await staffCaller();
    await caller.payroll.profileUpsert({ userId: employeeId, facilityId: FACILITY, position: 'teacher', dependents: 0 });
    // 30M base, no KPI/allowance → taxable income is non-zero, so PIT actually exercises the
    // progressive brackets (a flat-rate bug would surface here; a 0-taxable case would hide it).
    // effectiveFrom in the far future so this rate (not any seeded one) is the one effective at PERIOD.
    await caller.payroll.rateCreate({
      userId: employeeId, facilityId: FACILITY,
      baseSalary: 30_000_000, mealAllowance: 0, otherAllowance: 0, kpiMax: 0, monthlyQuota: 0,
      effectiveFrom: '2098-06-01',
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.payslip.deleteMany({ where: { userId: employeeId, periodKey: PERIOD } });
      await tx.salaryRate.deleteMany({ where: { userId: employeeId, effectiveFrom: new Date('2098-06-01') } });
    });
  });

  const compute = async () =>
    (await staffCaller()).payroll.payslipCompute({
      userId: employeeId, facilityId: FACILITY, periodKey: PERIOD,
      standardDays: 22, workdays: 22, kpiScore: 0, variablePay: 0, insuranceDeduction: 0,
    });

  it('computes a correct marginal-PIT draft (not flat-rate, not zero-taxable)', async () => {
    const draft = await compute();
    expect(draft.status).toBe('draft');
    expect(draft.grossIncome).toBe(30_000_000);
    expect(draft.taxableIncome).toBeGreaterThan(0);
    expect(draft.pitAmount).toBeGreaterThan(0);
    // Marginal effective rate on ~19M taxable is ~11%; a flat top-bracket (35%) bug would blow past this.
    expect(draft.pitAmount).toBeLessThan(draft.taxableIncome * 0.25);
    expect(draft.netIncome).toBe(draft.grossIncome - draft.pitAmount);
  });

  it('finalize freezes the numbers; recompute is CONFLICT; reopen restores draft', async () => {
    const draft = await compute();
    const frozen = { gross: draft.grossIncome, pit: draft.pitAmount, net: draft.netIncome };

    await (await staffCaller()).payroll.payslipFinalize({ id: draft.id });

    // Numbers unchanged by finalize (read raw from DB, not via a recompute).
    const afterFinalize = await withRls(SUPER, (tx) => tx.payslip.findUniqueOrThrow({ where: { id: draft.id } }));
    expect(afterFinalize.status).toBe('finalized');
    expect(afterFinalize.grossIncome).toBe(frozen.gross);
    expect(afterFinalize.pitAmount).toBe(frozen.pit);
    expect(afterFinalize.netIncome).toBe(frozen.net);

    // Recompute blocked while finalized.
    await expect(compute()).rejects.toMatchObject({ code: 'CONFLICT' });

    // Reopen must actually reset status to draft and clear the finalize stamp (asserted directly).
    await (await staffCaller()).payroll.payslipReopen({ id: draft.id });
    const afterReopen = await withRls(SUPER, (tx) => tx.payslip.findUniqueOrThrow({ where: { id: draft.id } }));
    expect(afterReopen.status).toBe('draft');
    expect(afterReopen.finalizedById).toBeNull();

    // And recompute works again.
    expect((await compute()).status).toBe('draft');
  });
});
