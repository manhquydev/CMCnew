import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

/**
 * Deep-test of three untested payroll workflows:
 * 1. payslipReopen: finalized → draft (allows recompute); guards against 'paid' state
 * 2. payslipBulkMarkPaid: all finalized slips in facility+period → paid; non-finalized skipped, idempotent
 * 3. Commission override after auto-feed: sales auto-feed → override adjusts → KPI bonus preserved
 * 4. Full correction cycle: reopen → recompute → re-finalize
 *
 * Spec: Phase 4 (payslip lifecycle), Phase 6 (payslipReopen), Phase 7 (commission override)
 */
describe('payroll reopen + bulk-pay + commission-override deep tests', () => {
  const FAC = 1;
  const PERIOD = '2099-08';
  const NEXT_PERIOD = '2099-09';

  let managerId: string;
  let saleId: string;
  let teacherId: string;
  const createdSlipIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdReceiptIds: string[] = [];

  beforeAll(async () => {
    managerId = await superAdminUserId();
    const caller = await staffCaller();

    // ─── Create sale staff with base salary + quota for commission auto-feed ───
    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('sale_reopen') + '@t.com',
          displayName: 'Sale Reopen Test',
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
      position: 'sales consultant',
      dependents: 1,
    });
    await caller.payroll.rateCreate({
      userId: saleId,
      facilityId: FAC,
      baseSalary: 5_000_000,
      mealAllowance: 300_000,
      otherAllowance: 0,
      kpiMax: 1_000_000,
      monthlyQuota: 20_000_000,
      effectiveFrom: '2099-07-01',
    });

    // ─── Create teacher staff (non-sales) for bulk-pay test ───
    const teacherUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('teacher_reopen') + '@t.com',
          displayName: 'Teacher Reopen Test',
          passwordHash: 'x',
          isActive: true,
          roles: ['giao_vien'],
          primaryRole: 'giao_vien',
          facilities: { create: [{ facilityId: FAC }] },
        },
      }),
    );
    teacherId = teacherUser.id;
    createdUserIds.push(teacherId);

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
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Clean audit logs for test slips
      if (createdSlipIds.length > 0) {
        await tx.recordEvent.deleteMany({
          where: { entityType: 'payslip', entityId: { in: createdSlipIds } },
        });
        await tx.payslip.deleteMany({ where: { id: { in: createdSlipIds } } });
      }

      // Clean receipts
      if (createdReceiptIds.length > 0) {
        await tx.receipt.deleteMany({ where: { id: { in: createdReceiptIds } } });
      }

      // Clean salary rates
      await tx.salaryRate.deleteMany({
        where: { userId: { in: [saleId, teacherId] }, effectiveFrom: new Date('2099-07-01') },
      });
      await tx.kpiScore.deleteMany({ where: { userId: saleId } });
      await tx.employmentProfile.deleteMany({ where: { userId: { in: [saleId, teacherId] } } });
      await tx.appUser.deleteMany({ where: { id: { in: createdUserIds } } });
    });
  });

  describe('payslipReopen: finalized → draft', () => {
    let slipId: string;

    beforeAll(async () => {
      const caller = await staffCaller();
      const slip = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: PERIOD,
        standardDays: 22,
        workdays: 20,
        kpiScore: 80,
        variablePay: 500_000,
        insuranceDeduction: 100_000,
      });
      slipId = slip.id;
      createdSlipIds.push(slipId);
      await caller.payroll.payslipFinalize({ id: slipId });
    });

    it('reopen a finalized slip → status = draft, finalizedById cleared, allows recompute', async () => {
      const caller = await staffCaller();
      const before = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(before.status).toBe('finalized');
      expect(before.finalizedById).not.toBeNull();
      expect(before.finalizedAt).not.toBeNull();
      const frozenGross = before.grossIncome;

      // Reopen
      await caller.payroll.payslipReopen({ id: slipId });

      const after = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(after.status).toBe('draft');
      expect(after.finalizedById).toBeNull();
      expect(after.finalizedAt).toBeNull();
      // Numbers unchanged by reopen itself
      expect(after.grossIncome).toBe(frozenGross);

      // Recompute now works
      const recomputed = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: PERIOD,
        standardDays: 22,
        workdays: 22, // changed from 20 to 22
        kpiScore: 85, // bumped KPI
        variablePay: 600_000, // increased variable pay
        insuranceDeduction: 100_000,
      });
      expect(recomputed.status).toBe('draft');
      // Gross should increase (more workdays + higher KPI + more variable pay)
      expect(recomputed.grossIncome).toBeGreaterThan(frozenGross);
    });

    it('cannot reopen a paid slip (BAD_REQUEST)', async () => {
      // First finalize, then mark paid
      const caller = await staffCaller();
      const slip = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: NEXT_PERIOD,
        standardDays: 22,
        workdays: 22,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      const paidSlipId = slip.id;
      createdSlipIds.push(paidSlipId);

      await caller.payroll.payslipFinalize({ id: paidSlipId });
      await caller.payroll.payslipMarkPaid({ id: paidSlipId });

      // Try to reopen → should fail
      await expect(
        caller.payroll.payslipReopen({ id: paidSlipId }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: /chỉ mở lại phiếu đã chốt/i,
      });
    });

    it('reopen audit log recorded with old→new status change', async () => {
      // Use the slip from the first test (it's back in draft now)
      const caller = await staffCaller();
      await caller.payroll.payslipFinalize({ id: slipId }); // re-finalize it

      const logs = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: { entityType: 'payslip', entityId: slipId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      );

      const reopenLog = logs.find((l) =>
        l.body?.includes('Mở lại phiếu lương'),
      );
      expect(reopenLog).toBeDefined();
      expect(reopenLog?.changes).toContainEqual(
        expect.objectContaining({
          field: 'status',
          old: 'finalized',
          new: 'draft',
        }),
      );
    });
  });

  describe('payslipBulkMarkPaid: facility+period → paid', () => {
    let slip1Id: string;
    let slip2Id: string;
    let slip3Id: string; // draft, should be skipped

    beforeAll(async () => {
      const caller = await staffCaller();

      // Create 2 finalized slips for the same period
      const s1 = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: '2099-11',
        standardDays: 22,
        workdays: 22,
        kpiScore: 75,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      slip1Id = s1.id;
      createdSlipIds.push(slip1Id);
      await caller.payroll.payslipFinalize({ id: slip1Id });

      const s2 = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-11',
        standardDays: 22,
        workdays: 21,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      slip2Id = s2.id;
      createdSlipIds.push(slip2Id);
      await caller.payroll.payslipFinalize({ id: slip2Id });
    });

    it('bulk mark paid: all finalized in facility+period → paid status, skips non-finalized', async () => {
      const caller = await staffCaller();

      // Create a draft slip to ensure it's skipped
      const draftSlip = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-12',
        standardDays: 22,
        workdays: 20,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      slip3Id = draftSlip.id;
      createdSlipIds.push(slip3Id);

      const result = await caller.payroll.payslipBulkMarkPaid({
        facilityId: FAC,
        periodKey: '2099-11',
      });

      expect(result.paidCount).toBe(2); // Only the 2 finalized slips

      // Verify statuses
      const slips = await withRls(SUPER, (tx) =>
        tx.payslip.findMany({
          where: { id: { in: [slip1Id, slip2Id] } },
          select: { status: true, paidAt: true },
        }),
      );
      expect(slips).toHaveLength(2);
      expect(slips.every((s) => s.status === 'paid')).toBe(true);
      expect(slips.every((s) => s.paidAt !== null)).toBe(true);

      // Verify draft slip untouched
      const draftAfter = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slip3Id } }),
      );
      expect(draftAfter.status).toBe('draft');
      expect(draftAfter.paidAt).toBeNull();
    });

    it('bulk mark paid: zero finalized → returns { paidCount: 0 }', async () => {
      const caller = await staffCaller();
      const result = await caller.payroll.payslipBulkMarkPaid({
        facilityId: FAC,
        periodKey: '2099-13', // no slips for this period
      });
      expect(result.paidCount).toBe(0);
    });

    it('bulk mark paid: idempotent re-run (already paid)', async () => {
      const caller = await staffCaller();

      // First run (from previous test): slips are paid
      const result2 = await caller.payroll.payslipBulkMarkPaid({
        facilityId: FAC,
        periodKey: '2099-11',
      });
      // Should find 0 finalized (all are already paid)
      expect(result2.paidCount).toBe(0);
    });

    it('bulk mark paid: audit logs created for each slip', async () => {
      const caller = await staffCaller();
      const periodForLog = '2099-14';

      // Create 1 finalized slip
      const slip = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: periodForLog,
        standardDays: 22,
        workdays: 22,
        kpiScore: 70,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      const slipId = slip.id;
      createdSlipIds.push(slipId);
      await caller.payroll.payslipFinalize({ id: slipId });

      // Bulk mark paid
      await caller.payroll.payslipBulkMarkPaid({ facilityId: FAC, periodKey: periodForLog });

      // Check audit logs
      const logs = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: { entityType: 'payslip', entityId: slipId },
          orderBy: { createdAt: 'desc' },
          take: 2,
        }),
      );

      const bulkPayLog = logs.find((l) =>
        l.body?.includes('Trả lương hàng loạt'),
      );
      expect(bulkPayLog).toBeDefined();
      expect(bulkPayLog?.changes).toContainEqual(
        expect.objectContaining({
          field: 'status',
          old: 'finalized',
          new: 'paid',
        }),
      );
    });
  });

  describe('Commission override after auto-feed + KPI preservation', () => {
    let saleSlipId: string;

    beforeAll(async () => {
      const caller = await staffCaller();

      // Create a draft payslip with initial commission (simulate auto-feed or manual input)
      const slip = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: '2099-10',
        standardDays: 22,
        workdays: 22,
        kpiScore: 90, // High KPI bonus
        variablePay: 1_000_000, // Initial commission
        insuranceDeduction: 100_000,
      });
      saleSlipId = slip.id;
      createdSlipIds.push(saleSlipId);
      // Slip is created with the values from compute()
    });

    it('override commission: variablePay changes, KPI bonus preserved, net recomputed', async () => {
      const managerCaller = staffCaller({
        userId: managerId,
        roles: [Role.quan_ly],
        primaryRole: Role.quan_ly,
        isSuperAdmin: false,
        facilityIds: [FAC],
      });

      const before = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: saleSlipId } }),
      );
      const beforeCommission = before.variablePay;
      const beforeKpiBonus = before.kpiBonus;
      const beforeNet = before.netIncome;

      // Override commission to a higher amount
      const overrideAmount = beforeCommission + 500_000;
      const caller = await managerCaller;
      await caller.payroll.payslipOverrideVariablePay({
        userId: saleId,
        periodKey: '2099-10',
        amount: overrideAmount,
        reason: 'Bù hoa hồng thêm 500k',
      });

      const after = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: saleSlipId } }),
      );

      // Commission is overridden
      expect(after.variablePay).toBe(overrideAmount);
      expect(after.variablePay).toBeGreaterThan(beforeCommission);

      // KPI bonus must be PRESERVED (not recalculated from score)
      expect(after.kpiBonus).toBe(beforeKpiBonus);

      // Net income must change due to increased variable pay
      expect(after.netIncome).toBeGreaterThan(beforeNet);

      // Gross income must increase by the difference
      expect(after.grossIncome).toBe(before.grossIncome + (overrideAmount - beforeCommission));
    });

    it('override is audited with old→new commission and reason', async () => {
      // The previous test already did the override. Check the log.
      const logs = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: { entityType: 'payslip', entityId: saleSlipId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      );

      const overrideLog = logs.find((l) =>
        l.body?.includes('Điều chỉnh hoa hồng'),
      );
      expect(overrideLog).toBeDefined();
      expect(overrideLog?.body).toContain('Lý do:');
      expect(overrideLog?.body).toContain('Bù hoa hồng thêm 500k');
      expect(overrideLog?.changes).toContainEqual(
        expect.objectContaining({
          field: 'variablePay',
        }),
      );
    });

    it('override on finalized slip is CONFLICT (must reopen first)', async () => {
      const managerCaller = staffCaller({
        userId: managerId,
        roles: [Role.quan_ly],
        primaryRole: Role.quan_ly,
        isSuperAdmin: false,
        facilityIds: [FAC],
      });

      // Finalize the slip
      await withRls(SUPER, (tx) =>
        tx.payslip.update({ where: { id: saleSlipId }, data: { status: 'finalized' } }),
      );

      const caller = await managerCaller;
      await expect(
        caller.payroll.payslipOverrideVariablePay({
          userId: saleId,
          periodKey: '2099-10',
          amount: 2_000_000,
          reason: 'test',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: /chỉ điều chỉnh được phiếu ở trạng thái nháp/i,
      });
    });
  });

  describe('Full correction cycle: reopen → recompute → re-finalize', () => {
    let correctSlipId: string;

    beforeAll(async () => {
      const caller = await staffCaller();

      const slip = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-15',
        standardDays: 22,
        workdays: 15, // Initial: 15 days
        variablePay: 0,
        insuranceDeduction: 50_000,
      });
      correctSlipId = slip.id;
      createdSlipIds.push(correctSlipId);

      await caller.payroll.payslipFinalize({ id: correctSlipId });
    });

    it('full cycle: finalized → reopen → recompute with new data → re-finalize', async () => {
      const caller = await staffCaller();

      const finalized1 = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: correctSlipId } }),
      );
      expect(finalized1.status).toBe('finalized');
      const workdays1 = finalized1.workdays;
      const net1 = finalized1.netIncome;

      // Reopen
      await caller.payroll.payslipReopen({ id: correctSlipId });
      const reopened = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: correctSlipId } }),
      );
      expect(reopened.status).toBe('draft');

      // Recompute with corrected data (more workdays)
      const recomputed = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-15',
        standardDays: 22,
        workdays: 22, // Corrected: 22 days (full month)
        variablePay: 0,
        insuranceDeduction: 50_000,
      });
      expect(recomputed.status).toBe('draft');
      expect(recomputed.workdays).toBe(22);
      // Net should increase (more workdays)
      expect(recomputed.netIncome).toBeGreaterThan(net1);

      // Re-finalize
      const finalized2 = await caller.payroll.payslipFinalize({ id: correctSlipId });
      expect(finalized2.status).toBe('finalized');
      expect(finalized2.workdays).toBe(22);
      expect(finalized2.netIncome).toBeGreaterThan(net1);
    });

    it('full cycle generates audit trail: finalize → reopen → (compute) → finalize', async () => {
      const logs = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: { entityType: 'payslip', entityId: correctSlipId },
          orderBy: { createdAt: 'asc' },
        }),
      );

      // Expect logs for: initial finalize, reopen, and re-finalize
      const finalizeLog1 = logs.find(
        (l, i) => l.body?.includes('Chốt phiếu lương') && logs.indexOf(l) === i,
      );
      const reopenLog = logs.find((l) => l.body?.includes('Mở lại phiếu lương'));
      const finalizeLog2 = logs.find(
        (l) =>
          l.body?.includes('Chốt phiếu lương') &&
          l.createdAt > reopenLog?.createdAt!,
      );

      expect(finalizeLog1).toBeDefined();
      expect(reopenLog).toBeDefined();
      expect(finalizeLog2).toBeDefined();
      expect(reopenLog?.changes).toContainEqual(
        expect.objectContaining({ field: 'status', old: 'finalized', new: 'draft' }),
      );
    });
  });

  describe('Edge cases & guards', () => {
    it('non-HR caller is denied payslipReopen (requires payroll.payslipReopen permission)', async () => {
      const caller = await staffCaller({
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        isSuperAdmin: false,
        facilityIds: [FAC],
      });

      const slip = await withRls(SUPER, (tx) =>
        tx.payslip.create({
          data: {
            facilityId: FAC,
            userId: teacherId,
            periodKey: '2099-16',
            standardDays: 22,
            workdays: 22,
            kpiScore: 0,
            kpiGrade: 'C',
            baseEarned: 8_000_000,
            allowanceEarned: 500_000,
            kpiBonus: 0,
            variablePay: 0,
            insuranceDeduction: 0,
            dependents: 0,
            grossIncome: 8_500_000,
            taxableIncome: 8_500_000,
            pitAmount: 0,
            netIncome: 8_500_000,
            status: 'finalized',
            computedById: managerId,
            finalizedById: managerId,
            finalizedAt: new Date(),
          },
        }),
      );
      createdSlipIds.push(slip.id);

      await expect(caller.payroll.payslipReopen({ id: slip.id })).rejects.toThrow(
        /FORBIDDEN|UNAUTHORIZED/i,
      );
    });

    it('non-HR caller is denied payslipBulkMarkPaid', async () => {
      const caller = await staffCaller({
        roles: [Role.giao_vien],
        primaryRole: Role.giao_vien,
        isSuperAdmin: false,
        facilityIds: [FAC],
      });

      await expect(
        caller.payroll.payslipBulkMarkPaid({
          facilityId: FAC,
          periodKey: '2099-16',
        }),
      ).rejects.toThrow(/FORBIDDEN|UNAUTHORIZED/i);
    });

    it('reopen a draft slip is BAD_REQUEST (only finalized can be reopened)', async () => {
      const caller = await staffCaller();

      const slip = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-17',
        standardDays: 22,
        workdays: 20,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      createdSlipIds.push(slip.id);

      // Try to reopen a draft slip
      await expect(caller.payroll.payslipReopen({ id: slip.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: /chỉ mở lại phiếu đã chốt/i,
      });
    });

    it('bulkMarkPaid ignores empty period (no slips to update)', async () => {
      const caller = await staffCaller();
      const result = await caller.payroll.payslipBulkMarkPaid({
        facilityId: 999, // Non-existent facility
        periodKey: '2099-99',
      });
      expect(result.paidCount).toBe(0);
    });
  });

  describe('Stability: multiple runs', () => {
    it('payslipReopen idempotent over multiple re-opens', async () => {
      const caller = await staffCaller();

      const slip = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: '2099-20',
        standardDays: 22,
        workdays: 22,
        kpiScore: 70,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      const slipId = slip.id;
      createdSlipIds.push(slipId);

      // finalize → reopen → finalize → reopen → finalize
      await caller.payroll.payslipFinalize({ id: slipId });
      let state = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(state.status).toBe('finalized');

      await caller.payroll.payslipReopen({ id: slipId });
      state = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(state.status).toBe('draft');

      await caller.payroll.payslipFinalize({ id: slipId });
      state = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(state.status).toBe('finalized');

      await caller.payroll.payslipReopen({ id: slipId });
      state = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(state.status).toBe('draft');

      await caller.payroll.payslipFinalize({ id: slipId });
      state = await withRls(SUPER, (tx) =>
        tx.payslip.findUniqueOrThrow({ where: { id: slipId } }),
      );
      expect(state.status).toBe('finalized');
    });

    it('payslipBulkMarkPaid stable across multiple runs (no state corruption)', async () => {
      const caller = await staffCaller();

      // Create 2 finalized slips (one for each employee) in same period
      const slips = [];
      const slip1 = await caller.payroll.payslipCompute({
        userId: saleId,
        facilityId: FAC,
        periodKey: '2099-21',
        standardDays: 22,
        workdays: 22,
        kpiScore: 70,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      await caller.payroll.payslipFinalize({ id: slip1.id });
      slips.push(slip1.id);
      createdSlipIds.push(slip1.id);

      const slip2 = await caller.payroll.payslipCompute({
        userId: teacherId,
        facilityId: FAC,
        periodKey: '2099-21',
        standardDays: 22,
        workdays: 22,
        variablePay: 0,
        insuranceDeduction: 0,
      });
      await caller.payroll.payslipFinalize({ id: slip2.id });
      slips.push(slip2.id);
      createdSlipIds.push(slip2.id);

      // Run 1
      const r1 = await caller.payroll.payslipBulkMarkPaid({
        facilityId: FAC,
        periodKey: '2099-21',
      });
      expect(r1.paidCount).toBe(2);

      // Run 2 (idempotent)
      const r2 = await caller.payroll.payslipBulkMarkPaid({
        facilityId: FAC,
        periodKey: '2099-21',
      });
      expect(r2.paidCount).toBe(0); // No finalized left

      // Verify all are paid
      const finalSlips = await withRls(SUPER, (tx) =>
        tx.payslip.findMany({ where: { id: { in: slips } } }),
      );
      expect(finalSlips.every((s) => s.status === 'paid')).toBe(true);
    });
  });
});
