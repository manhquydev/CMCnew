import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Program } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * Invariant (spec Phase 2 §2.5–2.7): computeFinalGrade aggregates ONLY published grades.
 * Unpublished grades must be excluded from homework/test score averages.
 *
 * Mutation proof: fixture numbers ensure published-only result ≠ include-unpublished result.
 * If the filter is removed, the assertion FAILS.
 */
describe('computeFinalGrade published-only filter (assessment invariant)', () => {
  const FACILITY = 1;
  let studentId: string;
  let periodKey: string;
  let submissionPublishedId: string;
  let submissionUnpublishedId: string;
  let exerciseHomeworkId: string;
  let exerciseTestId: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Create student
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('PUBL'),
          fullName: 'Published Filter Test',
          program: Program.BRIGHT_IG,
        },
      });
      studentId = student.id;

      const course = await tx.course.findFirst({ select: { id: true } });
      if (!course) throw new Error('No course seeded — run pnpm db:seed first');

      // Create curriculum units for exercises (one per type for clarity)
      const hwUnit = await tx.curriculumUnit.create({
        data: {
          courseId: course.id,
          unitCode: uniq('U'),
          seqInLevel: 1,
          orderGlobal: 1,
          unitType: 'LESSON',
          theme: 'fixture',
          sessions: 1,
        },
      });

      const testUnit = await tx.curriculumUnit.create({
        data: {
          courseId: course.id,
          unitCode: uniq('U'),
          seqInLevel: 2,
          orderGlobal: 2,
          unitType: 'LESSON',
          theme: 'fixture',
          sessions: 1,
        },
      });

      // Create exercises
      const hw = await tx.exercise.create({
        data: {
          curriculumUnitId: hwUnit.id,
          title: uniq('HW'),
          type: 'homework',
          maxScore: 10,
          status: 'published',
        },
      });
      exerciseHomeworkId = hw.id;

      const test = await tx.exercise.create({
        data: {
          curriculumUnitId: testUnit.id,
          title: uniq('TEST'),
          type: 'test_periodic',
          maxScore: 10,
          status: 'published',
        },
      });
      exerciseTestId = test.id;

      // Create submissions
      const submPublished = await tx.submission.create({
        data: {
          facilityId: FACILITY,
          exerciseId: exerciseHomeworkId,
          studentId,
          status: 'graded',
        },
      });
      submissionPublishedId = submPublished.id;

      const submUnpublished = await tx.submission.create({
        data: {
          facilityId: FACILITY,
          exerciseId: exerciseTestId,
          studentId,
          status: 'graded',
        },
      });
      submissionUnpublishedId = submUnpublished.id;

      // Create grades:
      // - Published homework: score=9/10 → normalized 9.0
      // - Unpublished test: score=2/10 → normalized 2.0
      //
      // If filter works (published-only):
      //   homeworkAvg = 9.0 (only published HW)
      //   testScore = null (no published tests)
      //   quantScore = blend(9.0, null, null) = 9.0 (only HW, renormalized)
      //   BRIGHT_IG: 60% qual + 40% quant
      //   finalScore = null (no qualitative yet)
      //
      // If filter broken (includes unpublished):
      //   homeworkAvg = 9.0
      //   testScore = 2.0 (unpublished test included!)
      //   quantScore = blend(9.0, 2.0, null) = (0.5*9.0 + 0.3*2.0)/(0.5+0.3) ≈ 6.43
      //   finalScore = null (still no qualitative yet)
      //
      // The test will fail if unpublished test sneaks in. We later upsert a qualitative
      // assessment to get a final score, and the difference in quant will manifest.

      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: submissionPublishedId,
          score: 9,
          maxScore: 10,
          isPublished: true,
        },
      });

      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: submissionUnpublishedId,
          score: 2,
          maxScore: 10,
          isPublished: false,
        },
      });

      // Create qualitative assessment so the final grade has a qual component
      // (BRIGHT_IG = 60% qual + 40% quant).
      // Use a pillar score of 10 for simplicity.
      periodKey = uniq('MONTH');
      await tx.qualitativeAssessment.create({
        data: {
          facilityId: FACILITY,
          studentId,
          period: 'MONTHLY',
          periodKey,
          criteria: { communication: 10 },
        },
      });
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Cleanup in reverse order of dependencies
      await tx.finalGrade.deleteMany({ where: { studentId } });
      await tx.qualitativeAssessment.deleteMany({ where: { studentId } });
      await tx.grade.deleteMany({ where: { submission: { studentId } } });
      await tx.submission.deleteMany({ where: { studentId } });
      await tx.exercise.deleteMany({ where: { id: { in: [exerciseHomeworkId, exerciseTestId].filter(Boolean) as string[] } } });
      await tx.classBatch.deleteMany({ where: { code: { startsWith: 'BATCH' } } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('published grades only: unpublished test (score=2) is excluded from blend', async () => {
    const caller = await staffCaller();

    const result = await caller.assessment.computeFinalGrade({
      studentId,
      program: Program.BRIGHT_IG,
      periodKey,
    });

    // If unpublished test (score=2) were included:
    //   homeworkAvg = 9.0
    //   testScore = 2.0
    //   formula: homework=0.5, test=0.3, attendance=0.2
    //   quantScore = (0.5*9.0 + 0.3*2.0) / (0.5 + 0.3) = 5.1 / 0.8 = 6.375
    //   qualitativeScore = 10.0 (single pillar)
    //   BRIGHT_IG: 60% qual + 40% quant
    //   finalScore ≈ (0.6*10 + 0.4*6.375) / 1.0 = 8.55
    //
    // If published-only (correct):
    //   homeworkAvg = 9.0 (only published HW)
    //   testScore = null (no published tests)
    //   quantScore = (0.5*9.0) / (0.5) = 9.0 (only HW, renormalized)
    //   qualitativeScore = 10.0
    //   BRIGHT_IG: 60% qual + 40% quant
    //   finalScore = (0.6*10 + 0.4*9.0) / 1.0 = 9.6

    // Assert the published-only result (9.6)
    expect(result.finalScore).toBeCloseTo(9.6, 1);
    expect(result.passed).toBe(true);
    expect(result.complete).toBe(true);

    // Verify it's NOT the contaminated result (8.55)
    expect(result.finalScore).not.toBeCloseTo(8.55, 1);

    // Verify stored FinalGrade matches the returned result
    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: { studentId_program_periodKey: { studentId, program: Program.BRIGHT_IG, periodKey } },
        select: { finalScore: true, homeworkAvg: true, testScore: true, qualitativeScore: true },
      }),
    );
    expect(stored).toBeDefined();
    expect(stored?.finalScore).toBeCloseTo(9.6, 1);
    expect(stored?.homeworkAvg).toBeCloseTo(9.0, 1);
    expect(stored?.testScore).toBeNull(); // no published test
    expect(stored?.qualitativeScore).toBeCloseTo(10.0, 1);
  });
});
