import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';

export const roomRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.room.findMany({ where: { archivedAt: null }, orderBy: { code: 'asc' } }),
    ),
  ),

  create: requirePermission('room', 'create')
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

  update: requirePermission('room', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        capacity: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { id, ...data } = input;
        const room = await tx.room.update({ where: { id }, data });
        await logEvent(tx, {
          facilityId: room.facilityId,
          entityType: 'room',
          entityId: room.id,
          type: 'updated',
          actorId: ctx.session.userId,
        });
        return room;
      }),
    ),

  archive: requirePermission('room', 'archive')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const room = await tx.room.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
        await logEvent(tx, {
          facilityId: room.facilityId,
          entityType: 'room',
          entityId: room.id,
          type: 'updated',
          body: 'Lưu trữ phòng học',
          actorId: ctx.session.userId,
        });
        return room;
      }),
    ),
});
