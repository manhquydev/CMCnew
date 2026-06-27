/**
 * Integration tests: four security/correctness invariants in the LMS academic path.
 *
 * 1. Unpublished grade score/feedback is hidden from student (mine) and parent (forStudent)
 *    but fully visible to staff.
 * 2. attendance.mark rejects a (session, enrollment) pair that crosses class-batch boundaries.
 * 3. grade.grade rejects a score that exceeds the exercise maxScore.
 * 4. submission.save and submission.submit reject submissions targeting an unpublished exercise.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

// ── Shared fixtures ────────────────────────────────────────────────────────────

let studentId: string;
let courseId: string;
let classBatchId: string;
let otherBatchId: string;
let enrollmentId: string;
let otherEnrollmentId: string;
let classSessionId: string;
let unpublishedExerciseId: string;

// Track every submission/exercise created across tests so afterAll can clean up
const cleanupSubmissions: string[] = [];
const cleanupExercises: string[] = [];

let dbReachable = false;

// Minimal student LMS session — avoids the need for a real StudentAccount login.
function makeStudentSession(): LmsSession {
  return {
    kind: 'student',
    accountId: 'test-account',
    displayName: 'Security Test Student',
    students: [{ id: studentId, fullName: 'Security Test Student' }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  };
}

/** Create a published exercise in classBatchId and register it for cleanup. */
async function mkPublishedExercise(maxScore = 10) {
  return withRls(SUPER, async (tx) => {
    const ex = await tx.exercise.create({
      data: {
        facilityId: FACILITY,
        classBatchId,
        title: uniq('EX_PUB'),
        type: 'homework',
        maxScore,
        starReward: 0,
        status: 'published',
      },
    });
    cleanupExercises.push(ex.id);
    return ex;
  });
}

/** Create a submitted submission against a given exercise. */
async function mkSubmittedSubmission(exerciseId: string) {
  return withRls(SUPER, async (tx) => {
    const s = await tx.submission.create({
      data: { facilityId: FACILITY, studentId, exerciseId, status: 'submitted', submittedAt: new Date() },
    });
    cleanupSubmissions.push(s.id);
    return s;
  });
}

beforeAll(async () => {
  try {
    await superAdminUserId();
    dbReachable = true;

    await withRls(SUPER, async (tx) => {
      // Student
      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HSEC'), fullName: 'Security Test Student', program: 'UCREA' },
      });
      studentId = student.id;

      // Course + two class batches (to test cross-batch mismatch)
      const course = await tx.course.create({
        data: { code: uniq('CRS_SEC'), name: 'Security Test Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('B_SEC'), courseId, name: 'Security Batch A', status: 'open' },
      });
      classBatchId = batch.id;

      const otherBatch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('B_SEC2'), courseId, name: 'Security Batch B', status: 'open' },
      });
      otherBatchId = otherBatch.id;

      // Enrollments: student in batch A and batch B
      const enroll = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId, studentId, status: 'active' },
      });
      enrollmentId = enroll.id;

      const otherEnroll = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: otherBatchId, studentId, status: 'active' },
      });
      otherEnrollmentId = otherEnroll.id;

      // Class session for batch A
      const session = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: new Date('2099-12-01'),
          startTime: '08:00',
          endTime: '10:00',
          status: 'planned',
        },
      });
      classSessionId = session.id;

      // Unpublished exercise in batch A (for submission-to-unpublished tests)
      const unpubEx = await tx.exercise.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          title: uniq('EX_UNPUB'),
          type: 'homework',
          maxScore: 10,
          starReward: 0,
          status: 'draft',
        },
      });
      unpublishedExerciseId = unpubEx.id;
      cleanupExercises.push(unpublishedExerciseId);
    });
  } catch {
    console.warn('⚠ DB not reachable — security invariant tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.attendance.deleteMany({ where: { enrollmentId: { in: [enrollmentId, otherEnrollmentId] } } });
    if (cleanupSubmissions.length) {
      await tx.grade.deleteMany({ where: { submissionId: { in: cleanupSubmissions } } });
      await tx.submission.deleteMany({ where: { id: { in: cleanupSubmissions } } });
    }
    if (cleanupExercises.length) {
      await tx.exercise.deleteMany({ where: { id: { in: cleanupExercises } } });
    }
    await tx.classSession.deleteMany({ where: { classBatchId } });
    await tx.enrollment.deleteMany({ where: { studentId } });
    await tx.classBatch.deleteMany({ where: { id: { in: [classBatchId, otherBatchId] } } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
  });
});

// ── Invariant 1: Unpublished grade hidden from student but visible to staff ────

