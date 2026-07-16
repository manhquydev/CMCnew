import { z } from 'zod';
import { withRls, ExerciseStatus, ExerciseType } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import {
  openedLessonIdsFor,
  openedUnitIdsFor,
  upcomingLessonIdsFor,
  upcomingUnitIdsFor,
} from '../lib/exercise-open.js';
import { notifyForExercise } from '../services/exercise-open-notify.js';
import { router, protectedProcedure, lmsProcedure, requirePermission } from '../trpc.js';

const ENTITY = 'exercise';

const exerciseSelect = {
  id: true,
  curriculumUnitId: true,
  curriculumLessonId: true,
  title: true,
  description: true,
  basePdfRef: true,
  maxScore: true,
  starReward: true,
  type: true,
  status: true,
  createdById: true,
  archivedAt: true,
  createdAt: true,
  curriculumUnit: {
    select: {
      unitCode: true,
      unitType: true,
      orderGlobal: true,
      course: { select: { program: true, name: true } },
    },
  },
  curriculumLesson: {
    select: {
      lessonCode: true,
      seqInUnit: true,
      orderGlobal: true,
      curriculumUnit: {
        select: {
          id: true,
          unitCode: true,
          unitType: true,
          orderGlobal: true,
          course: { select: { program: true, name: true } },
        },
      },
    },
  },
} as const;

type ExerciseWithCurriculum = {
  curriculumUnit: { unitCode: string; unitType: string; course: { program: string; name: string } } | null;
  curriculumLesson: {
    lessonCode: string;
    seqInUnit: number;
    orderGlobal: number;
    curriculumUnit: { id: string; unitCode: string; unitType: string; course: { program: string; name: string } };
  } | null;
};

function flattenExercise<T extends ExerciseWithCurriculum>(exercise: T) {
  const { curriculumUnit, curriculumLesson, ...rest } = exercise;
  const unit = curriculumLesson?.curriculumUnit ?? curriculumUnit;
  return {
    ...rest,
    unitCode: unit?.unitCode ?? null,
    unitType: unit?.unitType ?? null,
    program: unit?.course.program ?? null,
    courseName: unit?.course.name ?? null,
    lessonCode: curriculumLesson?.lessonCode ?? null,
    lessonSeqInUnit: curriculumLesson?.seqInUnit ?? null,
  };
}

