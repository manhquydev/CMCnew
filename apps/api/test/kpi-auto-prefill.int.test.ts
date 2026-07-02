import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (P06, decision 0011): kpiAutoPrefill computes quantitative KPI criteria from real data
// and merges them into criterionScores on an existing draft KpiScore.
// Formulas: sales → doanh_so = ratioToScore(approvedRevenue/quota); training → chuyen_mon + tuan_thu.
// No data → score 0 + dataAvailable=false. Non-draft status → CONFLICT. Audit event written.
describe('kpiAutoPrefill (P06 — auto-prefill quantitative KPI criteria)', () => {
  const FACILITY = 1;
  // Isolated periods per scenario to avoid cross-test interference
  const PERIOD_SALES = '2099-11';
  const PERIOD_TEACHER = '2099-12';
  const PERIOD_NODATA = '2098-11';
  const PERIOD_CONFLICT = '2098-12';

  let saleUserId: string;
  let teacherUserId: string;
  let nodataUserId: string;
  let conflictUserId: string;

  // IDs for classroom/session/attendance fixtures
  let batchId: string;
  let session1Id: string;
  let session2Id: string;
  let enrollment1Id: string;
  let unit1Id: string;
  let unit2Id: string;

  beforeAll(async () => {
    const su = await staffCaller();

    // ── Sales user ──
    const saleUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-prefill-sale@cmc.test'),
          displayName: 'KPI Prefill Sale',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    saleUserId = saleUser.id;

    // Salary rate with quota 100_000_000 (100M)
    await su.payroll.rateCreate({
      userId: saleUserId,
      facilityId: FACILITY,
      baseSalary: 8_000_000,
      monthlyQuota: 100_000_000,
      effectiveFrom: '2020-01-01',
    });

    // Two receipts: 60M + 20M = 80M approved in period
    const studentForSale = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('S-SALE'),
          fullName: 'Sale Student',
          program: 'UCREA',
        },
      }),
    );
    const courseForSale = await withRls(SUPER, (tx) =>
      tx.course.findFirst({ where: { archivedAt: null }, select: { id: true } }),
    );
    if (!courseForSale) throw new Error('No course seeded — run pnpm db:seed');

    const [y, m] = PERIOD_SALES.split('-').map(Number);
    const approvedTs = new Date(Date.UTC(y!, m! - 1, 15)); // mid-period

    await withRls(SUPER, async (tx) => {
      await tx.receipt.create({
        data: {
          facilityId: FACILITY,
          studentId: studentForSale.id,
          courseId: courseForSale.id,
          yearsPrepaid: 1,
          annualPrice: 60_000_000,
          grossAmount: 60_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 60_000_000,
          status: 'approved',
          soldById: saleUserId,
          kind: 'new',
          approvedAt: approvedTs,
        },
      });
      await tx.receipt.create({
        data: {
          facilityId: FACILITY,
          studentId: studentForSale.id,
          courseId: courseForSale.id,
          yearsPrepaid: 1,
          annualPrice: 20_000_000,
          grossAmount: 20_000_000,
          tierPercent: 0,
          effectiveDiscountPercent: 0,
          netAmount: 20_000_000,
          status: 'approved',
          soldById: saleUserId,
          kind: 'renewal',
          approvedAt: approvedTs,
        },
      });
    });

    // ── Teacher user ──
    const teacherUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-prefill-teacher@cmc.test'),
          displayName: 'KPI Prefill Teacher',
          passwordHash: 'dummy',
          primaryRole: 'giao_vien',
          roles: ['giao_vien'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    teacherUserId = teacherUser.id;

    // 2 published grades: 8/10 and 6/10 → avg ratio = (0.8+0.6)/2 = 0.7 → chuyen_mon = 70
    const [ty, tm] = PERIOD_TEACHER.split('-').map(Number);
    const gradedTs = new Date(Date.UTC(ty!, tm! - 1, 10));

    const studentForTeacher = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('S-TEACH'),
          fullName: 'Teacher Student',
          program: 'UCREA',
        },
      }),
    );
    const studentForTeacher2 = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('S-TEACH2'),
          fullName: 'Teacher Student 2',
          program: 'UCREA',
        },
      }),
    );

    const courseForTeacher = courseForSale; // reuse same course
    // Need a batch → submissions → grades
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          code: uniq('B-2099'),
          courseId: courseForTeacher.id,
          name: 'KPI Prefill Batch',
          status: 'open',
        },
      }),
    );
    batchId = batch.id;

    // Curriculum units for exercises (need 2 distinct units since both are homework - unique constraint on unitId+type)
    const unit1 = await withRls(SUPER, (tx) =>
      tx.curriculumUnit.create({
        data: {
          courseId: courseForTeacher.id,
          unitCode: uniq('U'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'fixture',
          sessions: 1,
        },
      }),
    );
    unit1Id = unit1.id;
    const unit2 = await withRls(SUPER, (tx) =>
      tx.curriculumUnit.create({
        data: {
          courseId: courseForTeacher.id,
          unitCode: uniq('U'),
          seqInLevel: 2,
          orderGlobal: 2,
          unitType: 'LESSON',
          theme: 'fixture',
          sessions: 1,
        },
      }),
    );
    unit2Id = unit2.id;

    const ex1 = await withRls(SUPER, (tx) =>
      tx.exercise.create({
        data: {
          curriculumUnitId: unit1.id,
          title: 'Ex1',
          maxScore: 10,
          type: 'homework',
          status: 'published',
        },
      }),
    );
    const ex2 = await withRls(SUPER, (tx) =>
      tx.exercise.create({
        data: {
          curriculumUnitId: unit2.id,
          title: 'Ex2',
          maxScore: 10,
          type: 'homework',
          status: 'published',
        },
      }),
    );

    // Submissions then grades
    await withRls(SUPER, async (tx) => {
      const sub1 = await tx.submission.create({
        data: {
          facilityId: FACILITY,
          exerciseId: ex1.id,
          studentId: studentForTeacher.id,
          status: 'submitted',
        },
      });
      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: sub1.id,
          score: 8,
          maxScore: 10,
          gradedById: teacherUserId,
          gradedAt: gradedTs,
          isPublished: true,
        },
      });
      const sub2 = await tx.submission.create({
        data: {
          facilityId: FACILITY,
          exerciseId: ex2.id,
          studentId: studentForTeacher2.id,
          status: 'submitted',
        },
      });
      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: sub2.id,
          score: 6,
          maxScore: 10,
          gradedById: teacherUserId,
          gradedAt: gradedTs,
          isPublished: true,
        },
      });
    });

    // Sessions: 2 confirmed, teacherId=teacher, sessionDate in PERIOD_TEACHER
    // session1 has attendance with markedAt → counted
    // session2 has no attendance → not counted → tuan_thu = 1/2 × 100 = 50
    const sessionDate1 = new Date(Date.UTC(ty!, tm! - 1, 5));
    const sessionDate2 = new Date(Date.UTC(ty!, tm! - 1, 12));

    const sess1 = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: sessionDate1,
          startTime: '09:00',
          endTime: '11:00',
          teacherId: teacherUserId,
          status: 'confirmed',
        },
      }),
    );
    session1Id = sess1.id;

    const sess2 = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: sessionDate2,
          startTime: '09:00',
          endTime: '11:00',
          teacherId: teacherUserId,
          status: 'confirmed',
        },
      }),
    );
    session2Id = sess2.id;

    // Enrollment for the attendance
    const enrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          studentId: studentForTeacher.id,
          status: 'active',
        },
      }),
    );
    enrollment1Id = enrollment.id;

    // Attendance on session1 only (markedAt set)
    await withRls(SUPER, (tx) =>
      tx.attendance.create({
        data: {
          facilityId: FACILITY,
          classSessionId: session1Id,
          enrollmentId: enrollment1Id,
          status: 'present',
          markedAt: new Date(),
          markedById: teacherUserId,
        },
      }),
    );

    // ── No-data user ──
    const nodataUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-prefill-nodata@cmc.test'),
          displayName: 'KPI Prefill No Data',
          passwordHash: 'dummy',
          primaryRole: 'giao_vien',
          roles: ['giao_vien'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    nodataUserId = nodataUser.id;

    // ── Conflict user (status≠draft) ──
    const conflictUser = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: uniq('kpi-prefill-conflict@cmc.test'),
          displayName: 'KPI Prefill Conflict',
          passwordHash: 'dummy',
          primaryRole: 'sale',
          roles: ['sale'],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      }),
    );
    conflictUserId = conflictUser.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Clean up audit events
      await tx.recordEvent.deleteMany({ where: { entityType: 'kpi_score' } });
      // Clean up KPI scores
      await tx.kpiScore.deleteMany({
        where: { userId: { in: [saleUserId, teacherUserId, nodataUserId, conflictUserId] } },
      });
      // Clean up attendance, sessions, grades, submissions, exercises
      if (session1Id) await tx.attendance.deleteMany({ where: { classSessionId: session1Id } });
      if (session2Id) await tx.attendance.deleteMany({ where: { classSessionId: session2Id } });
      await tx.classSession.deleteMany({ where: { classBatchId: batchId } });
      await tx.grade.deleteMany({ where: { gradedById: teacherUserId } });
      await tx.submission.deleteMany({ where: { facilityId: FACILITY } });
      await tx.exercise.deleteMany({ where: { curriculumUnitId: { in: [unit1Id, unit2Id].filter(Boolean) } } });
      await tx.curriculumUnit.deleteMany({ where: { id: { in: [unit1Id, unit2Id].filter(Boolean) } } });
      if (enrollment1Id) await tx.enrollment.deleteMany({ where: { id: enrollment1Id } });
      if (batchId) await tx.classBatch.deleteMany({ where: { id: batchId } });
      // Receipts
      await tx.receipt.deleteMany({ where: { soldById: saleUserId } });
      // Salary rates
      await tx.salaryRate.deleteMany({ where: { userId: saleUserId } });
      // Employment profiles
      await tx.employmentProfile.deleteMany({
        where: { userId: { in: [saleUserId, teacherUserId, nodataUserId, conflictUserId] } },
      });
      // Users
      await tx.appUser.deleteMany({
        where: { id: { in: [saleUserId, teacherUserId, nodataUserId, conflictUserId] } },
      });
    });
  });

  // ─── Sales: doanh_so = 80 (80M / 100M = 0.8 → ratioToScore → 80) ──────────

  it('sales: doanh_so=80 when approvedRevenue=80M and quota=100M', async () => {
    const hr = await staffCaller();

    // Start the KPI sheet first
    await hr.payroll.kpiEvalStart({
      userId: saleUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_SALES,
      block: 'sales',
    });

    const result = await hr.payroll.kpiAutoPrefill({
      userId: saleUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_SALES,
    });

    expect(result.computed).toHaveLength(1);
    const ds = result.computed.find((c) => c.key === 'doanh_so');
    expect(ds).toBeDefined();
    expect(ds!.score).toBe(80);
    expect(ds!.dataAvailable).toBe(true);
    expect(result.context.approvedRevenue).toBe(80_000_000);
    expect(result.context.quota).toBe(100_000_000);
  });

  it('sales: criterionScores merged — doanh_so updated, other keys preserved', async () => {
    // Verify the DB was actually updated
    const row = await withRls(SUPER, (tx) =>
      tx.kpiScore.findUnique({
        where: { userId_periodKey: { userId: saleUserId, periodKey: PERIOD_SALES } },
        select: { criterionScores: true },
      }),
    );
    const scores = row!.criterionScores as { key: string; score: number }[];
    const ds = scores.find((s) => s.key === 'doanh_so');
    expect(ds?.score).toBe(80);
    // Other policy-defined keys (e.g. tuan_thu, khac) preserved as 0
    const others = scores.filter((s) => s.key !== 'doanh_so');
    expect(others.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Teacher: chuyen_mon=70 + tuan_thu=50 ───────────────────────────────────

  it('teacher: chuyen_mon=70 (avg 8/10 and 6/10 published grades) and tuan_thu=50 (1/2 sessions marked)', async () => {
    const hr = await staffCaller();

    await hr.payroll.kpiEvalStart({
      userId: teacherUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_TEACHER,
      block: 'training',
    });

    const result = await hr.payroll.kpiAutoPrefill({
      userId: teacherUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_TEACHER,
    });

    expect(result.computed.length).toBe(2);

    const cm = result.computed.find((c) => c.key === 'chuyen_mon');
    expect(cm).toBeDefined();
    expect(cm!.score).toBe(70);
    expect(cm!.dataAvailable).toBe(true);

    const tt = result.computed.find((c) => c.key === 'tuan_thu');
    expect(tt).toBeDefined();
    expect(tt!.score).toBe(50);
    expect(tt!.dataAvailable).toBe(true);
  });

  // ─── No data → score 0 + dataAvailable=false ────────────────────────────────

  it('no-data teacher: chuyen_mon=0 dataAvailable=false, tuan_thu=0 dataAvailable=false', async () => {
    const hr = await staffCaller();

    await hr.payroll.kpiEvalStart({
      userId: nodataUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_NODATA,
      block: 'training',
    });

    const result = await hr.payroll.kpiAutoPrefill({
      userId: nodataUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_NODATA,
    });

    const cm = result.computed.find((c) => c.key === 'chuyen_mon');
    expect(cm!.score).toBe(0);
    expect(cm!.dataAvailable).toBe(false);

    const tt = result.computed.find((c) => c.key === 'tuan_thu');
    expect(tt!.score).toBe(0);
    expect(tt!.dataAvailable).toBe(false);
  });

  // ─── Prefill when status≠draft → CONFLICT ───────────────────────────────────

  it('prefill on submitted KpiScore → CONFLICT', async () => {
    const hr = await staffCaller();

    // Start + manually advance to submitted via DB (test bypass — we just need non-draft)
    await hr.payroll.kpiEvalStart({
      userId: conflictUserId,
      facilityId: FACILITY,
      periodKey: PERIOD_CONFLICT,
      block: 'sales',
    });

    // Force status = submitted directly in DB
    await withRls(SUPER, (tx) =>
      tx.kpiScore.updateMany({
        where: { userId: conflictUserId, periodKey: PERIOD_CONFLICT },
        data: { status: 'submitted' },
      }),
    );

    await expect(
      hr.payroll.kpiAutoPrefill({
        userId: conflictUserId,
        facilityId: FACILITY,
        periodKey: PERIOD_CONFLICT,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // ─── Prefill with no KpiScore → NOT_FOUND ───────────────────────────────────

  it('prefill when no KpiScore exists → NOT_FOUND', async () => {
    const hr = await staffCaller();

    await expect(
      hr.payroll.kpiAutoPrefill({
        userId: saleUserId,
        facilityId: FACILITY,
        periodKey: '2098-01', // no sheet started
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ─── Audit event written ────────────────────────────────────────────────────

  it('audit: record_event written with "Tự điền KPI định lượng" body', async () => {
    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: {
          entityType: 'kpi_score',
          body: { contains: `Tự điền KPI định lượng ${PERIOD_SALES}` },
        },
      }),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.type).toBe('updated');
  });
});
