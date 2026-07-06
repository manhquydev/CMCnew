/**
 * Integration test — attendance.markAll / attendance.report (phase-03-attendance.md)
 *
 * Invariants under test:
 *   (a) markAll: single call upserts all active enrollments for a session, honors per-student
 *       overrides + excused, and skips a transferred (left-class) enrollment.
 *   (b) N4 authz: attendance.report scopes a teacher caller to sessions they personally taught
 *       (ClassSession.teacherId) — a session taught by a different teacher must not appear.
 *       A director (giam_doc_dao_tao) sees the whole facility.
 *   (c) N3 TZ bucketing: attendance.report(scope:'term') groups by ICT calendar month, derived
 *       via the same sessionEndUtc/ICT_OFFSET_HOURS convention as exercise-open.ts — a session
 *       dated on a month boundary buckets into its own calendar month, not a neighboring one.
 *   (d) N1: makeup sessions (isMakeup=true) stay INCLUDED in the attended/total rate denominator
 *       by default — distinct from exercise-open.ts's class-wide unit-open gate, which excludes
 *       isMakeup for a different purpose.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;

let teacherAId: string;
let teacherBId: string;
let directorId: string;

let courseId: string;
let batchId: string;

let studentE1Id: string;
let studentE2Id: string;
let studentE3Id: string;
let enrollmentE1Id: string;
let enrollmentE2Id: string;
let enrollmentE3Id: string;

let sessionMainId: string;
let sessionOtherId: string;
let sessionMakeupId: string;
let sessionJuneEndId: string;
let sessionJulyStartId: string;

let termId: string;
let n1TermId: string;

let dbReachable = false;

beforeAll(async () => {
  try {
    await withRls(SUPER, async (tx) => {
      const teacherA = await tx.appUser.create({
        data: {
          email: uniq('p5-teacher-a@cmc.test'),
          displayName: 'P5 Teacher A',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherAId = teacherA.id;

      const teacherB = await tx.appUser.create({
        data: {
          email: uniq('p5-teacher-b@cmc.test'),
          displayName: 'P5 Teacher B',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherBId = teacherB.id;

      const director = await tx.appUser.create({
        data: {
          email: uniq('p5-director@cmc.test'),
          displayName: 'P5 Director',
          passwordHash: 'test',
          primaryRole: Role.giam_doc_dao_tao,
          roles: [Role.giam_doc_dao_tao],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      directorId = director.id;

      const course = await tx.course.create({
        data: { code: uniq('P5_C'), name: 'P5 Attendance Report Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('P5_B'), courseId, name: 'P5 Batch', status: 'open' },
      });
      batchId = batch.id;

      const studentE1 = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P5_S1'), fullName: 'P5 Student 1', program: 'UCREA' },
      });
      studentE1Id = studentE1.id;
      const studentE2 = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P5_S2'), fullName: 'P5 Student 2', program: 'UCREA' },
      });
      studentE2Id = studentE2.id;
      const studentE3 = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P5_S3'), fullName: 'P5 Student 3', program: 'UCREA' },
      });
      studentE3Id = studentE3.id;

      const enrollmentE1 = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentE1Id, status: 'active' },
      });
      enrollmentE1Id = enrollmentE1.id;
      const enrollmentE2 = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentE2Id, status: 'active' },
      });
      enrollmentE2Id = enrollmentE2.id;
      // Left-class guard fixture: this enrollment must be SKIPPED by markAll.
      const enrollmentE3 = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentE3Id, status: 'transferred' },
      });
      enrollmentE3Id = enrollmentE3.id;

      // Fixed far-future dates (not "today"/"±1 day") — avoids collision with other test
      // suites' relative-date fixtures and with the N3 month-boundary dates below.
      const sessionMain = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: new Date(Date.UTC(2094, 2, 15)),
          startTime: '18:00', endTime: '19:00', status: 'confirmed', teacherId: teacherAId,
        },
      });
      sessionMainId = sessionMain.id;

      const sessionOther = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: new Date(Date.UTC(2094, 2, 16)),
          startTime: '19:30', endTime: '20:30', status: 'confirmed', teacherId: teacherBId,
        },
      });
      sessionOtherId = sessionOther.id;

      const sessionMakeup = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: new Date(Date.UTC(2094, 4, 1)),
          startTime: '09:00', endTime: '10:00', status: 'confirmed', teacherId: teacherAId, isMakeup: true,
        },
      });
      sessionMakeupId = sessionMakeup.id;

      // N3 fixture: last day of June and first day of July (far-future year — avoids collision
      // with any other suite's relative "today" fixtures in this facility), one with a
      // late-night ICT end time.
      const sessionJuneEnd = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId,
          sessionDate: new Date(Date.UTC(2094, 5, 30)),
          startTime: '22:30', endTime: '23:30', status: 'confirmed', teacherId: teacherAId,
        },
      });
      sessionJuneEndId = sessionJuneEnd.id;

      const sessionJulyStart = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId,
          sessionDate: new Date(Date.UTC(2094, 6, 1)),
          startTime: '08:00', endTime: '09:00', status: 'confirmed', teacherId: teacherAId,
        },
      });
      sessionJulyStartId = sessionJulyStart.id;

      const term = await tx.academicTerm.create({
        data: {
          facilityId: FACILITY, periodKey: uniq('P5_TERM'), name: 'P5 Term',
          startDate: new Date(Date.UTC(2094, 5, 1)), endDate: new Date(Date.UTC(2094, 6, 31)),
        },
      });
      termId = term.id;

      // Narrow term covering only the makeup session's date — isolates the N1 assertion.
      const n1Term = await tx.academicTerm.create({
        data: {
          facilityId: FACILITY, periodKey: uniq('P5_N1_TERM'), name: 'P5 N1 Term',
          startDate: new Date(Date.UTC(2094, 4, 1)), endDate: new Date(Date.UTC(2094, 4, 1)),
        },
      });
      n1TermId = n1Term.id;
    });
    dbReachable = true;
  } catch {
    console.warn('⚠ DB not reachable — attendance report/markAll tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.attendance.deleteMany({ where: { session: { classBatchId: batchId } } });
    await tx.classSession.deleteMany({ where: { classBatchId: batchId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
    await tx.classBatch.deleteMany({ where: { id: batchId } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: { in: [studentE1Id, studentE2Id, studentE3Id] } } });
    await tx.academicTerm.deleteMany({ where: { id: { in: [termId, n1TermId] } } });
    await tx.employmentProfile.deleteMany({ where: { userId: { in: [teacherAId, teacherBId, directorId] } } });
    await tx.appUser.deleteMany({ where: { id: { in: [teacherAId, teacherBId, directorId] } } });
  });
});

describe('attendance.markAll', () => {
  it('(a) sets all active enrollments in one call, respects overrides + excused, skips transferred', async () => {
    if (!dbReachable) return;
    const teacherA = await staffCaller({ userId: teacherAId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await teacherA.attendance.markAll({
      classSessionId: sessionMainId,
      defaultStatus: 'present',
      overrides: [{ enrollmentId: enrollmentE2Id, status: 'late', excused: true }],
    });

    const rows = await withRls(SUPER, (tx) =>
      tx.attendance.findMany({ where: { classSessionId: sessionMainId } }),
    );
    const byEnrollment = new Map(rows.map((r) => [r.enrollmentId, r]));

    expect(byEnrollment.get(enrollmentE1Id)?.status).toBe('present');
    expect(byEnrollment.get(enrollmentE1Id)?.excused).toBe(false);
    expect(byEnrollment.get(enrollmentE2Id)?.status).toBe('late');
    expect(byEnrollment.get(enrollmentE2Id)?.excused).toBe(true);
    // Transferred enrollment must never receive a row from markAll.
    expect(byEnrollment.has(enrollmentE3Id)).toBe(false);
  });

  it('rejects a teacher who is not assigned to the session', async () => {
    if (!dbReachable) return;
    const teacherB = await staffCaller({ userId: teacherBId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(
      teacherB.attendance.mark({ classSessionId: sessionMainId, enrollmentId: enrollmentE1Id, status: 'present' }),
    ).rejects.toThrow(/Giáo viên/);
    await expect(
      teacherB.attendance.markAll({ classSessionId: sessionMainId, defaultStatus: 'present' }),
    ).rejects.toThrow(/Giáo viên/);
  });
});

describe('attendance.report', () => {
  it('(b) N4: teacher scope excludes another teacher\'s session; director sees facility-wide', async () => {
    if (!dbReachable) return;
    const teacherA = await staffCaller({ userId: teacherAId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });
    const teacherB = await staffCaller({ userId: teacherBId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });
    const director = await staffCaller({ userId: directorId, roles: [Role.giam_doc_dao_tao], primaryRole: Role.giam_doc_dao_tao, isSuperAdmin: false, facilityIds: [FACILITY] });

    // teacherA already marked sessionMain (present/late) via markAll above.
    // teacherB marks their own session (sessionOther) for the same two students.
    await teacherB.attendance.mark({ classSessionId: sessionOtherId, enrollmentId: enrollmentE1Id, status: 'present' });
    await teacherB.attendance.mark({ classSessionId: sessionOtherId, enrollmentId: enrollmentE2Id, status: 'absent' });

    const reportA = await teacherA.attendance.report({ scope: 'class', id: batchId });
    // teacherA's scope: only sessionMain's 2 rows (present, late) — sessionOther excluded.
    expect(reportA.counts.total).toBe(2);
    expect(reportA.counts.present).toBe(1);
    expect(reportA.counts.late).toBe(1);
    expect(reportA.counts.absent).toBe(0);

    const reportDirector = await director.attendance.report({ scope: 'class', id: batchId });
    // Director sees the whole batch: sessionMain (2) + sessionOther (2) = 4, includes the absent.
    expect(reportDirector.counts.total).toBe(4);
    expect(reportDirector.counts.absent).toBe(1);
  });

  it('(c) N3: term-scope byMonth buckets a month-boundary session into its own calendar month', async () => {
    if (!dbReachable) return;
    const teacherA = await staffCaller({ userId: teacherAId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await teacherA.attendance.mark({ classSessionId: sessionJuneEndId, enrollmentId: enrollmentE1Id, status: 'present' });
    await teacherA.attendance.mark({ classSessionId: sessionJulyStartId, enrollmentId: enrollmentE1Id, status: 'present' });

    const report = await teacherA.attendance.report({ scope: 'term', id: termId });
    const byMonth = new Map((report as { byMonth: { month: string; total: number }[] }).byMonth.map((m) => [m.month, m.total]));

    expect(byMonth.get('2094-06')).toBe(1);
    expect(byMonth.get('2094-07')).toBe(1);
  });

  it('(d) N1: an attended makeup session counts in both numerator and denominator', async () => {
    if (!dbReachable) return;
    const director = await staffCaller({ userId: directorId, roles: [Role.giam_doc_dao_tao], primaryRole: Role.giam_doc_dao_tao, isSuperAdmin: false, facilityIds: [FACILITY] });

    await director.attendance.mark({ classSessionId: sessionMakeupId, enrollmentId: enrollmentE1Id, status: 'present' });

    const report = await director.attendance.report({ scope: 'student', id: studentE1Id, termId: n1TermId });
    expect(report.counts.total).toBe(1);
    expect(report.counts.present).toBe(1);
    expect(report.rate).toBe(1);
  });
});
