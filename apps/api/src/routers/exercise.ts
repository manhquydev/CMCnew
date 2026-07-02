import { z } from 'zod';
import { withRls, ExerciseStatus, ExerciseType } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { openedUnitIdsFor } from '../lib/exercise-open.js';
import { notifyForExercise } from '../services/exercise-open-notify.js';
import { router, protectedProcedure, lmsProcedure, requirePermission } from '../trpc.js';

const ENTITY = 'exercise';

const exerciseSelect = {
  id: true,
  curriculumUnitId: true,
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
} as const;

function flattenExercise<T extends { curriculumUnit: { unitCode: string; unitType: string; course: { program: string; name: string } } }>(
  exercise: T,
) {
  const { curriculumUnit, ...rest } = exercise;
  return {
    ...rest,
    unitCode: curriculumUnit.unitCode,
    unitType: curriculumUnit.unitType,
    program: curriculumUnit.course.program,
    courseName: curriculumUnit.course.name,
  };
}

export const exerciseRouter = router({
  // Staff: exercises attached to units taught by a class.
  listByClass: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const sessions = await tx.classSession.findMany({
          where: {
            classBatchId: input.classBatchId,
            curriculumUnitId: { not: null },
            archivedAt: null,
          },
          select: { curriculumUnitId: true },
        });
        const unitIds = [...new Set(sessions.map((s) => s.curriculumUnitId).filter(Boolean))] as string[];
        if (unitIds.length === 0) return [];
        const rows = await tx.exercise.findMany({
          where: { curriculumUnitId: { in: unitIds }, archivedAt: null },
          select: exerciseSelect,
          orderBy: [{ curriculumUnit: { orderGlobal: 'asc' } }, { type: 'asc' }],
        });
        return rows.map(flattenExercise);
      }),
    ),

  listByUnit: protectedProcedure
    .input(z.object({ curriculumUnitId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const rows = await tx.exercise.findMany({
          where: { curriculumUnitId: input.curriculumUnitId, archivedAt: null },
          select: exerciseSelect,
          orderBy: { type: 'asc' },
        });
        return rows.map(flattenExercise);
      }),
    ),

  // LMS: published exercises open only after one owned student's non-cancelled session
  // for that curriculum unit has ended in ICT.
  listForPrincipal: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const openedUnitIds = await openedUnitIdsFor(tx, ctx.lms.studentIds);
      if (openedUnitIds.length === 0) return [];
      const rows = await tx.exercise.findMany({
        where: { status: 'published', archivedAt: null, curriculumUnitId: { in: openedUnitIds } },
        select: exerciseSelect,
        orderBy: [{ curriculumUnit: { orderGlobal: 'asc' } }, { type: 'asc' }],
      });
      return rows.map(flattenExercise);
    }),
  ),

  upsert: requirePermission('exercise', 'upsert')
    .input(
      z.object({
        curriculumUnitId: z.string().uuid(),
        type: z.nativeEnum(ExerciseType).default('homework'),
        title: z.string().min(1),
        description: z.string().optional(),
        basePdfRef: z.string().optional(),
        maxScore: z.number().positive().optional(),
        starReward: z.number().int().min(0).optional(),
        status: z.nativeEnum(ExerciseStatus).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const exercise = await withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.exercise.findUnique({
          where: { curriculumUnitId_type: { curriculumUnitId: input.curriculumUnitId, type: input.type } },
        });
        const exercise = await tx.exercise.upsert({
          where: { curriculumUnitId_type: { curriculumUnitId: input.curriculumUnitId, type: input.type } },
          update: {
            title: input.title,
            description: input.description ?? null,
            basePdfRef: input.basePdfRef ?? null,
            maxScore: input.maxScore ?? 10,
            starReward: input.starReward ?? 10,
            status: input.status ?? 'draft',
          },
          create: {
            curriculumUnitId: input.curriculumUnitId,
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
