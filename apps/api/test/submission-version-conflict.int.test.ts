/**
 * Integration test: submission.save optimistic-concurrency guard + status lock.
 *
 * Two clients both hold version N (a stale read). The first save succeeds and bumps the row to
 * N+1; the second save — still submitting the stale N — must be rejected with CONFLICT rather
 * than silently overwriting the first client's write. This is the server-side backstop behind
 * the LMS autosave "reload latest draft" UX (student-view.tsx `autosaveState === 'conflict'`).
 *
 * Also covers the status guard: once a submission leaves `draft` (submitted or graded) it is the
 * record of what was actually turned in / graded, so `save` must reject further edits — mirroring
 * the guard `submit` already enforces before it flips the status.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

let studentId: string;
let courseId: string;
let classBatchId: string;
let exerciseId: string;
let submissionId: string;

let dbReachable = false;

function makeStudentSession(): LmsSession {
  return {
    kind: 'student',
    accountId: 'test-account',
    displayName: 'Version Conflict Student',
    students: [{ id: studentId, fullName: 'Version Conflict Student' }],
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
        data: { facilityId: FACILITY, studentCode: uniq('VCS'), fullName: 'Version Conflict Student', program: 'UCREA' },
      });
      studentId = student.id;

      const course = await tx.course.create({
        data: { code: uniq('VC_C'), name: 'Version Conflict Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('VC_B'), courseId, name: 'Version Conflict Batch', status: 'open' },
      });
      classBatchId = batch.id;

      await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId, studentId, status: 'active' },
      });

      const unit = await tx.curriculumUnit.create({
        data: {
          courseId,
          unitCode: uniq('VC_U'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'Version conflict fixture',
          sessions: 1,
        },
      });

      const ex = await tx.exercise.create({
        data: {
          curriculumUnitId: unit.id,
          title: uniq('VC_EX'),
          type: 'homework',
          maxScore: 10,
          status: 'published',
        },
      });
      exerciseId = ex.id;

      // Ended session so the exercise auto-opens for the student.
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          sessionDate: twoDaysAgo,
          startTime: '18:00',
          endTime: '19:00',
          status: 'confirmed',
          curriculumUnitId: unit.id,
        },
      });
    });
  } catch {
    console.warn('⚠ DB not reachable — version conflict tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    if (submissionId) {
      await tx.grade.deleteMany({ where: { submissionId } });
      await tx.submission.deleteMany({ where: { id: submissionId } });
    }
    await tx.classSession.deleteMany({ where: { classBatchId } });
    await tx.exercise.deleteMany({ where: { id: exerciseId } });
    await tx.curriculumUnit.deleteMany({ where: { courseId } });
    await tx.enrollment.deleteMany({ where: { studentId } });
    await tx.classBatch.deleteMany({ where: { id: classBatchId } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({ where: { id: studentId } });
  });
});

describe('submission.save version-conflict guard', () => {
  it('first save with no version creates the row at version 1', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());
    const saved = await lms.submission.save({ exerciseId, answerText: 'draft v1' });
    expect(saved.version).toBe(1);
    submissionId = saved.id;
  });

  it('two saves both holding stale version 1: first succeeds (→ v2), second CONFLICTs', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());

    // Both "tabs" read version 1 before either writes.
    const staleVersion = 1;

    const first = await lms.submission.save({ exerciseId, answerText: 'draft from tab A', version: staleVersion });
    expect(first.version).toBe(2);

    await expect(
      lms.submission.save({ exerciseId, answerText: 'draft from tab B (stale)', version: staleVersion }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Confirm the row actually reflects tab A's write, not a silent overwrite by tab B.
    const row = await withRls(SUPER, (tx) =>
      tx.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { answerText: true, version: true } }),
    );
    expect(row.answerText).toBe('draft from tab A');
    expect(row.version).toBe(2);
  });

  it('a save carrying the now-current version succeeds and increments again', async () => {
    if (!dbReachable) return;

    const lms = lmsCaller(makeStudentSession());
    const saved = await lms.submission.save({ exerciseId, answerText: 'draft v3', version: 2 });
    expect(saved.version).toBe(3);
    expect(saved.answerText).toBe('draft v3');
  });

  it('staffCaller sanity: submission still visible to staff listByExercise post-conflict', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller();
    const rows = await staff.submission.listByExercise({ exerciseId });
    const row = rows.find((r) => r.id === submissionId);
    expect(row).toBeTruthy();
    expect(row!.version).toBe(3);
  });

  it('save is rejected once the submission is submitted — content-of-record can no longer be edited', async () => {
    if (!dbReachable) return;
    const lms = lmsCaller(makeStudentSession());
    await lms.submission.submit({ exerciseId });

    await expect(
      lms.submission.save({ exerciseId, answerText: 'sneaky post-submit edit', version: 3 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const row = await withRls(SUPER, (tx) =>
      tx.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { answerText: true, status: true } }),
    );
    expect(row.status).toBe('submitted');
    expect(row.answerText).toBe('draft v3');
  });

  it('save is rejected once the submission is graded (grade.grade flips status to graded)', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller();
    await staff.grade.grade({ submissionId, score: 9, feedback: 'Not yet released' });

    const lms = lmsCaller(makeStudentSession());
    await expect(
      lms.submission.save({ exerciseId, answerText: 'sneaky post-grade edit', version: 3 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const row = await withRls(SUPER, (tx) =>
      tx.submission.findUniqueOrThrow({ where: { id: submissionId }, select: { answerText: true, status: true } }),
    );
    expect(row.status).toBe('graded');
    expect(row.answerText).toBe('draft v3');
  });

  it('submission.mine still redacts an unpublished grade after the graded save-rejection above', async () => {
    if (!dbReachable) return;
    const lms = lmsCaller(makeStudentSession());
    const rows = await lms.submission.mine();
    const row = rows.find((r) => r.id === submissionId);
    expect(row).toBeTruthy();
    expect(row!.grade).not.toBeNull();
    expect(row!.grade!.isPublished).toBe(false);
    expect(row!.grade!.score).toBeNull();
    expect(row!.grade!.feedback).toBeNull();
  });
});
