import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, lmsProcedure, studentProcedure, requireRole, Role } from '../trpc.js';

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

  // Student saves their working copy (answer text + annotation layer over the base PDF).
  save: studentProcedure
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        answerText: z.string().optional(),
        annotationLayer: z.unknown().optional(),
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

  // Student turns the submission in.
  submit: studentProcedure
    .input(z.object({ exerciseId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
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
