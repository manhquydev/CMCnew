import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, type Prisma } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { getTimeline, getFollowers, logEvent, addFollower } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

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
  // Student chatter: staff can leave notes / view history on a student record (RLS-safe).
  student: (tx, id) => tx.student.findUnique({ where: { id }, select: { facilityId: true } }),
  // CSKH after-sale cases: CSKH staff post notes / track resolution history on a case.
  // facilityId is resolved from the case record so cross-facility access is blocked by RLS.
  after_sale_case: (tx, id) => tx.afterSaleCase.findUnique({ where: { id }, select: { facilityId: true } }),
};

// Chatter timeline (Odoo-style) — dùng chung cho mọi record.
export const auditRouter = router({
  timeline: protectedProcedure
    .input(z.object({ entityType: z.string().min(1), entityId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Same tenancy gate as followers/postNote: record_event allows facility_id IS NULL rows
        // (user/course management events) to be read by any staff under RLS. Without an entity
        // whitelist + visibility pre-check, any staff could read the role/facility/activation
        // history of any user via timeline({ entityType: 'user', entityId }). Restrict to entities
        // that have a Chatter surface and confirm the caller can see the entity first.
        const resolve = NOTE_TARGETS[input.entityType];
        if (!resolve)
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Không hỗ trợ dòng thời gian cho '${input.entityType}'` });
        const entity = await resolve(tx, input.entityId);
        if (!entity)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy bản ghi (hoặc ngoài phạm vi cơ sở)' });
        const rows = await getTimeline(tx, input.entityType, input.entityId);
        // Resolve actor names (same pattern as staffTimeline below) so every Chatter-backed
        // timeline shows "ai làm gì" instead of leaving the caller to trace a raw actorId.
        const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
        const actors = actorIds.length
          ? await tx.appUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
          : [];
        const nameById = new Map(actors.map((a) => [a.id, a.displayName]));
        return rows.map((r) => ({
          ...r,
          actorName: r.actorId ? (nameById.get(r.actorId) ?? 'Người dùng khác') : 'Hệ thống',
        }));
      }),
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
    .mutation(async ({ ctx, input }) => {
      // Fan-out: after commit, push SSE to followers (excluding the author who already sees
      // the note via their own UI). emitStaffNotif persists rows inside tx and returns a push
      // function to be called after withRls resolves so no ghost notifications on tx rollback.
      const push = await withRls(rlsContextOf(ctx.session), async (tx) => {
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
        // Auto-follow: the person posting is now a follower of this record.
        await addFollower(tx, input.entityType, input.entityId, ctx.session.userId);

        // Resolve followers (excluding the author) and prepare SSE fan-out inside the tx.
        const followers = await getFollowers(tx, input.entityType, input.entityId);
        const recipientIds = followers
          .map((f) => f.userId)
          .filter((uid) => uid !== ctx.session.userId);

        return emitStaffNotif(tx, {
          recipientIds,
          event: 'chatter_note',
          title: 'Ghi chú mới',
          body: input.body.length > 100 ? input.body.slice(0, 97) + '…' : input.body,
          data: { entityType: input.entityType, entityId: input.entityId },
          facilityId: entity.facilityId,
        });
      });

      // Push SSE after tx committed — no phantom notifications on rollback.
      push();
      return { ok: true };
    }),

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

  // Read-only staff activity timeline for the unified staff record page (role/facility/status
  // history). This is the SECURE channel for `user` events — deliberately NOT in NOTE_TARGETS,
  // because record_event rows for `user` carry facility_id = NULL and would otherwise be readable
  // by any staff under RLS. Gated by user.viewActivity AND a per-target visibility pre-check:
  // a non-super caller must share at least one facility with the target staff. No note posting.
  staffTimeline: requirePermission('user', 'viewActivity')
    .input(z.object({ userId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        if (!ctx.session.isSuperAdmin) {
          const shared = await tx.userFacility.findFirst({
            where: { userId: input.userId, facilityId: { in: ctx.session.facilityIds } },
            select: { userId: true },
          });
          if (!shared)
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy nhân sự (hoặc ngoài phạm vi cơ sở)' });
        }
        const rows = await getTimeline(tx, 'user', input.userId);
        // Resolve actor names so the log reads "ai làm gì" at a glance (Odoo chatter style) instead
        // of a raw uuid the user would have to trace. Null actor = system/automated action.
        const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
        const actors = actorIds.length
          ? await tx.appUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })
          : [];
        const nameById = new Map(actors.map((a) => [a.id, a.displayName]));
        return rows.map((r) => ({
          ...r,
          actorName: r.actorId ? (nameById.get(r.actorId) ?? 'Người dùng khác') : 'Hệ thống',
        }));
      }),
    ),
});
