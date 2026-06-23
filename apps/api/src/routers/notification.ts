import { withRls } from '@cmc/db';
import { lmsRlsContextOf } from '@cmc/auth';
import { router, lmsProcedure } from '../trpc.js';

// Structured payload shape we write at create time (grade.publish). Casting the Json column
// to this avoids returning Prisma's recursive JsonValue, which blows tRPC's TS depth.
export interface NotifPayload {
  submissionId?: string;
  score?: number;
  exercise?: string;
  starsEarned?: number;
}

export const notificationRouter = router({
  // Recent notifications for the principal's own students (RLS pins recipient_id ∈ student_ids).
  list: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const rows = await tx.notification.findMany({
        where: { recipientId: { in: ctx.lms.studentIds } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
      });
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        readAt: r.readAt,
        createdAt: r.createdAt,
        payload: (r.payload ?? {}) as NotifPayload,
      }));
    }),
  ),

  unreadCount: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.notification.count({
        where: { recipientId: { in: ctx.lms.studentIds }, readAt: null },
      }),
    ),
  ),

  // Mark all of the principal's unread notifications read (RLS confines the write to own rows).
  markAllRead: lmsProcedure.mutation(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
      const res = await tx.notification.updateMany({
        where: { recipientId: { in: ctx.lms.studentIds }, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: res.count };
    }),
  ),
});
