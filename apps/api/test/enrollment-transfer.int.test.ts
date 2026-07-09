/**
 * Integration test — enrollment.transfer (phase-01-transfer.md)
 *
 * Invariants under test:
 *   (a) Transfer preserves Attendance history on the old enrollment; old flips to
 *       'transferred'; a new 'active' enrollment is created in the target batch.
 *   (b) DESIGN ASSERTION (not a bug): FinalGrade is studentId-keyed, not enrollmentId-keyed
 *       (schema.prisma:905-925). computeFinalGrade's attendance-rate query
 *       (assessment.ts:229-238) aggregates across ALL of a student's enrollments in the term,
 *       so a mid-term transfer automatically blends old-class + new-class attendance.
 *   (c) attendance.mark on the now-transferred old enrollment is rejected (existing guard,
 *       attendance.ts:60).
 *   (d) M2 ACCEPTED BEHAVIOR (not a regression): an unsubmitted old-class exercise 403s via
 *       assertExerciseOpenForStudent once the old enrollment leaves 'active' — but old sessions
 *       still list via schedule.sessionsForStudent (historical record, filtered by
 *       archivedAt only, not status).
 *   (e) Over-capacity target batch returns a warning but the transfer still succeeds (KISS,
 *       capacity is always soft).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;

let studentId: string;
let courseId: string;

let batchOldId: string;
let batchNewId: string;
let unitOldId: string;
let unitNewId: string;
let sessionOldId: string;
let sessionNewAId: string;
let sessionNewBId: string;
let exerciseOldId: string;

let enrollmentOldId: string;

let dbReachable = false;

function studentSession(): LmsSession {
  return {
    kind: 'student',
    accountId: 'transfer-test-account',
    displayName: 'Transfer Test Student',
    students: [{ id: studentId, fullName: 'Transfer Test Student' }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  };
}

beforeAll(async () => {
  try {
    await withRls(SUPER, async (tx) => {
      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('XFER'), fullName: 'Transfer Test Student', program: 'UCREA' },
      });
      studentId = student.id;

      const course = await tx.course.create({
        data: { code: uniq('XFER_C'), name: 'Transfer Test Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batchOld = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('XFER_OLD'), courseId, name: 'Old Class', status: 'open' },
      });
      batchOldId = batchOld.id;

      const batchNew = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('XFER_NEW'), courseId, name: 'New Class', status: 'open' },
      });
      batchNewId = batchNew.id;

      const unitOld = await tx.curriculumUnit.create({
        data: { courseId, unitCode: uniq('XU_OLD'), seqInLevel: 1, orderGlobal: 1, unitType: 'LESSON', theme: 'old class fixture', sessions: 1 },
      });
      unitOldId = unitOld.id;

      const unitNew = await tx.curriculumUnit.create({
        data: { courseId, unitCode: uniq('XU_NEW'), seqInLevel: 2, orderGlobal: 2, unitType: 'LESSON', theme: 'new class fixture', sessions: 1 },
      });
      unitNewId = unitNew.id;

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      const sessionOld = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchOldId, sessionDate: twoDaysAgo,
          startTime: '18:00', endTime: '19:00', status: 'confirmed', curriculumUnitId: unitOldId,
        },
      });
      sessionOldId = sessionOld.id;

      const sessionNewA = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchNewId, sessionDate: oneDayAgo,
          startTime: '18:00', endTime: '19:00', status: 'confirmed', curriculumUnitId: unitNewId,
        },
      });
      sessionNewAId = sessionNewA.id;

      const sessionNewB = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchNewId, sessionDate: oneDayAgo,
          startTime: '19:30', endTime: '20:30', status: 'confirmed', curriculumUnitId: unitNewId,
        },
      });
      sessionNewBId = sessionNewB.id;

      const exerciseOld = await tx.exercise.create({
        data: { curriculumUnitId: unitOldId, title: uniq('XFER_EX'), type: 'homework', maxScore: 10, status: 'published' },
      });
      exerciseOldId = exerciseOld.id;

      const enrollmentOld = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchOldId, studentId, status: 'active' },
      });
      enrollmentOldId = enrollmentOld.id;

      // Attendance on the old class BEFORE transfer.
      await tx.attendance.create({
        data: { facilityId: FACILITY, classSessionId: sessionOldId, enrollmentId: enrollmentOldId, status: 'present' },
      });
    });
    dbReachable = true;
  } catch {
    console.warn('⚠ DB not reachable — enrollment.transfer tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    const batchIds = [batchOldId, batchNewId].filter(Boolean);
    await tx.finalGrade.deleteMany({ where: { studentId } });
    await tx.submission.deleteMany({ where: { studentId } });
    await tx.exercise.deleteMany({ where: { id: exerciseOldId } });
    await tx.attendance.deleteMany({ where: { session: { classBatchId: { in: batchIds } } } });
    await tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } });
    await tx.curriculumUnit.deleteMany({ where: { id: { in: [unitOldId, unitNewId] } } });
    await tx.enrollment.deleteMany({ where: { studentId } });
    await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
  });
});

describe('enrollment.transfer', () => {
  it('(a) flips old enrollment to transferred, creates new active enrollment, preserves old Attendance', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();

    const result = await caller.enrollment.transfer({
      enrollmentId: enrollmentOldId,
      targetClassBatchId: batchNewId,
    });

    expect(result.oldEnrollmentId).toBe(enrollmentOldId);
    expect(result.newEnrollmentId).toBeDefined();
    expect(result.overCapacity).toBe(false);

    const [oldEnr, newEnr, oldAttendance] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentOldId } }),
        tx.enrollment.findUniqueOrThrow({ where: { id: result.newEnrollmentId } }),
        tx.attendance.findMany({ where: { enrollmentId: enrollmentOldId } }),
      ]),
    );

    expect(oldEnr.status).toBe('transferred');
    expect(newEnr.status).toBe('active');
    expect(newEnr.classBatchId).toBe(batchNewId);
    expect(newEnr.studentId).toBe(studentId);
    // Old Attendance row is untouched — still keyed to the old enrollment, still 'present'.
    expect(oldAttendance).toHaveLength(1);
    expect(oldAttendance[0]!.status).toBe('present');
  });

  it('(b) DESIGN ASSERTION: computeFinalGrade attendance rate blends old+new class sessions (studentId-scoped)', async () => {
    if (!dbReachable) return;
    const newEnr = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirstOrThrow({ where: { studentId, classBatchId: batchNewId, status: 'active' } }),
    );

    const staff = await staffCaller();
    // New class: 1 present + 1 absent. Combined with the old class's 1 present:
    // attended = 2 (old present + new present), total = 3 → rate = 2/3 ≈ 0.667.
    // If FinalGrade were mistakenly scoped to only the new enrollment, rate would be 1/2 = 0.5.
    // sessionNewA/B are dated oneDayAgo (past — deliberately, to exercise exercise-open's
    // "session ended" gate elsewhere in this suite) so they sit outside the attendance window
    // gate (phase-02-attendance-gate-and-comment-lock.md) — seed directly via SUPER tx instead
    // of the gated router; this test asserts computeFinalGrade's rate math, not mark's own authz.
    await withRls(SUPER, (tx) =>
      tx.attendance.createMany({
        data: [
          { facilityId: FACILITY, classSessionId: sessionNewAId, enrollmentId: newEnr.id, status: 'present' },
          { facilityId: FACILITY, classSessionId: sessionNewBId, enrollmentId: newEnr.id, status: 'absent' },
        ],
      }),
    );

    const periodKey = uniq('XFER_PERIOD');
    await staff.assessment.computeFinalGrade({ studentId, program: 'UCREA' as never, periodKey });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUniqueOrThrow({
        where: { studentId_program_periodKey: { studentId, program: 'UCREA', periodKey } },
        select: { attendanceRate: true },
      }),
    );

    expect(stored.attendanceRate).toBeCloseTo(2 / 3, 2);
    expect(stored.attendanceRate).not.toBeCloseTo(0.5, 2);
  });

  it('(c) attendance.mark on the transferred old enrollment is rejected', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller();
    // Use a session dated today with an all-day window so the attendance-window gate passes —
    // otherwise a past session would be rejected by the window gate first and mask the guard this
    // test actually proves (the transferred-enrollment guard). Assert the transferred-specific
    // message, not just BAD_REQUEST, so the two rejection sources cannot be confused.
    const todaySessionId = await withRls(SUPER, async (tx) => {
      const s = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchOldId, sessionDate: new Date(),
          startTime: '00:00', endTime: '23:59', status: 'confirmed', curriculumUnitId: unitOldId,
        },
      });
      return s.id;
    });
    await expect(
      staff.attendance.mark({ classSessionId: todaySessionId, enrollmentId: enrollmentOldId, status: 'present' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Học sinh đã rời lớp — không thể điểm danh' });
  });

  it('(d) M2 accepted: unsubmitted old-class exercise 403s after transfer, but old session still lists via sessionsForStudent', async () => {
    if (!dbReachable) return;
    const lms = lmsCaller(studentSession());

    await expect(
      lms.submission.save({ exerciseId: exerciseOldId, answerText: 'attempt after transfer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const sessions = await lms.schedule.sessionsForStudent();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(sessionOldId);
  });

  it('(e) over-capacity target batch returns a warning but the transfer still succeeds', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller();

    // A capacity-1 batch that's already at capacity with a different student.
    const setup = await withRls(SUPER, async (tx) => {
      const fillerStudent = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('XFER_FILL'), fullName: 'Filler Student', program: 'UCREA' },
      });
      const capBatch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('XFER_CAP'), courseId, name: 'Capacity Class', status: 'open', capacity: 1 },
      });
      await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: capBatch.id, studentId: fillerStudent.id, status: 'active' },
      });
      const sourceBatch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('XFER_SRC'), courseId, name: 'Source Class', status: 'open' },
      });
      const sourceStudent = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('XFER_SRCS'), fullName: 'Source Student', program: 'UCREA' },
      });
      const sourceEnrollment = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: sourceBatch.id, studentId: sourceStudent.id, status: 'active' },
      });
      return { fillerStudent, capBatch, sourceBatch, sourceStudent, sourceEnrollment };
    });

    try {
      const result = await staff.enrollment.transfer({
        enrollmentId: setup.sourceEnrollment.id,
        targetClassBatchId: setup.capBatch.id,
      });
      expect(result.overCapacity).toBe(true);
      expect(result.capacity).toBe(1);
      expect(result.enrolledCount).toBe(2);

      const newEnr = await withRls(SUPER, (tx) =>
        tx.enrollment.findUniqueOrThrow({ where: { id: result.newEnrollmentId } }),
      );
      expect(newEnr.status).toBe('active');
      expect(newEnr.classBatchId).toBe(setup.capBatch.id);
    } finally {
      await withRls(SUPER, async (tx) => {
        await tx.enrollment.deleteMany({ where: { studentId: { in: [setup.fillerStudent.id, setup.sourceStudent.id] } } });
        await tx.classBatch.deleteMany({ where: { id: { in: [setup.capBatch.id, setup.sourceBatch.id] } } });
        await tx.student.deleteMany({ where: { id: { in: [setup.fillerStudent.id, setup.sourceStudent.id] } } });
      });
    }
  });
});