export const exerciseRouter = router({
  // Staff: exercises attached to units taught by a class.
  listByClass: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sessions = await tx.classSession.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
          select: { curriculumLessonId: true, curriculumUnitId: true },
        });
        const lessonIds = [...new Set(sessions.map((s) => s.curriculumLessonId).filter(Boolean))] as string[];
        const unitIds = [...new Set(sessions.map((s) => s.curriculumUnitId).filter(Boolean))] as string[];
        if (lessonIds.length === 0 && unitIds.length === 0) return [];
        const rows = await tx.exercise.findMany({
          where: {
            archivedAt: null,
            OR: [
              { curriculumLessonId: { in: lessonIds } },
              { curriculumLessonId: null, curriculumUnitId: { in: unitIds } },
            ],
          },
          select: exerciseSelect,
          orderBy: [{ curriculumLesson: { orderGlobal: 'asc' } }, { curriculumUnit: { orderGlobal: 'asc' } }, { type: 'asc' }],
        });
        return rows.map(flattenExercise);
      }),
    ),

  listByLesson: protectedProcedure
    .input(z.object({ curriculumLessonId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const rows = await tx.exercise.findMany({
          where: { curriculumLessonId: input.curriculumLessonId, archivedAt: null },
          select: exerciseSelect,
          orderBy: { type: 'asc' },
        });
        return rows.map(flattenExercise);
      }),
    ),

  listByUnit: protectedProcedure
    .input(z.object({ curriculumUnitId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const rows = await tx.exercise.findMany({
          where: {
            archivedAt: null,
            OR: [
              { curriculumUnitId: input.curriculumUnitId },
              { curriculumLesson: { curriculumUnitId: input.curriculumUnitId } },
            ],
          },
          select: exerciseSelect,
          orderBy: [{ curriculumLesson: { seqInUnit: 'asc' } }, { type: 'asc' }],
        });
        return rows.map(flattenExercise);
      }),
    ),

  // LMS: published exercises open only after one owned student's non-cancelled session
  // for that curriculum lesson has ended in ICT. Unit lookup remains as legacy fallback.
  listForPrincipal: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const openedLessonIds = await openedLessonIdsFor(tx, ctx.lms.studentIds);
      const openedUnitIds = await openedUnitIdsFor(tx, ctx.lms.studentIds);
      if (openedLessonIds.length === 0 && openedUnitIds.length === 0) return [];
      const rows = await tx.exercise.findMany({
        where: {
          status: 'published',
          archivedAt: null,
          OR: [
            { curriculumLessonId: { in: openedLessonIds } },
            { curriculumLessonId: null, curriculumUnitId: { in: openedUnitIds } },
          ],
        },
        select: exerciseSelect,
        orderBy: [{ curriculumLesson: { orderGlobal: 'asc' } }, { curriculumUnit: { orderGlobal: 'asc' } }, { type: 'asc' }],
      });
      return rows.map(flattenExercise);
    }),
  ),

  // LMS: count-only signal for the "upcoming (locked)" UX (Phase 6, plan
  // 260716-0856-lms-schedule-rewards-exercises). Decision 0038 gates exercise CONTENT on an
  // ended session — this endpoint must never expose id/title/program for not-yet-opened work,
  // only how many are coming (capped at 2), so it deliberately returns a bare count rather than
  // reusing exerciseSelect/flattenExercise.
  upcomingForPrincipal: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const [openedLessonIds, openedUnitIds, upcomingLessonIds, upcomingUnitIds] = await Promise.all([
        openedLessonIdsFor(tx, ctx.lms.studentIds),
        openedUnitIdsFor(tx, ctx.lms.studentIds),
        upcomingLessonIdsFor(tx, ctx.lms.studentIds),
        upcomingUnitIdsFor(tx, ctx.lms.studentIds),
      ]);
      const openedLessonSet = new Set(openedLessonIds);
      const openedUnitSet = new Set(openedUnitIds);
      // A lesson/unit with BOTH an ended session (already opened) and a separate future session
      // must not be double-counted here — its exercise already surfaces via listForPrincipal.
      const candidateLessonIds = upcomingLessonIds.filter((id) => !openedLessonSet.has(id));
      const candidateUnitIds = upcomingUnitIds.filter((id) => !openedUnitSet.has(id));
      if (candidateLessonIds.length === 0 && candidateUnitIds.length === 0) return { upcomingCount: 0 };

      const count = await tx.exercise.count({
        where: {
          status: 'published',
          archivedAt: null,
          OR: [
            { curriculumLessonId: { in: candidateLessonIds } },
            { curriculumLessonId: null, curriculumUnitId: { in: candidateUnitIds } },
          ],
        },
      });
      return { upcomingCount: Math.min(count, 2) };
    }),
  ),

  upsert: requirePermission('exercise', 'upsert')
    .input(
      z.object({
        curriculumLessonId: z.string().uuid().optional(),
        curriculumUnitId: z.string().uuid().optional(),
        type: z.nativeEnum(ExerciseType).default('homework'),
        title: z.string().min(1),
        description: z.string().optional(),
        basePdfRef: z.string().optional(),
        maxScore: z.number().positive().optional(),
        starReward: z.number().int().min(0).optional(),
        status: z.nativeEnum(ExerciseStatus).optional(),
      }).refine((v) => v.curriculumLessonId || v.curriculumUnitId, {
        message: 'Cần chọn buổi học hoặc unit',
        path: ['curriculumLessonId'],
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const exercise = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const lesson = input.curriculumLessonId
          ? await tx.curriculumLesson.findUniqueOrThrow({
              where: { id: input.curriculumLessonId },
              select: { id: true, curriculumUnitId: true },
            })
          : await tx.curriculumLesson.findFirstOrThrow({
              where: { curriculumUnitId: input.curriculumUnitId },
              orderBy: { seqInUnit: 'asc' },
              select: { id: true, curriculumUnitId: true },
            });
        const before = await tx.exercise.findUnique({
          where: { curriculumLessonId_type: { curriculumLessonId: lesson.id, type: input.type } },
        });
        const exercise = await tx.exercise.upsert({
          where: { curriculumLessonId_type: { curriculumLessonId: lesson.id, type: input.type } },
          update: {
            curriculumUnitId: lesson.curriculumUnitId,
            title: input.title,
            description: input.description ?? null,
            basePdfRef: input.basePdfRef ?? null,
            maxScore: input.maxScore ?? 10,
            starReward: input.starReward ?? 10,
            status: input.status ?? 'draft',
          },
          create: {
            curriculumUnitId: lesson.curriculumUnitId,
            curriculumLessonId: lesson.id,
            type: input.type,
            title: input.title,
            description: input.description,
            basePdfRef: input.basePdfRef,
            maxScore: input.maxScore ?? 10,
            starReward: input.starReward ?? 10,
            status: input.status ?? 'draft',
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: null,
          entityType: ENTITY,
          entityId: exercise.id,
          type: before ? 'updated' : 'created',
          actorId: ctx.session.userId,
        });
        return exercise;
      });

      // Trigger A (own SYSTEM_CTX pass, after the director's RLS tx commits): notify every
      // student for whom this unit is already open. Never run inside the tx above.
      if (exercise.status === 'published') {
        await notifyForExercise(exercise.id);
      }

      return exercise;
    }),
});
