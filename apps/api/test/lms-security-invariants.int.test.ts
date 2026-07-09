/**
 * Integration tests: security/correctness invariants in the LMS academic path.
 *
 * 1. Unpublished grade score/feedback is hidden from student (mine) and parent (forStudent)
 *    but fully visible to staff.
 * 2. attendance.mark rejects a (session, enrollment) pair that crosses class-batch boundaries.
 * 3. grade.grade rejects a score that exceeds the exercise maxScore.
 * 4. submission.save and submission.submit enforce exercise-open guard:
 *    - reject submissions targeting an unpublished exercise
 *    - reject submissions when the exercise unit's session has not yet ended
 *    - reject submissions when the student is not enrolled in any class teaching the exercise unit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

// UTC-midnight of "today" in ICT (matches how ClassSession.sessionDate is stored). Invariant 2's
// attendance.mark calls go through the real router, so classSessionId must land inside the
// attendance 15-min-before/end-of-ICT-day window (phase-02-attendance-gate-and-comment-lock.md).
// startTime/endTime span the whole day so the window is open no matter when this suite runs.
function ictTodayUtcMidnight(): Date {
  const ict = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()));
}

// ── Shared fixtures ────────────────────────────────────────────────────────────

let studentId: string;
let courseId: string;
let classBatchId: string;
let otherBatchId: string;
let enrollmentId: string;
let otherEnrollmentId: string;
let classSessionId: string;
let teacherAId: string;
let teacherBId: string;
let unpublishedExerciseId: string;

// Track every submission/exercise created across tests so afterAll can clean up
const cleanupSubmissions: string[] = [];
const cleanupExercises: string[] = [];
const cleanupBatches: string[] = [];

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

/** Create a published exercise and register it for cleanup. Requires courseId to be set. */
async function mkPublishedExercise(maxScore = 10) {
  return withRls(SUPER, async (tx) => {
    // Exercise is now a global curriculum asset, linked via CurriculumUnit
    const unit = await tx.curriculumUnit.create({
      data: {
        courseId,
        unitCode: uniq('CU_EX'),
        seqInLevel: 1,
        orderGlobal: 1,
        unitType: 'LESSON',
        theme: 'Security invariants',
        sessions: 1,
      },
    });
    const ex = await tx.exercise.create({
      data: {
        curriculumUnitId: unit.id,
        title: uniq('EX_PUB'),
        type: 'homework',
        maxScore,
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

async function mkTeacherOwnedSubmission(maxScore = 10) {
  return withRls(SUPER, async (tx) => {
    const unit = await tx.curriculumUnit.create({
      data: {
        courseId,
        unitCode: uniq('CU_OWN'),
        seqInLevel: 2,
        orderGlobal: 2,
        unitType: 'LESSON',
        theme: 'Teacher ownership',
        sessions: 1,
      },
    });
    const ex = await tx.exercise.create({
      data: {
        curriculumUnitId: unit.id,
        title: uniq('EX_OWN'),
        type: 'homework',
        maxScore,
        status: 'published',
      },
    });
    cleanupExercises.push(ex.id);
    await tx.classSession.create({
      data: {
        facilityId: FACILITY,
        classBatchId,
        sessionDate: new Date(Date.UTC(2099, 10, 15)),
        startTime: '13:00',
        endTime: '14:00',
        status: 'confirmed',
        teacherId: teacherAId,
        curriculumUnitId: unit.id,
      },
    });
    const sub = await tx.submission.create({
      data: { facilityId: FACILITY, studentId, exerciseId: ex.id, status: 'submitted', submittedAt: new Date() },
    });
    cleanupSubmissions.push(sub.id);
    return sub;
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

      const teacherA = await tx.appUser.create({
        data: {
          email: uniq('hsec-teacher-a@cmc.test'),
          displayName: 'Security Teacher A',
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
          email: uniq('hsec-teacher-b@cmc.test'),
          displayName: 'Security Teacher B',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherBId = teacherB.id;

      // Class session for batch A — dated "today" (ICT) so Invariant 2's real attendance.mark
      // calls land inside the attendance window gate (startTime/endTime span the whole day).
      const session = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: ictTodayUtcMidnight(),
          startTime: '00:00',
          endTime: '23:59',
          status: 'planned',
        },
      });
      classSessionId = session.id;

      // Unpublished exercise (for submission-to-unpublished tests)
      const unpubUnit = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('CU_UNPUB'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Security invariants',
          sessions: 1,
        },
      });
      const unpubEx = await tx.exercise.create({
        data: {
          curriculumUnitId: unpubUnit.id,
          title: uniq('EX_UNPUB'),
          type: 'homework',
          maxScore: 10,
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
      // Delete exercises first, then their parent curriculumUnits
      await tx.exercise.deleteMany({ where: { id: { in: cleanupExercises } } });
      const units = await tx.curriculumUnit.findMany({
        where: { courseId },
      });
      await tx.curriculumUnit.deleteMany({ where: { id: { in: units.map((u) => u.id) } } });
    }
    await tx.classSession.deleteMany({ where: { classBatchId } });
    await tx.enrollment.deleteMany({ where: { studentId } });
    await tx.classBatch.deleteMany({ where: { id: { in: [classBatchId, otherBatchId, ...cleanupBatches] } } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
    await tx.appUser.deleteMany({ where: { id: { in: [teacherAId, teacherBId].filter(Boolean) } } });
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

  it('rejects grade and publish from a teacher who is not assigned to the student/session unit', async () => {
    if (!dbReachable) return;

    const sub = await mkTeacherOwnedSubmission(10);
    const teacherA = await staffCaller({ userId: teacherAId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });
    const teacherB = await staffCaller({ userId: teacherBId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    await expect(teacherB.grade.grade({ submissionId: sub.id, score: 8 })).rejects.toThrow(/Giáo viên/);
    const grade = await teacherA.grade.grade({ submissionId: sub.id, score: 8, feedback: 'Owned teacher' });
    expect(grade.score).toBe(8);
    await expect(teacherB.grade.publish({ submissionId: sub.id })).rejects.toThrow(/Giáo viên/);
    const published = await teacherA.grade.publish({ submissionId: sub.id });
    expect(published.grade.isPublished).toBe(true);
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

    // Create an ENDED session mapped to this exercise's curriculum unit so it auto-opens
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await withRls(SUPER, async (tx) => {
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: twoDaysAgo,
          startTime: '18:00',
          endTime: '19:00',
          status: 'confirmed',
          curriculumUnitId: ex.curriculumUnitId,
        },
      });
    });

    const lms = lmsCaller(makeStudentSession());
    const saved = await lms.submission.save({ exerciseId: ex.id, answerText: 'valid draft' });
    expect(saved.status).toBe('draft');
    cleanupSubmissions.push(saved.id);
  });

  it('rejects submission.submit when the exercise has been retracted to draft', async () => {
    if (!dbReachable) return;

    // Create an exercise published, have student save a draft, then retract it
    const ex = await mkPublishedExercise();

    // Create an ENDED session mapped to this exercise's curriculum unit so it auto-opens
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await withRls(SUPER, async (tx) => {
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: twoDaysAgo,
          startTime: '20:00',
          endTime: '21:00',
          status: 'confirmed',
          curriculumUnitId: ex.curriculumUnitId,
        },
      });
    });

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

  it('rejects submission.save when exercise session has not yet ended (before-open)', async () => {
    if (!dbReachable) return;

    const ex = await mkPublishedExercise();

    // Session dated tomorrow (UTC calendar day) — guaranteed future regardless of the
    // wall-clock time this test runs at, since sessionEndUtc() derives the end instant from
    // sessionDate's Y/M/D plus the endTime string, not from sessionDate's own time-of-day.
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await withRls(SUPER, async (tx) => {
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId, // student is enrolled in classBatchId
          sessionDate: futureDate,
          startTime: '08:00',
          endTime: '10:00', // not yet ended (relative to now)
          status: 'planned',
          curriculumUnitId: ex.curriculumUnitId,
        },
      });
    });

    // Student tries to save submission for this exercise
    // Should fail because the session hasn't ended yet
    const lms = lmsCaller(makeStudentSession());
    await expect(
      lms.submission.save({ exerciseId: ex.id, answerText: 'too early' }),
    ).rejects.toThrow();
  });

  it('rejects submission.submit when student is not enrolled in any class teaching the exercise unit (cross-class)', async () => {
    if (!dbReachable) return;

    // Create a third batch (C) where the student is NOT enrolled
    const thirdBatchId = await withRls(SUPER, async (tx) => {
      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('B_SEC3'), courseId, name: 'Security Batch C', status: 'open' },
      });
      cleanupBatches.push(batch.id);
      return batch.id;
    });

    // Create an exercise for a curriculum unit taught only in batch C
    const exerciseForBatchC = await withRls(SUPER, async (tx) => {
      const unit = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('CU_C'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Batch C unit',
          sessions: 1,
        },
      });
      const ex = await tx.exercise.create({
        data: {
          curriculumUnitId: unit.id,
          title: uniq('EX_C'),
          type: 'homework',
          maxScore: 10,
          status: 'published',
        },
      });
      cleanupExercises.push(ex.id);
      return ex;
    });

    // Create an ENDED session for batch C (so the exercise would theoretically be open)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await withRls(SUPER, async (tx) => {
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: thirdBatchId, // only batch C has this session
          sessionDate: twoDaysAgo,
          startTime: '18:00',
          endTime: '19:00',
          status: 'confirmed',
          curriculumUnitId: exerciseForBatchC.curriculumUnitId,
        },
      });
    });

    // Student tries to save submission for the exercise in batch C
    // Should fail because student is not enrolled in batch C
    const lms = lmsCaller(makeStudentSession());
    await expect(
      lms.submission.save({ exerciseId: exerciseForBatchC.id, answerText: 'wrong batch' }),
    ).rejects.toThrow();
  });
});
