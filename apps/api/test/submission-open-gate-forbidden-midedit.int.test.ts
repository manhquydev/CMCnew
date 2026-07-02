/**
 * Integration test: submission.save FORBIDDEN when the open-gate closes mid-edit.
 *
 * Distinct from:
 *   - CONFLICT (stale `version` on an otherwise-open exercise — see
 *     submission-version-conflict.int.test.ts).
 *   - the "exercise never published" 403 already covered in lms-security-invariants.int.test.ts.
 *
 * Here the student starts editing while the gate is genuinely open (an ended session ties them
 * to the unit), then the gate closes underneath them — either the session that opened it gets
 * cancelled, or their enrollment gets archived — and the *next* save must FORBID, not silently
 * succeed or CONFLICT. This is the code path the LMS freeze-and-retain UX keys on
 * (student-view.tsx `autosaveState === 'forbidden'`): the client keeps the unsaved draft in
 * local state and shows "Bài này đã đóng" rather than losing the student's work.
 *
 * Each scenario uses its own classBatch/enrollment (Enrollment has a unique (classBatchId,
 * studentId) constraint, so a shared batch can't hold two independent enrollment rows for the
 * same student) — this also proves the second scenario's gate-close is scoped to its own
 * enrollment, not a coincidental global cutoff.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

let studentId: string;
let courseId: string;

let sessionCancelBatchId: string;
let sessionCancelExerciseId: string;
let sessionCancelClassSessionId: string;

let enrollmentArchiveBatchId: string;
let enrollmentArchiveExerciseId: string;
let enrollmentArchiveEnrollmentId: string;

let dbReachable = false;

function makeStudentSession(): LmsSession {
  return {
    kind: 'student',
    accountId: 'test-account',
    displayName: 'Open Gate Student',
    students: [{ id: studentId, fullName: 'Open Gate Student' }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  };
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;

    await withRls(SUPER, async (tx) => {
      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('OGS'), fullName: 'Open Gate Student', program: 'UCREA' },
      });
      studentId = student.id;

      const course = await tx.course.create({
        data: { code: uniq('OG_C'), name: 'Open Gate Course', program: 'UCREA' },
      });
      courseId = course.id;

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      // ── Fixture A: session-cancelled scenario ──────────────────────────────
      const batchA = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('OG_BA'), courseId, name: 'Open Gate Batch A', status: 'open' },
      });
      sessionCancelBatchId = batchA.id;
      await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchA.id, studentId, status: 'active' },
      });
      const unitA = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('OG_UA'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Open gate — session cancel',
          sessions: 1,
        },
      });
      const exA = await tx.exercise.create({
        data: { curriculumUnitId: unitA.id, title: uniq('OG_EXA'), type: 'homework', maxScore: 10, status: 'published' },
      });
      sessionCancelExerciseId = exA.id;
      const sessA = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchA.id,
          sessionDate: twoDaysAgo,
          startTime: '18:00',
          endTime: '19:00',
          status: 'confirmed',
          curriculumUnitId: unitA.id,
        },
      });
      sessionCancelClassSessionId = sessA.id;

      // ── Fixture B: enrollment-archived scenario ────────────────────────────
      const batchB = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('OG_BB'), courseId, name: 'Open Gate Batch B', status: 'open' },
      });
      enrollmentArchiveBatchId = batchB.id;
      const enrollmentB = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchB.id, studentId, status: 'active' },
      });
      enrollmentArchiveEnrollmentId = enrollmentB.id;
      const unitB = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('OG_UB'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Open gate — enrollment archive',
          sessions: 1,
        },
      });
      const exB = await tx.exercise.create({
        data: { curriculumUnitId: unitB.id, title: uniq('OG_EXB'), type: 'homework', maxScore: 10, status: 'published' },
      });
      enrollmentArchiveExerciseId = exB.id;
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchB.id,
          sessionDate: twoDaysAgo,
          startTime: '18:00',
          endTime: '19:00',
          status: 'confirmed',
          curriculumUnitId: unitB.id,
        },
      });
    });
  } catch {
    console.warn('⚠ DB not reachable — open-gate FORBIDDEN mid-edit tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    const exerciseIds = [sessionCancelExerciseId, enrollmentArchiveExerciseId];
    const batchIds = [sessionCancelBatchId, enrollmentArchiveBatchId];
    await tx.grade.deleteMany({ where: { submission: { exerciseId: { in: exerciseIds } } } });
    await tx.submission.deleteMany({ where: { exerciseId: { in: exerciseIds } } });
    await tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } });
    await tx.exercise.deleteMany({ where: { id: { in: exerciseIds } } });
    await tx.curriculumUnit.deleteMany({ where: { courseId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: { in: batchIds } } });
    await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
  });
});

describe('submission.save FORBIDDEN when the open-gate closes mid-edit', () => {
  it('session cancelled after an initial save → next save is FORBIDDEN (not CONFLICT)', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());

    // Gate is open (ended session, active enrollment) — first save succeeds normally.
    const saved = await lms.submission.save({ exerciseId: sessionCancelExerciseId, answerText: 'mid-edit before cancel' });
    expect(saved.version).toBe(1);

    // The session that opened this unit gets cancelled underneath the student.
    await withRls(SUPER, (tx) =>
      tx.classSession.update({ where: { id: sessionCancelClassSessionId }, data: { status: 'cancelled' } }),
    );

    // Next save — even with the correct current version — must FORBID, distinct from CONFLICT.
    await expect(
      lms.submission.save({ exerciseId: sessionCancelExerciseId, answerText: 'mid-edit after cancel', version: saved.version }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enrollment archived after an initial save → next save is FORBIDDEN (not CONFLICT)', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());

    const saved = await lms.submission.save({ exerciseId: enrollmentArchiveExerciseId, answerText: 'mid-edit before archive' });
    expect(saved.version).toBe(1);

    // Archive the enrollment tying the student to this unit's class.
    await withRls(SUPER, (tx) =>
      tx.enrollment.update({ where: { id: enrollmentArchiveEnrollmentId }, data: { archivedAt: new Date() } }),
    );

    await expect(
      lms.submission.save({ exerciseId: enrollmentArchiveExerciseId, answerText: 'mid-edit after archive', version: saved.version }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
