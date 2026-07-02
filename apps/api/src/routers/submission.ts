import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Prisma } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { assertExerciseOpenForStudent } from '../lib/exercise-open.js';
import { router, lmsProcedure, studentProcedure, requirePermission } from '../trpc.js';
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

// Privacy invariant: students and parents must not see score/feedback until
// the teacher explicitly publishes the grade. The UI already hides them but
// server-side enforcement is the authoritative guard.
type GradeRow = { id: string; score: number; maxScore: number; feedback: string | null; isPublished: boolean };
type RedactedGradeRow = { id: string; score: number | null; maxScore: number; feedback: string | null; isPublished: boolean };

function redactUnpublishedGrade(grade: GradeRow | null): RedactedGradeRow | null {
  if (!grade) return null;
  if (!grade.isPublished) {
    return { id: grade.id, score: null, maxScore: grade.maxScore, feedback: null, isPublished: false };
  }
  return grade;
}

export const submissionRouter = router({
  // Staff: all submissions for an exercise (to grade). RLS scopes to facility.
  listByExercise: requirePermission('submission', 'listByExercise')
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
  // Grade fields are redacted server-side when isPublished=false — the UI filter alone is
  // not sufficient because a determined client can read raw tRPC responses.
  mine: studentProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const rows = await tx.submission.findMany({
        where: { archivedAt: null },
        select: {
          ...submissionSelect,
          exercise: { select: { title: true, maxScore: true, starReward: true } },
        },
      });
      return rows.map((s) => ({ ...s, grade: redactUnpublishedGrade(s.grade) }));
    }),
  ),

  // Parent/student: submissions of a given student. RLS rejects any studentId the
  // principal does not own, so passing a foreign id simply returns nothing.
  // Grade fields are redacted server-side when isPublished=false (same invariant as mine).
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const rows = await tx.submission.findMany({
          where: { studentId: input.studentId, archivedAt: null },
          select: {
            ...submissionSelect,
            exercise: { select: { title: true, maxScore: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return rows.map((s) => ({ ...s, grade: redactUnpublishedGrade(s.grade) }));
      }),
    ),

  // Staff: both annotation layers for grading a submission — the student's marks (rendered
  // read-only under the teacher's) and any existing grade layer to keep editing. RLS scopes
  // to facility. Json cast to AnnotationData so the client output type is concrete.
  layerForGrading: requirePermission('submission', 'layerForGrading')
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

  // Parent/guardian: read a specific child's annotation layers (their marks + the published
  // teacher correction). Unlike myLayer (single-student sessions), a guardian session can own
  // multiple children, so studentId is an explicit input — validated against ctx.lms.studentIds
  // (the guardian's own resolved children) before RLS is even consulted, and RLS is the backstop.
  layerForGuardian: lmsProcedure
    .input(z.object({ exerciseId: z.string().uuid(), studentId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      if (!ctx.lms.studentIds.includes(input.studentId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const sub = await tx.submission.findUnique({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId: input.studentId } },
          select: { annotationLayer: true, grade: { select: { annotationLayer: true, isPublished: true } } },
        });
        const student = (sub?.annotationLayer ?? null) as AnnotationData | null;
        const teacher =
          sub?.grade?.isPublished ? ((sub.grade.annotationLayer ?? null) as AnnotationData | null) : null;
        return { student, teacher };
      });
    }),

  // Student saves their working copy (answer text + annotation layer over the base PDF).
  save: studentProcedure
    .input(
      z.object({
        exerciseId: z.string().uuid(),
        answerText: z.string().optional(),
        annotationLayer: annotationDataSchema.optional(),
        version: z.number().int().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
        const { facilityId } = await assertExerciseOpenForStudent(tx, input.exerciseId, studentId);
        const data = {
          answerText: input.answerText ?? null,
          annotationLayer: (input.annotationLayer ?? undefined) as object | undefined,
        };
        const current = await tx.submission.findUnique({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          select: { id: true, version: true },
        });

        if (!current) {
          try {
            const saved = await tx.submission.create({
              data: { facilityId, exerciseId: input.exerciseId, studentId, ...data },
              select: submissionSelect,
            });
            return { ...saved, grade: redactUnpublishedGrade(saved.grade) };
          } catch (err) {
            // Two tabs racing their first save both see no existing row; the loser hits the
            // unique(exerciseId, studentId) constraint instead of the version guard below.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'Bản bài làm đã thay đổi. Vui lòng tải lại trước khi lưu tiếp.',
              });
            }
            throw err;
          }
        }

        if (input.version == null) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bản bài làm đã thay đổi. Vui lòng tải lại trước khi lưu tiếp.',
          });
        }

        const updated = await tx.submission.updateMany({
          where: {
            exerciseId: input.exerciseId,
            studentId,
            version: input.version,
            archivedAt: null,
          },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bản bài làm đã thay đổi. Vui lòng tải lại trước khi lưu tiếp.',
          });
        }

        const saved = await tx.submission.findUniqueOrThrow({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          select: submissionSelect,
        });
        // Redact like mine/forStudent: a student saving their answer must never receive an
        // un-published grade's score/feedback in the response.
        return { ...saved, grade: redactUnpublishedGrade(saved.grade) };
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
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
        const sub = await tx.submission.findUnique({
          where: { exerciseId_studentId: { exerciseId: input.exerciseId, studentId } },
          select: { annotationLayer: true, version: true, grade: { select: { annotationLayer: true, isPublished: true } } },
        });
        const mine = (sub?.annotationLayer ?? null) as AnnotationData | null;
        const teacher =
          sub?.grade?.isPublished ? ((sub.grade.annotationLayer ?? null) as AnnotationData | null) : null;
        return { mine, teacher, version: sub?.version ?? null };
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
        const { facilityId } = await assertExerciseOpenForStudent(tx, input.exerciseId, studentId);
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
          facilityId,
          entityType: ENTITY,
          entityId: sub.id,
          type: 'status_changed',
          changes: [{ field: 'status', old: 'draft', new: 'submitted' }],
        });
        return sub;
      }),
    ),
});
