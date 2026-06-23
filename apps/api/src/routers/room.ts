import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';

export const roomRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.room.findMany({ where: { archivedAt: null }, orderBy: { code: 'asc' } }),
    ),
  ),

  create: requireRole(Role.quan_ly)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        code: z.string().min(1),
        name: z.string().min(1),
        capacity: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const room = await tx.room.create({ data: input });
        await logEvent(tx, {
          facilityId: room.facilityId,
          entityType: 'room',
          entityId: room.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        return room;
      }),
    ),
});
