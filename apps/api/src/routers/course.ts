import { z } from 'zod';
import { withRls, Program } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';

const program = z.nativeEnum(Program);

// Course is a GLOBAL catalog (no facility) → audit events carry facilityId: null.
export const courseRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.course.findMany({ where: { archivedAt: null }, orderBy: { code: 'asc' } }),
    ),
  ),

  create: requireRole(Role.quan_ly)
    .input(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        program,
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const course = await tx.course.create({ data: input });
        await logEvent(tx, {
          entityType: 'course',
          entityId: course.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        return course;
      }),
    ),

  archive: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const course = await tx.course.update({
          where: { id: input.id },
          data: { archivedAt: new Date() },
        });
        await logEvent(tx, {
          entityType: 'course',
          entityId: course.id,
          type: 'archived',
          actorId: ctx.session.userId,
        });
        return course;
      }),
    ),
});
