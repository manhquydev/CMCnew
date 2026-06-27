import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Program } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant: badge auto-award on grade publish is idempotent. Publishing a qualifying grade
// twice yields exactly ONE StudentBadge for that (student, badge) pair. The unique constraint
// @@unique([studentId, badgeId]) + skipDuplicates in the publish mutation ensures atomicity.
// This test proves the award path works AND is safe against duplicate publications.
describe('badge auto-award idempotency on grade publish', () => {
  const FACILITY = 1;
  let studentId: string;
  let badgeId: string;
  let exerciseId: string;
  let submissionId: string;
  let courseId: string;
  let classBatchId: string;

  beforeAll(async () => {
    const caller = await staffCaller();

    // Create a student (needed for submissions).
    const student = await withRls(SUPER, async (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HSB'), fullName: 'HS badge test', program: 'UCREA' },
      }),
    );
    studentId = student.id;

    // Create a course (needed for ClassBatch).
    const course = await withRls(SUPER, async (tx) =>
      tx.course.create({
        data: {
          code: uniq('COURSE_BADGE'),
          name: 'Course Badge Test',
          program: 'UCREA',
        },
      }),
    );
    courseId = course.id;

    // Create a ClassBatch (needed for Exercise).
    const batch = await withRls(SUPER, async (tx) =>
      tx.classBatch.create({
        data: {
          facilityId: FACILITY,
          code: uniq('BATCH_BADGE'),
          courseId,
          name: 'Batch Badge Test',
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        },
      }),
    );
    classBatchId = batch.id;

    // Create a badge with stars_total criterion (e.g. 50 stars = unlock).
    const badge = await withRls(SUPER, async (tx) =>
      tx.badge.create({
        data: {
          facilityId: FACILITY,
          code: uniq('BADGE_STARS'),
          name: 'Badge Test Star Collector',
          description: 'Earned 50+ stars',
          unlockCriteria: { kind: 'stars_total', gte: 50 },
          isActive: true,
        },
      }),
    );
    badgeId = badge.id;

    // Create an exercise with starReward > 0, maxScore = 10.
    const exercise = await withRls(SUPER, async (tx) =>
      tx.exercise.create({
        data: {
          facilityId: FACILITY,
          classBatchId,
          title: uniq('EX_BADGE'),
          type: 'homework',
          maxScore: 10,
          starReward: 60, // Award 60 stars — triggers the badge (50+ threshold).
        },
      }),
    );
    exerciseId = exercise.id;

    // Create a submission.
    const submission = await withRls(SUPER, async (tx) =>
      tx.submission.create({
        data: {
          facilityId: FACILITY,
          studentId,
          exerciseId,
          submittedAt: new Date(),
          status: 'submitted',
        },
      }),
    );
    submissionId = submission.id;

    // Grade the submission with score 8/10.
    await caller.grade.grade({ submissionId, score: 8 });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Cleanup in reverse order of FK dependencies.
      await tx.studentBadge.deleteMany({ where: { studentId } });
      await tx.starTransaction.deleteMany({ where: { studentId } });
      await tx.notification.deleteMany({ where: { recipientId: studentId } });
      await tx.grade.deleteMany({ where: { submission: { studentId } } });
      await tx.submission.deleteMany({ where: { studentId } });
      await tx.exercise.deleteMany({ where: { classBatchId } });
      await tx.classBatch.deleteMany({ where: { id: classBatchId } });
      await tx.course.deleteMany({ where: { id: courseId } });
      await tx.badge.deleteMany({ where: { id: badgeId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('publishing a qualifying grade awards the badge; publishing again is idempotent (no duplicate)', async () => {
    const caller = await staffCaller();

    // First publish: grade goes public, 60 stars earned, badge threshold met (50+) → award.
    const result1 = await caller.grade.publish({ submissionId });
    expect(result1.grade.isPublished).toBe(true);
    expect(result1.starsEarned).toBe(60);
    expect(result1.badgesAwarded).toBe(1); // One badge awarded on first publish.

    // Verify exactly ONE StudentBadge exists for (studentId, badgeId).
    let owned = await withRls(SUPER, (tx) =>
      tx.studentBadge.findMany({ where: { studentId, badgeId } }),
    );
    expect(owned).toHaveLength(1);
    expect(owned[0].source).toBe('auto');

    // Second publish (re-publish): the grade is already published, but publish is idempotent.
    // Re-earning the same stars is blocked by the unique constraint on starTransaction.
    // Re-awarding the same badge is blocked by @@unique([studentId, badgeId]) + skipDuplicates.
    const result2 = await caller.grade.publish({ submissionId });
    expect(result2.grade.isPublished).toBe(true);
    expect(result2.starsEarned).toBe(0); // No new stars (unique constraint on reference).
    expect(result2.badgesAwarded).toBe(0); // No new badges (unique + skipDuplicates).

    // Verify still exactly ONE StudentBadge; the second publish did NOT create a duplicate.
    owned = await withRls(SUPER, (tx) =>
      tx.studentBadge.findMany({ where: { studentId, badgeId } }),
    );
    expect(owned).toHaveLength(1);
    expect(owned[0].source).toBe('auto');

    // Sanity: star balance is 60 (earned once, not double-debited).
    const txns = await withRls(SUPER, (tx) =>
      tx.starTransaction.findMany({ where: { studentId } }),
    );
    const balance = txns.reduce((sum, t) => sum + t.amount, 0);
    expect(balance).toBe(60);
  });

  it('a second student does not trigger a badge for the first student', async () => {
    // Verify isolation: another student earning the same badge does not affect the first.
    // This is a sanity check against cross-student pollution.

    const caller = await staffCaller();
    const student2 = await withRls(SUPER, async (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HSB2'), fullName: 'HS badge test 2', program: 'UCREA' },
      }),
    );
    const s2Id = student2.id;

    try {
      // Create submission + grade for student2.
      const sub2 = await withRls(SUPER, async (tx) =>
        tx.submission.create({
          data: {
            facilityId: FACILITY,
            studentId: s2Id,
            exerciseId, // same exercise
            submittedAt: new Date(),
            status: 'submitted',
          },
        }),
      );

      await caller.grade.grade({ submissionId: sub2.id, score: 9 });
      await caller.grade.publish({ submissionId: sub2.id });

      // Check: student2 earned the badge.
      const owned2 = await withRls(SUPER, (tx) =>
        tx.studentBadge.findMany({ where: { studentId: s2Id, badgeId } }),
      );
      expect(owned2).toHaveLength(1);

      // Check: student1 still has exactly 1 badge (no pollution).
      const owned1 = await withRls(SUPER, (tx) =>
        tx.studentBadge.findMany({ where: { studentId, badgeId } }),
      );
      expect(owned1).toHaveLength(1);
    } finally {
      // Cleanup student2.
      await withRls(SUPER, async (tx) => {
        await tx.studentBadge.deleteMany({ where: { studentId: s2Id } });
        await tx.starTransaction.deleteMany({ where: { studentId: s2Id } });
        await tx.notification.deleteMany({ where: { recipientId: s2Id } });
        await tx.grade.deleteMany({ where: { submission: { studentId: s2Id } } });
        await tx.submission.deleteMany({ where: { studentId: s2Id } });
        await tx.student.deleteMany({ where: { id: s2Id } });
      });
    }
  });
});
