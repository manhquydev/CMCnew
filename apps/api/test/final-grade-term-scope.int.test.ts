import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Program } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * Invariant (phase-07 decision 2026-06-26): when an AcademicTerm exists for a (facilityId,
 * periodKey), computeFinalGrade aggregates ONLY grades and attendance within the term's
 * [startDate, endDate] window. Grades outside the window must be excluded.
 *
 * Mutation proof: fixture numbers ensure in-window-only result ≠ include-all-time result.
 * If the gradedAt filter is removed, the assertion FAILS.
 */
describe('computeFinalGrade — term-scoped grade aggregation', () => {
  const FACILITY = 1;
  // Term window: Jan 2099
  const TERM_START = '2099-01-01';
  const TERM_END = '2099-01-31';
  const PERIOD_KEY = uniq('TERM2099');

  let studentId: string;
  let termId: string;
  let hwInId: string;
  let hwOutId: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Create student
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('TERMSCOPE'),
          fullName: 'Term Scope Test Student',
          program: Program.UCREA,
        },
      });
      studentId = student.id;

      const course = await tx.course.findFirst({ select: { id: true } });
      if (!course) throw new Error('No course seeded — run pnpm db:seed first');

      // Two distinct curriculum units (both homework type, so must use different units
      // due to @@unique([curriculumUnitId, type]) constraint)
      const hwInUnit = await tx.curriculumUnit.create({
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

      const hwOutUnit = await tx.curriculumUnit.create({
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

      // Two homework exercises (same type, different units)
      const hwIn = await tx.exercise.create({
        data: {
          curriculumUnitId: hwInUnit.id,
          title: uniq('HW_IN'),
          type: 'homework',
          maxScore: 10,
          status: 'published',
        },
      });
      hwInId = hwIn.id;
      const hwOut = await tx.exercise.create({
        data: {
          curriculumUnitId: hwOutUnit.id,
          title: uniq('HW_OUT'),
          type: 'homework',
          maxScore: 10,
          status: 'published',
        },
      });
      hwOutId = hwOut.id;

      // Submissions for both exercises
      const submIn = await tx.submission.create({
        data: { facilityId: FACILITY, exerciseId: hwIn.id, studentId, status: 'graded' },
      });
      const submOut = await tx.submission.create({
        data: { facilityId: FACILITY, exerciseId: hwOut.id, studentId, status: 'graded' },
      });

      // IN-TERM grade: gradedAt 2099-01-15 (inside the window), score=8/10.
      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: submIn.id,
          score: 8,
          maxScore: 10,
          isPublished: true,
          gradedAt: new Date('2099-01-15T12:00:00Z'),
        },
      });

      // OUT-OF-TERM grade: gradedAt 2099-03-01 (outside the window), score=2/10.
      // If this grade is mistakenly included, homeworkAvg drops from 8.0 to 5.0.
      await tx.grade.create({
        data: {
          facilityId: FACILITY,
          submissionId: submOut.id,
          score: 2,
          maxScore: 10,
          isPublished: true,
          gradedAt: new Date('2099-03-01T12:00:00Z'),
        },
      });

      // AcademicTerm for the test period
      const term = await tx.academicTerm.create({
        data: {
          facilityId: FACILITY,
          periodKey: PERIOD_KEY,
          name: `Kỳ test ${PERIOD_KEY}`,
          startDate: new Date(TERM_START),
          endDate: new Date(TERM_END),
        },
      });
      termId = term.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.finalGrade.deleteMany({ where: { studentId } });
      await tx.grade.deleteMany({ where: { submission: { studentId } } });
      await tx.submission.deleteMany({ where: { studentId } });
      await tx.exercise.deleteMany({ where: { id: { in: [hwInId, hwOutId] } } });
      await tx.classBatch.deleteMany({ where: { code: { startsWith: 'TERMB' } } });
      await tx.academicTerm.deleteMany({ where: { id: termId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('in-term grade (score=8) included, out-of-term grade (score=2) excluded → homeworkAvg=8', async () => {
    const caller = await staffCaller();
    await caller.assessment.computeFinalGrade({
      studentId,
      program: Program.UCREA,
      periodKey: PERIOD_KEY,
    });

    // UCREA is qualitative-only → finalScore might be null without a qual assessment,
    // but homeworkAvg is always stored. Verify via the stored FinalGrade record.
    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: {
          studentId_program_periodKey: {
            studentId,
            program: Program.UCREA,
            periodKey: PERIOD_KEY,
          },
        },
        select: { homeworkAvg: true, testScore: true },
      }),
    );
    expect(stored).toBeDefined();

    // Only the in-term grade (8/10 → 8.0 normalised) should be included.
    // If the filter is missing, homeworkAvg = (8 + 2) / 2 = 5.0.
    expect(stored?.homeworkAvg).toBeCloseTo(8.0, 1);

    // The out-of-term grade was the only non-homework (it's also homework here, but the
    // important assertion is it's not 5.0):
    expect(stored?.homeworkAvg).not.toBeCloseTo(5.0, 1);
  });

  it('fallback (no term configured): all-time grades used when periodKey has no AcademicTerm', async () => {
    const UNBOUND_PERIOD = uniq('NOTERM');
    const caller = await staffCaller();

    // computeFinalGrade with a periodKey that has no AcademicTerm → falls back to all-time.
    // Both grades (gradedAt 2099-01-15 and 2099-03-01) are included → homeworkAvg = 5.0.
    await caller.assessment.computeFinalGrade({
      studentId,
      program: Program.UCREA,
      periodKey: UNBOUND_PERIOD,
    });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: {
          studentId_program_periodKey: {
            studentId,
            program: Program.UCREA,
            periodKey: UNBOUND_PERIOD,
          },
        },
        select: { homeworkAvg: true },
      }),
    );
    expect(stored).toBeDefined();
    // All-time includes both grades: (8 + 2) / 2 = 5.0.
    expect(stored?.homeworkAvg).toBeCloseTo(5.0, 1);

    // Cleanup the extra FinalGrade row immediately.
    await withRls(SUPER, (tx) =>
      tx.finalGrade.deleteMany({ where: { studentId, periodKey: UNBOUND_PERIOD } }),
    );
  });
});
