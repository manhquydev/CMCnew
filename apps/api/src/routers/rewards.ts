import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Program } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent, diffChanges } from '@cmc/audit';
import { starBalance, checkRedeem, redeemEntry, refundEntry } from '@cmc/domain-rewards';
import { router, lmsProcedure, studentProcedure, requirePermission } from '../trpc.js';

export const rewardsRouter = router({
  // Gift catalog of the principal's facility (RLS = facility scope; principal-agnostic).
  gifts: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.gift.findMany({ where: { isActive: true, archivedAt: null }, orderBy: { starsRequired: 'asc' } }),
    ),
  ),

  // Staff-facing gift list (incl. archived) so the admin panel can drive edit/archive/stock
  // actions. `gifts` above is LMS-only (ctx.lms), unusable from the admin session (ctx.session);
  // gated on giftUpdate — same actor set, no new permissions.ts entry needed.
  giftListAdmin: requirePermission('rewards', 'giftUpdate').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) => tx.gift.findMany({ orderBy: { createdAt: 'desc' } })),
  ),

  giftCreate: requirePermission('rewards', 'giftCreate')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        name: z.string().min(1),
        starsRequired: z.number().int().positive(),
        stock: z.number().int().optional(),
        program: z.nativeEnum(Program).optional(),
        imageUrl: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const gift = await tx.gift.create({
          data: {
            facilityId: input.facilityId,
            name: input.name,
            starsRequired: input.starsRequired,
            stock: input.stock ?? -1,
            program: input.program,
            imageUrl: input.imageUrl,
          },
        });
        await logEvent(tx, {
          facilityId: gift.facilityId,
          entityType: 'gift',
          entityId: gift.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        return gift;
      }),
    ),

  // Star balance for a student. RLS restricts to the principal's own student(s).
  balance: lmsProcedure
    .input(z.object({ studentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = input?.studentId ?? ctx.lms.studentIds[0];
        if (!studentId) return 0;
        const txns = await tx.starTransaction.findMany({ where: { studentId } });
        return starBalance(txns);
      }),
    ),

  // Atomic redeem (charter: advisory lock + stock>0 → no double-spend / over-consume).
  redeem: studentProcedure
    .input(z.object({ giftId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentId = ctx.lms.studentIds[0];
        if (!studentId) throw new TRPCError({ code: 'FORBIDDEN' });
        // Serialise this student's redemptions so the balance check can't race itself.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', studentId);

        const gift = await tx.gift.findUniqueOrThrow({ where: { id: input.giftId } });
        const txns = await tx.starTransaction.findMany({ where: { studentId } });
        const check = checkRedeem(starBalance(txns), gift);
        if (!check.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });

        // Atomic stock guard: 0 rows updated = someone else took the last unit.
        if (gift.stock !== -1) {
          const upd = await tx.gift.updateMany({
            where: { id: gift.id, stock: { gt: 0 } },
            data: { stock: { decrement: 1 } },
          });
          if (upd.count === 0) throw new TRPCError({ code: 'CONFLICT', message: 'out_of_stock' });
        }

        const reward = await tx.reward.create({
          data: {
            facilityId: gift.facilityId,
            studentId,
            giftId: gift.id,
            starsSpent: gift.starsRequired,
            status: 'pending',
          },
        });
        await tx.starTransaction.create({
          data: { facilityId: gift.facilityId, studentId, ...redeemEntry(gift.starsRequired, reward.id) },
        });
        await logEvent(tx, {
          facilityId: gift.facilityId,
          entityType: 'reward',
          entityId: reward.id,
          type: 'created',
          body: `Đổi quà: ${gift.name} (-${gift.starsRequired} sao)`,
        });
        return reward;
      }),
    ),

  // Staff queue of redemptions awaiting review. RLS scopes to the operator's facility.
  pendingList: requirePermission('rewards', 'review').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), async (tx) => {
      const rewards = await tx.reward.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        include: {
          gift: { select: { name: true } },
          student: { select: { fullName: true, studentCode: true } },
        },
      });
      return rewards.map((r) => ({
        id: r.id,
        giftName: r.gift.name,
        studentName: r.student.fullName,
        studentCode: r.student.studentCode,
        starsSpent: r.starsSpent,
        createdAt: r.createdAt,
      }));
    }),
  ),

  // Staff approves/rejects a pending redemption. Reject → refund stars + restore stock.
  review: requirePermission('rewards', 'review')
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['approved', 'rejected']),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Conditional update (not read-then-write) so a concurrent double-review can't both pass
        // the pending check and each run the reject-path stock-restore/star-refund side effects.
        const updated = await tx.reward.updateMany({
          where: { id: input.id, status: 'pending' },
          data: { status: input.decision, reviewedById: ctx.session.userId, reviewedAt: new Date(), reason: input.reason },
        });
        if (updated.count === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Đơn đổi quà đã được xử lý' });
        }
        const reward = await tx.reward.findUniqueOrThrow({ where: { id: input.id } });
        if (input.decision === 'rejected') {
          // Refund stars (idempotent via @@unique(type, reference)).
          await tx.starTransaction.createMany({
            data: [{ facilityId: reward.facilityId, studentId: reward.studentId, ...refundEntry(reward.starsSpent, reward.id) }],
            skipDuplicates: true,
          });
          // Restore stock for limited gifts.
          await tx.gift.updateMany({
            where: { id: reward.giftId, stock: { gte: 0 } },
            data: { stock: { increment: 1 } },
          });
        }
        await logEvent(tx, {
          facilityId: reward.facilityId,
          entityType: 'reward',
          entityId: reward.id,
          type: 'status_changed',
          body: input.decision === 'rejected' ? `Từ chối: ${input.reason ?? ''} (hoàn sao)` : 'Duyệt đổi quà',
          changes: [{ field: 'status', old: 'pending', new: input.decision }],
          actorId: ctx.session.userId,
        });
        return reward;
      }),
    ),

  // Director edits gift catalog fields. Only supplied fields change; audit diff records what moved.
  giftUpdate: requirePermission('rewards', 'giftUpdate')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        starsRequired: z.number().int().positive().optional(),
        stock: z.number().int().optional(),
        program: z.nativeEnum(Program).optional(),
        imageUrl: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { id, ...fields } = input;
        const before = await tx.gift.findUniqueOrThrow({ where: { id } });
        const gift = await tx.gift.update({
          where: { id },
          data: {
            ...(fields.name !== undefined ? { name: fields.name } : {}),
            ...(fields.starsRequired !== undefined ? { starsRequired: fields.starsRequired } : {}),
            ...(fields.stock !== undefined ? { stock: fields.stock } : {}),
            ...(fields.program !== undefined ? { program: fields.program } : {}),
            ...(fields.imageUrl !== undefined ? { imageUrl: fields.imageUrl } : {}),
          },
        });
        const changes = diffChanges(before, gift, ['name', 'starsRequired', 'stock', 'program', 'imageUrl']);
        if (changes.length > 0) {
          await logEvent(tx, {
            facilityId: gift.facilityId,
            entityType: 'gift',
            entityId: gift.id,
            type: 'updated',
            changes,
            actorId: ctx.session.userId,
          });
        }
        return gift;
      }),
    ),

  // Soft-remove a gift from the catalog (never hard-deleted — rewards still reference it).
  giftArchive: requirePermission('rewards', 'giftArchive')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const gift = await tx.gift.update({
          where: { id: input.id },
          data: { isActive: false, archivedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: gift.facilityId,
          entityType: 'gift',
          entityId: gift.id,
          type: 'archived',
          actorId: ctx.session.userId,
        });
        return gift;
      }),
    ),

  // Absolute stock set (`-1` keeps it unlimited). Distinct from the atomic decrement in `redeem`.
  stockAdjust: requirePermission('rewards', 'stockAdjust')
    .input(z.object({ id: z.string().uuid(), stock: z.number().int() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.gift.findUniqueOrThrow({ where: { id: input.id } });
        const gift = await tx.gift.update({ where: { id: input.id }, data: { stock: input.stock } });
        await logEvent(tx, {
          facilityId: gift.facilityId,
          entityType: 'gift',
          entityId: gift.id,
          type: 'updated',
          changes: [{ field: 'stock', old: before.stock, new: gift.stock }],
          actorId: ctx.session.userId,
        });
        return gift;
      }),
    ),

  // Director-gated manual star correction. Does NOT take redeem's advisory lock (accepted
  // trade-off — rare, audited, director-only writes; see plan risk table).
  starAdjust: requirePermission('rewards', 'starAdjust')
    .input(
      z.object({
        studentId: z.string().uuid(),
        amount: z.number().int().refine((v) => v !== 0, 'amount phải khác 0'),
        reason: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
        const txn = await tx.starTransaction.create({
          data: {
            facilityId: student.facilityId,
            studentId: input.studentId,
            amount: input.amount,
            type: 'manual',
            reference: randomUUID(),
          },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'star_transaction',
          entityId: txn.id,
          type: 'created',
          body: `Điều chỉnh sao thủ công: ${input.amount > 0 ? '+' : ''}${input.amount} — ${input.reason}`,
          actorId: ctx.session.userId,
        });
        return txn;
      }),
    ),

  // Staff marks an approved redemption as physically delivered. Terminal — rejects any other
  // source status, including a second call on an already-delivered row.
  markDelivered: requirePermission('rewards', 'markDelivered')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Conditional update (not read-then-write) so a concurrent double-call can't both pass
        // the status check — the WHERE re-validates status atomically at the DB level.
        const updated = await tx.reward.updateMany({
          where: { id: input.id, status: 'approved' },
          data: { status: 'delivered' },
        });
        if (updated.count === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ đơn đã duyệt mới có thể đánh dấu đã giao' });
        }
        const reward = await tx.reward.findUniqueOrThrow({ where: { id: input.id } });
        await logEvent(tx, {
          facilityId: reward.facilityId,
          entityType: 'reward',
          entityId: reward.id,
          type: 'status_changed',
          changes: [{ field: 'status', old: 'approved', new: reward.status }],
          actorId: ctx.session.userId,
        });
        return reward;
      }),
    ),
});
