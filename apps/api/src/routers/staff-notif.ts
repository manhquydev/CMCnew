import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, protectedProcedure } from '../trpc.js';

// All authenticated staff may access their own notifications.
// protectedProcedure covers every staff role (session is required).
const staffNotifProcedure = protectedProcedure;

export const staffNotifRouter = router({
  /** 50 most recent notifications for the current user in a specific facility. */
  list: staffNotifProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.staffNotification.findMany({
          where: { recipientId: ctx.session.userId, facilityId: input.facilityId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      ),
    ),

  /** Count of unread notifications for the current user in a facility. */
  unreadCount: staffNotifProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.staffNotification.count({
          where: { recipientId: ctx.session.userId, facilityId: input.facilityId, readAt: null },
        }),
      ),
    ),

  /** Mark a single notification as read. */
  markRead: staffNotifProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.staffNotification.updateMany({
          where: { id: input.id, recipientId: ctx.session.userId, readAt: null },
          data: { readAt: new Date() },
        }),
      ),
    ),

  /** Mark all unread notifications as read for the current user in a facility. */
  markAllRead: staffNotifProcedure
    .input(z.object({ facilityId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.staffNotification.updateMany({
          where: { recipientId: ctx.session.userId, facilityId: input.facilityId, readAt: null },
          data: { readAt: new Date() },
        }),
      ),
    ),
});
