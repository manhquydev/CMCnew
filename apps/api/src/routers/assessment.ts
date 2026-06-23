import { z } from 'zod';
import { withRls, Program } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import {
  computeFinalGrade,
  qualitativeScore,
  type Program as GradingProgram,
  type QuantFormula,
} from '@cmc/domain-grading';
import { router, requireRole, lmsProcedure, Role } from '../trpc.js';

const criteriaSchema = z.record(z.string(), z.number());
const DEFAULT_FORMULA: QuantFormula = { homework: 0.5, test: 0.3, attendance: 0.2 };
const norm10 = (score: number, max: number) => (max > 0 ? (score / max) * 10 : 0);

export const assessmentRouter = router({
  // Pillars + quant formula a teacher needs to fill a qualitative assessment / read a final grade.
  // Pillars come from the program's GradingTemplate (seed), not the client — keeps the form
  // aligned with the configured rubric. Falls back to an empty pillar list + default formula.
  template: requireRole(Role.giao_vien, Role.head_teacher, Role.quan_ly)
    .input(z.object({ program: z.nativeEnum(Program), level: z.string().optional() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tpl = await tx.gradingTemplate.findFirst({
          where: { program: input.program, level: input.level ?? null },
          select: { criteria: true, formula: true },
        });
        const criteria = (tpl?.criteria as { pillars?: string[] } | undefined) ?? {};
        return {
          pillars: Array.isArray(criteria.pillars) ? criteria.pillars : [],
          formula: (tpl?.formula as QuantFormula | undefined) ?? DEFAULT_FORMULA,
        };
      }),
    ),

  // Teacher / head-teacher records a qualitative assessment for a (student, period). 1 per key.
  upsertQualitative: requireRole(Role.giao_vien, Role.head_teacher, Role.quan_ly)
    .input(
      z.object({
        studentId: z.string().uuid(),
        period: z.enum(['MONTHLY', 'END_LEVEL']),
        periodKey: z.string().min(1),
        criteria: criteriaSchema,
        narrative: z.string().optional(),
        program: z.nativeEnum(Program).optional(),
        level: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          select: { facilityId: true },
        });
        const data = {
          period: input.period,
          criteria: input.criteria,
          narrative: input.narrative,
          program: input.program,
          level: input.level,
          assessedById: ctx.session.userId,
        };
        const qa = await tx.qualitativeAssessment.upsert({
          where: { studentId_periodKey: { studentId: input.studentId, periodKey: input.periodKey } },
          update: data,
          create: { facilityId: student.facilityId, studentId: input.studentId, periodKey: input.periodKey, ...data },
          select: { id: true },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'qualitative_assessment',
          entityId: qa.id,
          type: 'updated',
          body: `Đánh giá định tính ${input.periodKey}`,
          actorId: ctx.session.userId,
        });
        return { id: qa.id };
      }),
    ),

  // Compute + store the FinalGrade for (student, program, period). Idempotent (upsert by key).
  // Numbers come from @cmc/domain-grading; this only gathers the inputs.
  computeFinalGrade: requireRole(Role.giao_vien, Role.head_teacher, Role.quan_ly)
    .input(
      z.object({
        studentId: z.string().uuid(),
        program: z.nativeEnum(Program),
        periodKey: z.string().min(1),
        level: z.string().optional(),
        passMark: z.number().min(0).max(10).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          select: { facilityId: true },
        });

        // Published grades, split homework vs test, each normalised to 0..10.
        const grades = await tx.grade.findMany({
          where: { isPublished: true, submission: { studentId: input.studentId, archivedAt: null } },
          select: { score: true, maxScore: true, submission: { select: { exercise: { select: { type: true } } } } },
        });
        const hw = grades.filter((g) => g.submission.exercise.type === 'homework');
        const tests = grades.filter((g) => g.submission.exercise.type !== 'homework');
        const avg = (rows: typeof grades) =>
          rows.length ? rows.reduce((s, g) => s + norm10(g.score, g.maxScore), 0) / rows.length : null;
        const homeworkAvg = avg(hw);
        const testScore = avg(tests);

        // Attendance: present|late count as attended (absent = 0). 0..1.
        const att = await tx.attendance.findMany({
          where: { enrollment: { studentId: input.studentId } },
          select: { status: true },
        });
        const attendanceRate = att.length
          ? att.filter((a) => a.status === 'present' || a.status === 'late').length / att.length
          : null;

        // Qualitative score from the period's assessment pillars.
        const qa = await tx.qualitativeAssessment.findUnique({
          where: { studentId_periodKey: { studentId: input.studentId, periodKey: input.periodKey } },
          select: { criteria: true },
        });
        const qScore = qa ? qualitativeScore(qa.criteria as Record<string, number>) : null;

        // Quant blend weights from the program template (fallback to a sane default).
        const tpl = await tx.gradingTemplate.findFirst({
          where: { facilityId: student.facilityId, program: input.program, level: input.level ?? null },
          select: { formula: true },
        });
        const formula = (tpl?.formula as QuantFormula | undefined) ?? DEFAULT_FORMULA;

        const result = computeFinalGrade({
          program: input.program as GradingProgram,
          qualitativeScore: qScore,
          quant: { homeworkAvg, testScore, attendanceRate },
          formula,
          passMark: input.passMark,
        });

        const fields = {
          level: input.level,
          homeworkAvg,
          attendanceRate,
          testScore,
          qualitativeScore: qScore,
          finalScore: result.finalScore,
          passed: result.passed,
          complete: result.complete,
          computedAt: new Date(),
        };
        const fg = await tx.finalGrade.upsert({
          where: { studentId_program_periodKey: { studentId: input.studentId, program: input.program, periodKey: input.periodKey } },
          update: fields,
          create: { facilityId: student.facilityId, studentId: input.studentId, program: input.program, periodKey: input.periodKey, ...fields },
          select: { id: true, finalScore: true, passed: true, complete: true },
        });
        return fg;
      }),
    ),

  // Parent/student gradebook: FinalGrades + qualitative assessments for one owned student.
  // RLS rejects any studentId the principal does not own (returns nothing).
  gradebook: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const finalGrades = await tx.finalGrade.findMany({
          where: { studentId: input.studentId },
          orderBy: { periodKey: 'desc' },
          select: {
            id: true,
            program: true,
            level: true,
            periodKey: true,
            homeworkAvg: true,
            attendanceRate: true,
            testScore: true,
            qualitativeScore: true,
            finalScore: true,
            passed: true,
            complete: true,
            computedAt: true,
          },
        });
        const qa = await tx.qualitativeAssessment.findMany({
          where: { studentId: input.studentId, archivedAt: null },
          orderBy: { periodKey: 'desc' },
          select: { id: true, period: true, periodKey: true, criteria: true, narrative: true },
        });
        return {
          finalGrades,
          qualitative: qa.map((q) => ({ ...q, criteria: q.criteria as Record<string, number> })),
        };
      }),
    ),
});