describe('Invariant 1: unpublished grade privacy', () => {
  it('student (mine) sees null score/feedback while grade is unpublished', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise();
    const sub = await mkSubmittedSubmission(ex.id);

    const staff = await staffCaller();
    await staff.grade.grade({ submissionId: sub.id, score: 8, feedback: 'Good job' });

    const lms = lmsCaller(makeStudentSession());
    const subs = await lms.submission.mine();
    const mine = subs.find((s) => s.id === sub.id);

    expect(mine).toBeTruthy();
    expect(mine!.grade).not.toBeNull();
    // isPublished is visible so the student knows the grade exists but is pending release
    expect(mine!.grade!.isPublished).toBe(false);
    // score and feedback must be suppressed until published
    expect(mine!.grade!.score).toBeNull();
    expect(mine!.grade!.feedback).toBeNull();
  });

  it('student (mine) sees real score/feedback after grade is published', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise();
    const sub = await mkSubmittedSubmission(ex.id);

    const staff = await staffCaller();
    await staff.grade.grade({ submissionId: sub.id, score: 7, feedback: 'Well done' });
    await staff.grade.publish({ submissionId: sub.id });

    const lms = lmsCaller(makeStudentSession());
    const subs = await lms.submission.mine();
    const mine = subs.find((s) => s.id === sub.id);

    expect(mine!.grade!.isPublished).toBe(true);
    expect(mine!.grade!.score).toBe(7);
    expect(mine!.grade!.feedback).toBe('Well done');
  });

  it('staff (listByExercise) always sees full grade data regardless of publish status', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise();
    const sub = await mkSubmittedSubmission(ex.id);

    const staff = await staffCaller();
    await staff.grade.grade({ submissionId: sub.id, score: 6, feedback: 'Staff only' });

    // Staff query returns full data (score + feedback) even though grade is unpublished
    const rows = await staff.submission.listByExercise({ exerciseId: ex.id });
    const row = rows.find((r) => r.id === sub.id);
    expect(row).toBeTruthy();
    expect(row!.grade!.score).toBe(6);
    expect(row!.grade!.feedback).toBe('Staff only');
    expect(row!.grade!.isPublished).toBe(false);
  });
});

// ── Invariant 2: attendance.mark cross-batch mismatch rejected ─────────────────

describe('Invariant 2: attendance classBatch cross-contamination rejected', () => {
  it('marks attendance when enrollment and session share the same classBatch', async () => {
    if (!dbReachable) return;

    const staff = await staffCaller();
    const result = await staff.attendance.mark({
      classSessionId,
      enrollmentId, // belongs to classBatchId — matches the session's classBatchId
      status: 'present',
      excused: false,
    });
    expect(result.status).toBe('present');
    expect(result.classSessionId).toBe(classSessionId);
  });

  it('rejects attendance when enrollment belongs to a different classBatch than the session', async () => {
    if (!dbReachable) return;

    const staff = await staffCaller();
    // otherEnrollmentId belongs to otherBatchId; classSessionId belongs to classBatchId → mismatch
    await expect(
      staff.attendance.mark({
        classSessionId,
        enrollmentId: otherEnrollmentId,
        status: 'present',
        excused: false,
      }),
    ).rejects.toThrow();
  });
});

// ── Invariant 3: grade score must not exceed exercise maxScore ─────────────────

describe('Invariant 3: grade.grade rejects score above maxScore', () => {
  it('accepts a valid score equal to maxScore', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise(10);
    const sub = await mkSubmittedSubmission(ex.id);

    const staff = await staffCaller();
    const grade = await staff.grade.grade({ submissionId: sub.id, score: 10 }); // maxScore = 10
    expect(grade.score).toBe(10);
  });

  it('rejects a score that exceeds the exercise maxScore', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise(10);
    const sub = await mkSubmittedSubmission(ex.id);

    const staff = await staffCaller();
    await expect(
      staff.grade.grade({ submissionId: sub.id, score: 11 }), // maxScore = 10
    ).rejects.toThrow();
  });
});

// ── Invariant 4: submission to unpublished exercise rejected ───────────────────

describe('Invariant 4: submission.save/submit rejected for unpublished exercises', () => {
  it('rejects submission.save to an unpublished exercise', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());
    await expect(
      lms.submission.save({ exerciseId: unpublishedExerciseId, answerText: 'should be rejected' }),
    ).rejects.toThrow();
  });

  it('allows submission.save to a published exercise', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise();
    const lms = lmsCaller(makeStudentSession());
    const saved = await lms.submission.save({ exerciseId: ex.id, answerText: 'valid draft' });
    expect(saved.status).toBe('draft');
    cleanupSubmissions.push(saved.id);
  });

  it('rejects submission.submit when the exercise has been retracted to draft', async () => {
    if (!dbReachable) return;

    // Create an exercise published, have student save a draft, then retract it
    const ex = await mkPublishedExercise();
    const lms = lmsCaller(makeStudentSession());
    const saved = await lms.submission.save({ exerciseId: ex.id, answerText: 'saved while published' });
    cleanupSubmissions.push(saved.id);

    // Retract the exercise (staff only — direct DB write to avoid needing an 'unpublish' endpoint)
    await withRls(SUPER, async (tx) => {
      await tx.exercise.update({ where: { id: ex.id }, data: { status: 'draft' } });
    });

    // Submit should now be rejected
    await expect(lms.submission.submit({ exerciseId: ex.id })).rejects.toThrow();
  });
});
