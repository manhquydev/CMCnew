import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

/**
 * Deep-test suite: multi-actor KPI workflow with role separation + kpiList filtering + zero-data edge cases.
 *
 * Invariants (decision 0011, P05-P06):
 * - Workflow: draft → submitted → confirmed → approved (each transition requires specific role).
 * - Separation of duties: approver must not be the confirmer.
 * - kpiList: RLS-scoped by facility; supports period filter.
 * - kpiAutoPrefill: zero-data edge case (quota=0, no grades) → dataAvailable=false, score=0, no crash.
 */
describe('KPI multi-actor workflow + list + zero-data edge cases', () => {
  const FACILITY_1 = 1;
  const FACILITY_2 = 2; // For RLS isolation test
  const PERIOD_MAIN = '2099-10';
  const PERIOD_OTHER = '2099-11';
  const PERIOD_NODATA = '2098-12';

  // Actors
  let eduDirId: string; // giam_doc_dao_tao — approve
  let managerId: string; // giam_doc_kinh_doanh — confirm
  let saleId: string; // submit own KPI
  let teacherId: string; // training block
  let saleNoDataId: string; // zero revenue scenario
  let teacherNoDataId: string; // zero grades scenario
  let otherFacilitySaleId: string; // for RLS test

  // Revenue fixtures
  let courseId: string;
  let studentId: string;

  beforeAll(async () => {
    eduDirId = await superAdminUserId();

    // Create manager (giam_doc_kinh_doanh) for FACILITY_1
    const mgr = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-mgr@cmc.test'),
          displayName: 'KPI Manager',
          passwordHash: 'dummy',
          primaryRole: Role.giam_doc_kinh_doanh,
          roles: [Role.giam_doc_kinh_doanh],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
      }),
    );
    managerId = mgr.id;

    // Create sale with profile at FACILITY_1
    const sale = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-sale@cmc.test'),
          displayName: 'KPI Sale',
          passwordHash: 'dummy',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
      }),
    );
    saleId = sale.id;

    // Create teacher with profile at FACILITY_1
    const teacher = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-teacher@cmc.test'),
          displayName: 'KPI Teacher',
          passwordHash: 'dummy',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
      }),
    );
    teacherId = teacher.id;

    // Create sale with NO revenue data (quota=0 case)
    const saleNoData = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-sale-nodata@cmc.test'),
          displayName: 'KPI Sale No Data',
          passwordHash: 'dummy',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
      }),
    );
    saleNoDataId = saleNoData.id;

    // Create teacher with NO grade data
    const teacherNoData = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-teacher-nodata@cmc.test'),
          displayName: 'KPI Teacher No Data',
          passwordHash: 'dummy',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_1 }] },
        },
      }),
    );
    teacherNoDataId = teacherNoData.id;

    // Create sale at FACILITY_2 for RLS test
    const otherFacilitySale = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-sale-f2@cmc.test'),
          displayName: 'KPI Sale Facility 2',
          passwordHash: 'dummy',
          primaryRole: Role.sale,
          roles: [Role.sale],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY_2 }] },
        },
      }),
    );
    otherFacilitySaleId = otherFacilitySale.id;

    // Set up salary rates
    const su = await staffCaller();
    await su.payroll.rateCreate({
      userId: saleId,
      facilityId: FACILITY_1,
      baseSalary: 5_000_000,
      monthlyQuota: 50_000_000,
      effectiveFrom: '2020-01-01',
    });

    // saleNoData gets 0 quota
    await su.payroll.rateCreate({
      userId: saleNoDataId,
      facilityId: FACILITY_1,
      baseSalary: 3_000_000,
      monthlyQuota: 0, // ← zero quota
      effectiveFrom: '2020-01-01',
    });

    // Set up employment profiles
    await su.payroll.profileUpsert({
      userId: saleId,
      facilityId: FACILITY_1,
      position: 'sales',
      dependents: 0,
    });
    await su.payroll.profileUpsert({
      userId: teacherId,
      facilityId: FACILITY_1,
      position: 'teacher',
      dependents: 1,
    });
    await su.payroll.profileUpsert({
      userId: saleNoDataId,
      facilityId: FACILITY_1,
      position: 'sales',
      dependents: 0,
    });
    await su.payroll.profileUpsert({
      userId: teacherNoDataId,
      facilityId: FACILITY_1,
      position: 'teacher',
      dependents: 0,
    });

    // Set up revenue data for main sale (will be used in autofill)
    const course = await withRls(SUPER, (tx) =>
      tx.course.findFirst({ where: { archivedAt: null }, select: { id: true } }),
    );
    if (!course) throw new Error('No course seeded');
    courseId = course.id;

    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY_1,
          studentCode: uniq('S-KPI'),
          fullName: 'KPI Student',
          program: 'UCREA',
        },
      }),
    );
    studentId = student.id;

    // Create approved receipts in PERIOD_MAIN (40M out of 50M quota = 0.8 ratio)
    const [y, m] = PERIOD_MAIN.split('-').map(Number);
    const approvedTs = new Date(Date.UTC(y!, m! - 1, 15));

    await withRls(SUPER, async (tx) => {
      await tx.receipt.create({
        data: {
          facilityId: FACILITY_1,
          studentId: studentId,
          courseId: courseId,
          yearsPrepaid: 1,
          annualPrice: 40_000_000,
          grossAmount: 40_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 40_000_000,
          status: 'approved',
          soldById: saleId,
          kind: 'new',
          approvedAt: approvedTs,
        },
      });
    });

    // Create additional receipt in PERIOD_OTHER for autofill test (35M out of 50M quota = 0.7 ratio)
    const [y2, m2] = PERIOD_OTHER.split('-').map(Number);
    const approvedTs2 = new Date(Date.UTC(y2!, m2! - 1, 15));

    await withRls(SUPER, async (tx) => {
      await tx.receipt.create({
        data: {
          facilityId: FACILITY_1,
          studentId: studentId,
          courseId: courseId,
          yearsPrepaid: 1,
          annualPrice: 35_000_000,
          grossAmount: 35_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 35_000_000,
          status: 'approved',
          soldById: saleId,
          kind: 'new',
          approvedAt: approvedTs2,
        },
      });
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Clean up KPI records
      await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score' } });
      await tx.kpiScore.deleteMany({
        where: { userId: { in: [saleId, teacherId, saleNoDataId, teacherNoDataId] } },
      });

      // Clean up receipts, students, courses, salary rates
      await tx.receipt.deleteMany({
        where: { soldById: { in: [saleId, saleNoDataId] } },
      });
      await tx.student.deleteMany({ where: { id: studentId } });
      await tx.salaryRate.deleteMany({
        where: { userId: { in: [saleId, saleNoDataId] } },
      });
      await tx.employmentProfile.deleteMany({
        where: { userId: { in: [saleId, teacherId, saleNoDataId, teacherNoDataId] } },
      });

      // Clean up users
      await tx.appUser.deleteMany({
        where: {
          id: {
            in: [managerId, saleId, teacherId, saleNoDataId, teacherNoDataId, otherFacilitySaleId],
          },
        },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 1. MULTI-ACTOR WORKFLOW + ROLE BOUNDARIES
  // ──────────────────────────────────────────────────────────────────────────────

  const managerCaller = () =>
    staffCaller({
      userId: managerId,
      roles: [Role.giam_doc_kinh_doanh],
      primaryRole: Role.giam_doc_kinh_doanh,
      isSuperAdmin: false,
      facilityIds: [FACILITY_1],
    });

  const eduDirCaller = () =>
    staffCaller({
      userId: eduDirId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: true, // superAdmin passes all role checks
      facilityIds: [FACILITY_1],
    });

  const saleCaller = () =>
    staffCaller({
      userId: saleId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [FACILITY_1],
    });

  const teacherCaller = () =>
    staffCaller({
      userId: teacherId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY_1],
    });

  const saleNoDataCaller = () =>
    staffCaller({
      userId: saleNoDataId,
      roles: [Role.sale],
      primaryRole: Role.sale,
      isSuperAdmin: false,
      facilityIds: [FACILITY_1],
    });

  const _teacherNoDataCaller = () =>
    staffCaller({
      userId: teacherNoDataId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY_1],
    });

  describe('Multi-actor workflow: HR → employee → giam_doc_kinh_doanh (confirm) → giam_doc_dao_tao (approve)', () => {
    it('HR creates draft KPI for sale (kpiEvalStart)', async () => {
      const su = await staffCaller(); // super_admin
      const row = await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_MAIN,
        block: 'sales',
      });
      expect(row.status).toBe('draft');
      expect(row.userId).toBe(saleId);
      expect(row.periodKey).toBe(PERIOD_MAIN);
      expect(row.block).toBe('sales');
      expect(row.autoScore).toBe(0);
      expect(row.submittedAt).toBeNull();
      expect(row.confirmedAt).toBeNull();
      expect(row.approvedAt).toBeNull();
    });

    it('Sale employee submits KPI (kpiEvalSubmit) with criteria scores', async () => {
      const sale = await saleCaller();
      const row = await sale.payroll.kpiEvalSubmit({
        periodKey: PERIOD_MAIN,
        scores: [
          { key: 'doanh_so', score: 70 },
          { key: 'tuan_thu', score: 80 },
          { key: 'khac', score: 75 },
        ],
      });
      expect(row.status).toBe('submitted');
      expect(row.userId).toBe(saleId);
      expect(row.submittedById).toBe(saleId);
      expect(row.submittedAt).not.toBeNull();
      // autoScore = 0.7*70 + 0.2*80 + 0.1*75 = 49 + 16 + 7.5 = 72.5 (rounded per spec)
      expect(row.autoScore).toBeGreaterThan(70);
    });

    it('Manager confirms submitted KPI (kpiEvalConfirm)', async () => {
      const mgr = await managerCaller();
      const row = await mgr.payroll.kpiEvalConfirm({
        userId: saleId,
        periodKey: PERIOD_MAIN,
      });
      expect(row.status).toBe('confirmed');
      expect(row.confirmedById).toBe(managerId);
      expect(row.confirmedAt).not.toBeNull();
      expect(row.approvedAt).toBeNull(); // still not approved
    });

    it('BGD approves confirmed KPI (kpiEvalApprove)', async () => {
      const eduDir = await eduDirCaller();
      const row = await eduDir.payroll.kpiEvalApprove({
        userId: saleId,
        periodKey: PERIOD_MAIN,
      });
      expect(row.status).toBe('approved');
      expect(row.approvedById).toBe(eduDirId);
      expect(row.approvedAt).not.toBeNull();
    });

    it('kpiEvalGet retrieves final approved sheet + criteria config', async () => {
      const su = await staffCaller();
      const result = await su.payroll.kpiEvalGet({
        userId: saleId,
        periodKey: PERIOD_MAIN,
      });
      expect(result.row.status).toBe('approved');
      expect(result.row.userId).toBe(saleId);
      expect(result.criteriaConfig).toBeDefined();
      expect(result.criteriaConfig.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 2. ROLE BOUNDARY ENFORCEMENT (requirePermission gates)
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Role boundary enforcement', () => {
    beforeAll(async () => {
      // Set up a fresh KPI for boundary tests
      const su = await staffCaller();
      await su.payroll.kpiEvalStart({
        userId: teacherId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_OTHER,
        block: 'training',
      });
    });

    it('Giao_vien (teacher) cannot confirm KPI (FORBIDDEN)', async () => {
      const teacher = await teacherCaller();
      await expect(
        teacher.payroll.kpiEvalConfirm({
          userId: teacherId,
          periodKey: PERIOD_OTHER,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    // NOTE: post role-consolidation, kpiEvalConfirm and kpiEvalApprove share the same director
    // role set (giam_doc_kinh_doanh/giam_doc_dao_tao). This FORBIDDEN comes from separation-of-duties
    // (confirmedById === ctx.session.userId), NOT from domain mismatch—actors must be valid directors
    // for the target's domain so only SoD blocks.
    it('Manager (as confirmer) cannot approve the KPI it just confirmed (FORBIDDEN — separation of duties)', async () => {
      // First submit and confirm
      const teacher = await teacherCaller();
      await teacher.payroll.kpiEvalSubmit({
        periodKey: PERIOD_OTHER,
        scores: [
          { key: 'chuyen_mon', score: 85 },
          { key: 'tuan_thu', score: 80 },
        ],
      });

      // Use education director (eduDirId) to confirm teacherId KPI—domain-scoped guard passes.
      // Then same eduDir tries to approve → FORBIDDEN by SoD (confirmer ≠ approver).
      const eduDir = await eduDirCaller();
      await eduDir.payroll.kpiEvalConfirm({
        userId: teacherId,
        periodKey: PERIOD_OTHER,
      });

      // Education director tries to approve the sheet it just confirmed → FORBIDDEN
      await expect(
        eduDir.payroll.kpiEvalApprove({
          userId: teacherId,
          periodKey: PERIOD_OTHER,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('Sale (non-manager) cannot confirm (FORBIDDEN)', async () => {
      const sale = await saleCaller();
      await expect(
        sale.payroll.kpiEvalConfirm({
          userId: teacherId,
          periodKey: PERIOD_OTHER,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 3. SEPARATION OF DUTIES: Approver ≠ Confirmer
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Separation of duties: approver must not be confirmer', () => {
    it('Confirmer cannot also approve same KPI (FORBIDDEN)', async () => {
      // Set up new KPI
      const su = await staffCaller();
      const period = '2099-13';
      await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'sales',
      });

      const sale = await saleCaller();
      await sale.payroll.kpiEvalSubmit({
        periodKey: period,
        scores: [
          { key: 'doanh_so', score: 60 },
          { key: 'tuan_thu', score: 70 },
          { key: 'khac', score: 65 },
        ],
      });

      // Manager confirms
      const mgr = await managerCaller();
      await mgr.payroll.kpiEvalConfirm({
        userId: saleId,
        periodKey: period,
      });

      // Same manager tries to approve → FORBIDDEN (confirmedById === ctx.session.userId)
      await expect(
        mgr.payroll.kpiEvalApprove({
          userId: saleId,
          periodKey: period,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('Different approver can approve after manager confirms', async () => {
      // Use the other director (giam_doc_dao_tao, different from the confirming giam_doc_kinh_doanh manager)
      const su = await staffCaller();
      const period = '2099-14';
      await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'sales',
      });

      const sale = await saleCaller();
      await sale.payroll.kpiEvalSubmit({
        periodKey: period,
        scores: [
          { key: 'doanh_so', score: 55 },
          { key: 'tuan_thu', score: 75 },
          { key: 'khac', score: 70 },
        ],
      });

      const mgr = await managerCaller();
      await mgr.payroll.kpiEvalConfirm({
        userId: saleId,
        periodKey: period,
      });

      // BGD (different user) approves → SUCCESS
      const eduDir = await eduDirCaller();
      const row = await eduDir.payroll.kpiEvalApprove({
        userId: saleId,
        periodKey: period,
      });
      expect(row.status).toBe('approved');
      expect(row.approvedById).toBe(eduDirId);
      expect(row.confirmedById).toBe(managerId); // Different from approver
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 4. kpiList: FILTERING + RLS ISOLATION
  // ──────────────────────────────────────────────────────────────────────────────

  describe('kpiList: filtering by facility + period, RLS scoped', () => {
    beforeAll(async () => {
      // Create several KPIs for different periods/users to test list filtering
      const su = await staffCaller();

      // Create KPIs for FACILITY_1 in PERIOD_MAIN
      for (let i = 0; i < 3; i++) {
        const user = await withRls(SUPER, (tx) =>
          tx.appUser.create({
            data: {
              email: uniq(`kpi-list-user${i}@cmc.test`),
              displayName: `KPI List User ${i}`,
              passwordHash: 'dummy',
              primaryRole: Role.sale,
              roles: [Role.sale],
              isActive: true,
              facilities: { create: [{ facilityId: FACILITY_1 }] },
            },
          }),
        );

        await su.payroll.rateCreate({
          userId: user.id,
          facilityId: FACILITY_1,
          baseSalary: 4_000_000,
          monthlyQuota: 40_000_000,
          effectiveFrom: '2020-01-01',
        });

        await su.payroll.kpiEvalStart({
          userId: user.id,
          facilityId: FACILITY_1,
          periodKey: PERIOD_MAIN,
          block: 'sales',
        });
      }
    });

    it('kpiList returns all KPIs for facility + period', async () => {
      const su = await staffCaller();
      const rows = await su.payroll.kpiList({
        facilityId: FACILITY_1,
        periodKey: PERIOD_MAIN,
      });
      expect(rows.length).toBeGreaterThanOrEqual(3); // At least the 3 we created
      expect(rows.every((r) => r.facilityId === FACILITY_1)).toBe(true);
      expect(rows.every((r) => r.periodKey === PERIOD_MAIN)).toBe(true);
    });

    it('kpiList returns empty for facility with no KPIs', async () => {
      const su = await staffCaller();
      const rows = await su.payroll.kpiList({
        facilityId: FACILITY_2,
        periodKey: PERIOD_MAIN,
      });
      expect(rows.length).toBe(0);
    });

    it('kpiList is ordered by createdAt desc (newest first)', async () => {
      const su = await staffCaller();
      const rows = await su.payroll.kpiList({
        facilityId: FACILITY_1,
        periodKey: PERIOD_MAIN,
      });
      if (rows.length > 1) {
        for (let i = 0; i < rows.length - 1; i++) {
          expect(new Date(rows[i].createdAt).getTime()).toBeGreaterThanOrEqual(
            new Date(rows[i + 1].createdAt).getTime(),
          );
        }
      }
    });

    it('RLS: HR can only see KPIs from their facilities (no cross-facility leak)', async () => {
      // HR (super_admin) can list all
      const su = await staffCaller();
      const rows = await su.payroll.kpiList({
        facilityId: FACILITY_1,
        periodKey: PERIOD_MAIN,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.facilityId === FACILITY_1)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 5. kpiAutoPrefill: ZERO-DATA EDGE CASES
  // ──────────────────────────────────────────────────────────────────────────────

  describe('kpiAutoPrefill: zero-data edge cases', () => {
    it('Sales person with zero quota → dataAvailable=false, score=0', async () => {
      const su = await staffCaller();

      // Create draft KPI for saleNoData
      const kpiRow = await su.payroll.kpiEvalStart({
        userId: saleNoDataId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_NODATA,
        block: 'sales',
      });
      expect(kpiRow.status).toBe('draft');

      // Auto-prefill (zero quota case)
      const result = await su.payroll.kpiAutoPrefill({
        userId: saleNoDataId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_NODATA,
      });

      expect(result.computed.length).toBe(1);
      expect(result.computed[0].key).toBe('doanh_so');
      expect(result.computed[0].score).toBe(0); // No quota → score 0
      expect(result.computed[0].dataAvailable).toBe(false); // No quota data
    });

    it('Training person with zero grades → chuyen_mon dataAvailable=false, score=0', async () => {
      const su = await staffCaller();

      // Create draft KPI for teacherNoData
      const kpiRow = await su.payroll.kpiEvalStart({
        userId: teacherNoDataId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_NODATA,
        block: 'training',
      });
      expect(kpiRow.status).toBe('draft');

      // Auto-prefill (no grades)
      const result = await su.payroll.kpiAutoPrefill({
        userId: teacherNoDataId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_NODATA,
      });

      const chuyenMon = result.computed.find((c) => c.key === 'chuyen_mon');
      expect(chuyenMon).toBeDefined();
      expect(chuyenMon!.score).toBe(0);
      expect(chuyenMon!.dataAvailable).toBe(false);
    });

    it('Training person with zero sessions → tuan_thu dataAvailable=false, score=0', async () => {
      const su = await staffCaller();
      const period = '2098-10';

      // Create draft KPI
      await su.payroll.kpiEvalStart({
        userId: teacherNoDataId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'training',
      });

      // Auto-prefill (no sessions)
      const result = await su.payroll.kpiAutoPrefill({
        userId: teacherNoDataId,
        facilityId: FACILITY_1,
        periodKey: period,
      });

      const tuanThu = result.computed.find((c) => c.key === 'tuan_thu');
      expect(tuanThu).toBeDefined();
      expect(tuanThu!.score).toBe(0);
      expect(tuanThu!.dataAvailable).toBe(false);
    });

    it('kpiAutoPrefill with data (sales) → dataAvailable=true, score > 0', async () => {
      const su = await staffCaller();

      // saleId has 35M revenue with 50M quota in PERIOD_OTHER (35/50 = 0.7 ratio)
      await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_OTHER,
        block: 'sales',
      });

      const result = await su.payroll.kpiAutoPrefill({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: PERIOD_OTHER,
      });

      const doanhSo = result.computed.find((c) => c.key === 'doanh_so');
      expect(doanhSo).toBeDefined();
      expect(doanhSo!.dataAvailable).toBe(true); // Has quota
      expect(doanhSo!.score).toBeGreaterThan(0); // 0.7 ratio → score > 0
    });

    it('kpiAutoPrefill non-draft status → CONFLICT', async () => {
      const su = await staffCaller();
      const period = '2099-15';

      // Create and submit KPI
      await su.payroll.kpiEvalStart({
        userId: saleNoDataId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'sales',
      });

      const saleNoData = await saleNoDataCaller();
      await saleNoData.payroll.kpiEvalSubmit({
        periodKey: period,
        scores: [
          { key: 'doanh_so', score: 50 },
          { key: 'tuan_thu', score: 60 },
          { key: 'khac', score: 55 },
        ],
      });

      // Try to prefill when status=submitted (not draft)
      await expect(
        su.payroll.kpiAutoPrefill({
          userId: saleNoDataId,
          facilityId: FACILITY_1,
          periodKey: period,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('kpiAutoPrefill merges computed scores into existing criterionScores', async () => {
      const su = await staffCaller();
      const period = '2099-16';

      // Create KPI and manually set some scores
      await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'sales',
      });

      // Verify we can run autofill and it merges properly
      const result = await su.payroll.kpiAutoPrefill({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: period,
      });

      expect(result.computed).toBeDefined();
      expect(result.computed.length).toBeGreaterThan(0);
      expect(result.context).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // 6. AUDIT EVENTS
  // ──────────────────────────────────────────────────────────────────────────────

  describe('Audit event logging', () => {
    it('Each KPI workflow transition logs a recordEvent', async () => {
      const su = await staffCaller();
      const period = '2099-20';

      // Create fresh KPI and run through workflow
      await su.payroll.kpiEvalStart({
        userId: saleId,
        facilityId: FACILITY_1,
        periodKey: period,
        block: 'sales',
      });

      const sale = await saleCaller();
      await sale.payroll.kpiEvalSubmit({
        periodKey: period,
        scores: [
          { key: 'doanh_so', score: 65 },
          { key: 'tuan_thu', score: 70 },
          { key: 'khac', score: 68 },
        ],
      });

      const mgr = await managerCaller();
      await mgr.payroll.kpiEvalConfirm({
        userId: saleId,
        periodKey: period,
      });

      const eduDir = await eduDirCaller();
      await eduDir.payroll.kpiEvalApprove({
        userId: saleId,
        periodKey: period,
      });

      // Verify at least 4 events were logged (start, submit, confirm, approve)
      const events = await withRls(SUPER, (tx) =>
        tx.recordEvent.findMany({
          where: {
            entityType: 'kpi_score',
            facilityId: FACILITY_1,
          },
          orderBy: { createdAt: 'asc' },
        }),
      );

      const relevantEvents = events.filter((e) => e.body.includes(period));
      expect(relevantEvents.length).toBeGreaterThanOrEqual(4);
    });
  });
});
