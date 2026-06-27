import { z } from 'zod';
import { withRls, ExerciseType } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, lmsProcedure, requirePermission } from '../trpc.js';

const ENTITY = 'exercise';

export const exerciseRouter = router({
  // Staff: exercises of a class (any status).
  listByClass: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.exercise.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  // LMS (parent/student): published exercises. RLS (exercise_isolation) already scopes
  // these to classes the principal's student(s) are enrolled in.
  listForPrincipal: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.exercise.findMany({
        where: { status: 'published', archivedAt: null },
        orderBy: { dueAt: 'asc' },
      }),
    ),
  ),

  create: requirePermission('exercise', 'create')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classBatchId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        basePdfRef: z.string().optional(),
        maxScore: z.number().positive().optional(),
        starReward: z.number().int().min(0).optional(),
        dueAt: z.string().datetime().optional(),
        type: z.nativeEnum(ExerciseType).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const ex = await tx.exercise.create({
          data: {
            facilityId: input.facilityId,
            classBatchId: input.classBatchId,
            title: input.title,
            description: input.description,
            basePdfRef: input.basePdfRef,
            maxScore: input.maxScore ?? 10,
            starReward: input.starReward ?? 10,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            type: input.type ?? 'homework',
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: ex.facilityId,
          entityType: ENTITY,
          entityId: ex.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        return ex;
      }),
    ),

  publish: requirePermission('exercise', 'publish')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.exercise.findUniqueOrThrow({ where: { id: input.id } });
        const ex = await tx.exercise.update({ where: { id: input.id }, data: { status: 'published' } });
        await logEvent(tx, {
          facilityId: ex.facilityId,
          entityType: ENTITY,
          entityId: ex.id,
          type: 'status_changed',
          actorId: ctx.session.userId,
          changes: [{ field: 'status', old: before.status, new: 'published' }],
        });
        return ex;
      }),
    ),
});
