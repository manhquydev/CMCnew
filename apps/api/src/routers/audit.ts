import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, type Prisma } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { getTimeline, getFollowers, logEvent, addFollower } from '@cmc/audit';
import { router, protectedProcedure } from '../trpc.js';

// Một ghi chú chỉ được gắn vào record có Chatter + có cơ sở. facilityId LẤY TỪ chính
// record (qua RLS) — không bao giờ tin client gửi lên, nếu không staff cơ sở B có thể
// chèn ghi chú (kể cả facilityId=null = global) vào record của cơ sở A.
const NOTE_TARGETS: Record<
  string,
  (tx: Prisma.TransactionClient, id: string) => Promise<{ facilityId: number } | null>
> = {
  receipt: (tx, id) => tx.receipt.findUnique({ where: { id }, select: { facilityId: true } }),
  opportunity: (tx, id) => tx.opportunity.findUnique({ where: { id }, select: { facilityId: true } }),
  class_batch: (tx, id) => tx.classBatch.findUnique({ where: { id }, select: { facilityId: true } }),
};

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
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // record_follower has no facility_id / RLS, so the follower list is only tenant-safe if we
        // first confirm the caller can see the entity itself (same gate as follow/postNote).
        const resolve = NOTE_TARGETS[input.entityType];
        if (!resolve)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hỗ trợ ghi chú cho '${input.entityType}'` });
        const entity = await resolve(tx, input.entityId);
        if (!entity)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)' });
        return getFollowers(tx, input.entityType, input.entityId);
      }),
    ),

  postNote: protectedProcedure
    .input(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const resolve = NOTE_TARGETS[input.entityType];
        if (!resolve)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hỗ trợ ghi chú cho '${input.entityType}'` });
        // Đọc qua RLS: record ngoài phạm vi cơ sở của staff → trả null → coi như không tồn tại.
        const entity = await resolve(tx, input.entityId);
        if (!entity)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)' });
        await logEvent(tx, {
          facilityId: entity.facilityId,
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
        const resolve = NOTE_TARGETS[input.entityType];
        if (!resolve)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hỗ trợ ghi chú cho '${input.entityType}'` });
        // Đọc qua RLS: record ngoài phạm vi cơ sở của staff → trả null → coi như không tồn tại.
        const entity = await resolve(tx, input.entityId);
        if (!entity)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)' });
        await addFollower(tx, input.entityType, input.entityId, ctx.session.userId);
        return { ok: true };
      }),
    ),
});
