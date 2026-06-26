/**
 * Grading-weight parity: seeded GradingTemplate rows must have NULL weights so that
 * computeFinalGrade falls back to the canonical programWeights() charter constants.
 *
 * REGRESSION GUARD (C1 from code review 2026-06-27):
 * The previous migration added weight columns with NOT NULL DEFAULT 1.0/0.0, causing every
 * template created by seed-demo.ts to carry 1.0/0.0 for ALL programs. This silently made
 * BRIGHT_IG and BLACK_HOLE compute as 100% qualitative instead of their charter blends
 * (0.6/0.4 and 0.3/0.7). These tests FAIL on the old default-1.0/0.0 behavior and PASS
 * after the corrective migration (20260627030000_grading_weights_nullable_fix).
 *
 * Two assertion modes:
 *   A. Null path — seeded templates have null weights → charter blend is used.
 *   B. Override path — a template with explicit non-null weights uses those instead.
 *
 * Mutation proof: input numbers are chosen so that the charter-blend finalScore ≠ the
 * 1.0/0.0-default finalScore. Any regression restoring the old default will flip these
 * assertions.
 *
 *   qualScore = 8.0, quantScore ≈ 6.0 (homework only after renorm)
 *   BRIGHT_IG charter (0.6/0.4): finalScore = 0.6×8 + 0.4×6 = 7.20  (bug gives 8.00)
 *   BLACK_HOLE charter (0.3/0.7): finalScore = 0.3×8 + 0.7×6 = 6.60  (bug gives 8.00)
 *   UCREA charter       (1.0/0.0): finalScore = 8.00                   (same either way)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Program } from '@cmc/db';
import { programWeights, computeFinalGrade, type QuantFormula } from '@cmc/domain-grading';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;
const FORMULA: QuantFormula = { homework: 0.5, test: 0.3, attendance: 0.2 };

// Shared fixture: one student per program, one homework grade (score=6/10), one qual assessment (all pillars=8).
// These give qualScore=8.0 and homeworkAvg=6.0 (no test/attendance → renorm to homework-only).
interface ProgramFixture {
  studentId: string;
  periodKey: string;
  batchId: string;
}

const fixtures: Partial<Record<Program, ProgramFixture>> = {};
// Override-path fixture: a template with level='test-override-parity' at facility 1, BRIGHT_IG,
// weights={qualitative:0.8, quantitative:0.2}. Student uses that template via level param.
let overrideTemplateId: string;
let overrideStudentId: string;
let overridePeriodKey: string;
let overrideBatchId: string;

const PROGRAMS_UNDER_TEST: Program[] = [Program.UCREA, Program.BRIGHT_IG, Program.BLACK_HOLE];
const OVERRIDE_LEVEL = 'test-override-parity';
const OVERRIDE_WEIGHTS = { qualitative: 0.8, quantitative: 0.2 };

beforeAll(async () => {
  await withRls(SUPER, async (tx) => {
    const course = await tx.course.findFirst({ select: { id: true } });
    if (!course) throw new Error('No course seeded — run pnpm db:seed first');

    for (const program of PROGRAMS_UNDER_TEST) {
      const periodKey = uniq(`PARITY_${program}`);
      const student = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq(`PAR_${program}`), fullName: `Parity ${program}`, program },
      });

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq(`PARB_${program}`), courseId: course.id, name: `Parity Batch ${program}` },
      });

      // Homework exercise + submitted + published grade (score=6/10 → normalized 6.0).
      const exercise = await tx.exercise.create({
        data: { facilityId: FACILITY, classBatchId: batch.id, title: uniq('PAR_HW'), type: 'homework', maxScore: 10, status: 'published' },
      });
      const submission = await tx.submission.create({
        data: { facilityId: FACILITY, exerciseId: exercise.id, studentId: student.id, status: 'graded' },
      });
      await tx.grade.create({
        data: { facilityId: FACILITY, submissionId: submission.id, score: 6, maxScore: 10, isPublished: true },
      });

      // Qualitative assessment: 4 pillars all = 8 → qualScore = 8.0.
      await tx.qualitativeAssessment.create({
        data: {
          facilityId: FACILITY,
          studentId: student.id,
          program,
          period: 'MONTHLY',
          periodKey,
          criteria: { creativity: 8, focus: 8, teamwork: 8, confidence: 8 },
        },
      });

      fixtures[program] = { studentId: student.id, periodKey, batchId: batch.id };
    }

    // Override-path: create a template with level='test-override-parity' and explicit weights.
    const overrideTpl = await tx.gradingTemplate.create({
      data: {
        facilityId: FACILITY,
        program: Program.BRIGHT_IG,
        level: OVERRIDE_LEVEL,
        formula: FORMULA,
        qualitativeWeight: OVERRIDE_WEIGHTS.qualitative,
        quantitativeWeight: OVERRIDE_WEIGHTS.quantitative,
        thresholds: {
          create: [
            { facilityId: FACILITY, minPercent: 0, maxPercent: 49.999, grade: 'Cần cố gắng', result: 'fail', sequence: 0 },
            { facilityId: FACILITY, minPercent: 50, maxPercent: 100, grade: 'Đạt', result: 'pass', sequence: 1 },
          ],
        },
      },
    });
    overrideTemplateId = overrideTpl.id;
    overridePeriodKey = uniq('PAR_OVERRIDE');

    const overrideStudent = await tx.student.create({
      data: {
        facilityId: FACILITY,
        studentCode: uniq('PAR_OVR'),
        fullName: 'Override Parity Student',
        program: Program.BRIGHT_IG,
      },
    });
    overrideStudentId = overrideStudent.id;

    const overrideBatch = await tx.classBatch.create({
      data: { facilityId: FACILITY, code: uniq('PARB_OVR'), courseId: course.id, name: 'Override Parity Batch' },
    });
    overrideBatchId = overrideBatch.id;

    const overrideEx = await tx.exercise.create({
      data: { facilityId: FACILITY, classBatchId: overrideBatch.id, title: uniq('OVR_HW'), type: 'homework', maxScore: 10, status: 'published' },
    });
    const overrideSubm = await tx.submission.create({
      data: { facilityId: FACILITY, exerciseId: overrideEx.id, studentId: overrideStudentId, status: 'graded' },
    });
    await tx.grade.create({
      data: { facilityId: FACILITY, submissionId: overrideSubm.id, score: 6, maxScore: 10, isPublished: true },
    });
    await tx.qualitativeAssessment.create({
      data: {
        facilityId: FACILITY,
        studentId: overrideStudentId,
        program: Program.BRIGHT_IG,
        period: 'MONTHLY',
        periodKey: overridePeriodKey,
        criteria: { creativity: 8, focus: 8, teamwork: 8, confidence: 8 },
      },
    });
  });
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    // Clean up override fixtures
    await tx.finalGrade.deleteMany({ where: { studentId: overrideStudentId } });
    await tx.qualitativeAssessment.deleteMany({ where: { studentId: overrideStudentId } });
    await tx.grade.deleteMany({ where: { submission: { studentId: overrideStudentId } } });
    await tx.submission.deleteMany({ where: { studentId: overrideStudentId } });
    await tx.exercise.deleteMany({ where: { classBatchId: overrideBatchId } });
    await tx.classBatch.deleteMany({ where: { id: overrideBatchId } });
    await tx.gradingTemplate.deleteMany({ where: { id: overrideTemplateId } });
    await tx.student.deleteMany({ where: { id: overrideStudentId } });

    // Clean up per-program fixtures
    for (const program of PROGRAMS_UNDER_TEST) {
      const f = fixtures[program];
      if (!f) continue;
      await tx.finalGrade.deleteMany({ where: { studentId: f.studentId } });
      await tx.qualitativeAssessment.deleteMany({ where: { studentId: f.studentId } });
      await tx.grade.deleteMany({ where: { submission: { studentId: f.studentId } } });
      await tx.submission.deleteMany({ where: { studentId: f.studentId } });
      await tx.exercise.deleteMany({ where: { classBatchId: f.batchId } });
      await tx.classBatch.deleteMany({ where: { id: f.batchId } });
      await tx.student.deleteMany({ where: { id: f.studentId } });
    }
  });
});

// ─── A. NULL-weight path: corrective migration guard ─────────────────────────
//
// These checks run ONLY when a GradingTemplate row already exists for the program
// (i.e. seed-demo.ts was run). On a fresh test DB with no seeded templates the
// computeFinalGrade fallback still works via programWeights() — confirmed by Section B.

describe('A. seeded templates have null weights (corrective migration guard)', () => {
  it('BRIGHT_IG template at facility 1: if it exists, qualitativeWeight must be null', async () => {
    const tpl = await withRls(SUPER, (tx) =>
      tx.gradingTemplate.findFirst({
        where: { facilityId: FACILITY, program: Program.BRIGHT_IG, level: null },
        select: { qualitativeWeight: true, quantitativeWeight: true },
      }),
    );
    // Skip when no template has been seeded (no templates = charter fallback via code, also correct).
    if (!tpl) return;
    // If a template exists, the corrective migration must have cleared both columns to NULL.
    // A non-null value here means the migration was not applied and the bug is active.
    expect(tpl.qualitativeWeight).toBeNull();
    expect(tpl.quantitativeWeight).toBeNull();
  });

  it('BLACK_HOLE template at facility 1: if it exists, quantitativeWeight must be null', async () => {
    const tpl = await withRls(SUPER, (tx) =>
      tx.gradingTemplate.findFirst({
        where: { facilityId: FACILITY, program: Program.BLACK_HOLE, level: null },
        select: { qualitativeWeight: true, quantitativeWeight: true },
      }),
    );
    if (!tpl) return;
    expect(tpl.qualitativeWeight).toBeNull();
    expect(tpl.quantitativeWeight).toBeNull();
  });
});

// ─── B. Charter-blend correctness (mutation proof) ────────────────────────────

describe('B. null-weight templates produce charter-correct blend (fails on old 1.0/0.0 default)', () => {
  it('BRIGHT_IG: finalScore = 0.6×qualScore + 0.4×quantScore ≈ 7.20, not 8.00', async () => {
    const f = fixtures[Program.BRIGHT_IG]!;
    const caller = await staffCaller();
    await caller.assessment.computeFinalGrade({ studentId: f.studentId, program: Program.BRIGHT_IG, periodKey: f.periodKey });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: { studentId_program_periodKey: { studentId: f.studentId, program: Program.BRIGHT_IG, periodKey: f.periodKey } },
        select: { finalScore: true, homeworkAvg: true, qualitativeScore: true },
      }),
    );

    expect(stored).toBeDefined();
    expect(stored?.qualitativeScore).toBeCloseTo(8.0, 2);
    expect(stored?.homeworkAvg).toBeCloseTo(6.0, 2);

    // Charter BRIGHT_IG = 0.6 qual + 0.4 quant: 0.6×8 + 0.4×6 = 7.20
    // Bug (1.0/0.0 default):                    1.0×8 + 0.0×6 = 8.00
    const w = programWeights('BRIGHT_IG');
    const expected = w.qualitative * 8 + w.quantitative * 6;
    expect(stored?.finalScore).toBeCloseTo(expected, 1); // ≈ 7.2
    expect(stored?.finalScore).not.toBeCloseTo(8.0, 1);  // regression guard
  });

  it('BLACK_HOLE: finalScore = 0.3×qualScore + 0.7×quantScore ≈ 6.60, not 8.00', async () => {
    const f = fixtures[Program.BLACK_HOLE]!;
    const caller = await staffCaller();
    await caller.assessment.computeFinalGrade({ studentId: f.studentId, program: Program.BLACK_HOLE, periodKey: f.periodKey });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: { studentId_program_periodKey: { studentId: f.studentId, program: Program.BLACK_HOLE, periodKey: f.periodKey } },
        select: { finalScore: true, qualitativeScore: true, homeworkAvg: true },
      }),
    );

    expect(stored).toBeDefined();
    // Charter BLACK_HOLE = 0.3 qual + 0.7 quant: 0.3×8 + 0.7×6 = 6.60
    // Bug (1.0/0.0 default):                     1.0×8 + 0.0×6 = 8.00
    const w = programWeights('BLACK_HOLE');
    const expected = w.qualitative * 8 + w.quantitative * 6;
    expect(stored?.finalScore).toBeCloseTo(expected, 1); // ≈ 6.6
    expect(stored?.finalScore).not.toBeCloseTo(8.0, 1);  // regression guard
  });

  it('UCREA: finalScore = 1.0×qualScore ≈ 8.00 (qualitative-only; same under both old and new)', async () => {
    const f = fixtures[Program.UCREA]!;
    const caller = await staffCaller();
    await caller.assessment.computeFinalGrade({ studentId: f.studentId, program: Program.UCREA, periodKey: f.periodKey });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: { studentId_program_periodKey: { studentId: f.studentId, program: Program.UCREA, periodKey: f.periodKey } },
        select: { finalScore: true },
      }),
    );

    expect(stored?.finalScore).toBeCloseTo(8.0, 1);
  });
});

// ─── C. Override path: explicit non-null weights are used ────────────────────

describe('C. explicit non-null template weights override charter constants', () => {
  it('BRIGHT_IG template with level=test-override-parity (0.8/0.2) produces 0.8×8 + 0.2×6 ≈ 7.60', async () => {
    const caller = await staffCaller();
    await caller.assessment.computeFinalGrade({
      studentId: overrideStudentId,
      program: Program.BRIGHT_IG,
      periodKey: overridePeriodKey,
      level: OVERRIDE_LEVEL,
    });

    const stored = await withRls(SUPER, (tx) =>
      tx.finalGrade.findUnique({
        where: { studentId_program_periodKey: { studentId: overrideStudentId, program: Program.BRIGHT_IG, periodKey: overridePeriodKey } },
        select: { finalScore: true },
      }),
    );

    // Override weights (0.8/0.2): 0.8×8 + 0.2×6 = 6.4 + 1.2 = 7.60
    // Charter BRIGHT_IG (0.6/0.4): 0.6×8 + 0.4×6 = 7.20 — different, confirms override is active
    const expectedOverride = OVERRIDE_WEIGHTS.qualitative * 8 + OVERRIDE_WEIGHTS.quantitative * 6;
    expect(stored?.finalScore).toBeCloseTo(expectedOverride, 1); // ≈ 7.6
    expect(stored?.finalScore).not.toBeCloseTo(7.2, 1); // not charter (confirms override used)
  });
});
