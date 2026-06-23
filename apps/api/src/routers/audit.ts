import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { getTimeline, getFollowers, logEvent, addFollower } from '@cmc/audit';
import { router, protectedProcedure } from '../trpc.js';

// Chatter timeline (Odoo-style) — dùng chung cho mọi record.
export const auditRouter = router({
  timeline: protectedProcedure
    .input(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) => getTimeline(tx, input.entityType, input.entityId)),
    ),

  followers: protectedProcedure
    .input(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) => getFollowers(tx, input.entityType, input.entityId)),
    ),

  postNote: protectedProcedure
    .input(
      z.object({
        facilityId: z.number().int().positive().nullish(),
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        await logEvent(tx, {
          facilityId: input.facilityId ?? null,
          entityType: input.entityType,
          entityId: input.entityId,
          type: 'note',
          body: input.body,
          actorId: ctx.session.userId,
        });
        await addFollower(tx, input.entityType, input.entityId, ctx.session.userId);
        return { ok: true };
      }),
    ),

  follow: protectedProcedure
    .input(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        await addFollower(tx, input.entityType, input.entityId, ctx.session.userId);
        return { ok: true };
      }),
    ),
});
