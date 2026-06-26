import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, lmsProcedure, studentProcedure, requireRole, Role } from '../trpc.js';
import { annotationDataSchema, type AnnotationData } from '../annotation.js';

const ENTITY = 'submission';

// Scalar grade fields only — never select Prisma Json columns (rubric/annotationLayer)
// into a client-facing shape: their recursive JsonValue type blows tRPC's TS depth limit.
const gradeSelect = {
  id: true,
  score: true,
  maxScore: true,
  feedback: true,
  isPublished: true,
} as const;

const submissionSelect = {
  id: true,
  exerciseId: true,
  studentId: true,
  answerText: true,
  status: true,
  submittedAt: true,
  version: true,
  createdAt: true,
  grade: { select: gradeSelect },
} as const;

export const submissionRouter = router({
  // Staff: all submissions for an exercise (to grade). RLS scopes to facility.
  listByExercise: requireRole(Role.giao_vien, Role.quan_ly)
    .input(z.object({ exerciseId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.submission.findMany({
          where: { exerciseId: input.exerciseId, archivedAt: null },
          select: {
            ...submissionSelect,
            student: { select: { fullName: true, studentCode: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ),
    ),

  // Student: my submissions (RLS = own student_id only).
  mine: studentProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.submission.findMany({
        where: { archivedAt: null },
        select: {
          ...submissionSelect,
          exercise: { select: { title: true, maxScore: true, starReward: true } },
        },
      }),
    ),
  ),

  // Parent/student: submissions of a given student. RLS rejects any studentId the
  // principal does not own, so passing a foreign id simply returns nothing.
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), (tx) =>
        tx.submission.findMany({
          where: { studentId: input.studentId, archivedAt: null },
          select: {
            ...submissionSelect,
            exercise: { select: { title: true, maxScore: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  // Staff: both annotation layers for grading a submission — the student's marks (rendered
  // read-only under the teacher's) and any existing grade layer to keep editing. RLS scopes
  // to facility. Json cast to AnnotationData so the client output type is concrete.
  layerForGrading: requireRole(Role.giao_vien, Role.quan_ly)
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sub = await tx.submission.findUniqueOrThrow({
          where: { id: input.submissionId },
          select: { annotationLayer: true, grade: { select: { annotationLayer: true } } },
        });
        return {
          student: (sub.annotationLayer ?? null) as AnnotationData | null,
          teacher: (sub.grade?.annotationLayer ?? null) as AnnotationData | null,
        };
      }),
    ),

  // Student saves their working copy (answer text + annotation layer over the base PDF).
  save: studentProcedure
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        answerText: z.string().optional(),
        annotationLayer: annotationDataSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
        const ex = await tx.exercise.findUniqueOrThrow({ where: { id: input.exerciseId } });
        const data = {
          answerText: input.answerText ?? null,
          annotationLayer: (input.annotationLayer ?? undefined) as object | undefined,
        };
        return tx.submission.upsert({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          update: data,
          create: { facilityId: ex.facilityId, exerciseId: input.exerciseId, studentId, ...data },
          select: submissionSelect,
        });
      }),
    ),

  // Student reads back their own annotation layer (and, once graded+published, the teacher's
  // layer to overlay). Json columns are cast to AnnotationData here so the client output type is
  // concrete — selecting raw Json would blow tRPC's TS depth (see submissionSelect note).
  myLayer: studentProcedure
    .input(z.object({ exerciseId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) return { mine: null, teacher: null };
        const sub = await tx.submission.findUnique({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          select: { annotationLayer: true, grade: { select: { annotationLayer: true, isPublished: true } } },
        });
        const mine = (sub?.annotationLayer ?? null) as AnnotationData | null;
        const teacher =
          sub?.grade?.isPublished ? ((sub.grade.annotationLayer ?? null) as AnnotationData | null) : null;
        return { mine, teacher };
      }),
    ),

  // Student turns the submission in.
  submit: studentProcedure
    .input(z.object({ exerciseId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
        // Must have a draft to submit; guard so a missing row is a clean NOT_FOUND (not a P2025 500)
        // and a re-submit of an already submitted/graded row is rejected (never silently resets a grade).
        const current = await tx.submission.findUnique({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          select: { status: true },
        });
        if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có bài để nộp' });
        if (current.status !== 'draft') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Bài đã nộp hoặc đã chấm' });
        }
        const sub = await tx.submission.update({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          data: { status: 'submitted', submittedAt: new Date() },
          select: submissionSelect,
        });
        await logEvent(tx, {
          facilityId: ctx.lms.facilityIds[0] ?? null,
          entityType: ENTITY,
          entityId: sub.id,
          type: 'status_changed',
          changes: [{ field: 'status', old: 'draft', new: 'submitted' }],
        });
        return sub;
      }),
    ),
});
