import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import {
  resolvePrice,
  grossForYears,
  tierPercentForYears,
  effectiveDiscountPercent,
  netAmount,
  DEFAULT_DISCOUNT_TIERS,
  type DiscountTier,
} from '@cmc/domain-finance';
import { nextReceiptCode } from '../services/receipt-code.js';
import { router, requireRole, Role } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

/** Discount tiers configured for a facility, or the charter defaults when none are set. */
async function tiersFor(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  facilityId: number,
): Promise<readonly DiscountTier[]> {
  const rows = await tx.discountTier.findMany({
    where: { facilityId, archivedAt: null },
    select: { years: true, percent: true },
  });
  return rows.length ? rows : DEFAULT_DISCOUNT_TIERS;
}

export const financeRouter = router({
  // ── Config: course price (effective-dated) ──────────────────────────────────
  priceCreate: requireRole(Role.quan_ly, Role.ke_toan)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        courseId: z.string().uuid(),
        amount: z.number().int().positive(), // VND / năm
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const price = await tx.coursePrice.create({
          data: {
            facilityId: input.facilityId,
            courseId: input.courseId,
            amount: input.amount,
            effectiveFrom: new Date(input.effectiveFrom),
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: price.facilityId,
          entityType: 'course_price',
          entityId: price.id,
          type: 'created',
          body: `Giá ${input.amount.toLocaleString('vi-VN')}đ/năm từ ${input.effectiveFrom}`,
          actorId: ctx.session.userId,
        });
        return price;
      }),
    ),

  priceList: requireRole(Role.quan_ly, Role.ke_toan)
    .input(z.object({ courseId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.coursePrice.findMany({
          where: { courseId: input.courseId, archivedAt: null },
          orderBy: { effectiveFrom: 'desc' },
        }),
      ),
    ),

  // ── Config: voucher ─────────────────────────────────────────────────────────
  voucherCreate: requireRole(Role.quan_ly, Role.ke_toan)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        code: z.string().min(1),
        percent: z.number().int().min(1).max(100),
        maxUses: z.number().int().positive().default(1),
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const voucher = await tx.voucher.create({
          data: {
            facilityId: input.facilityId,
            code: input.code,
            percent: input.percent,
            maxUses: input.maxUses,
            validFrom: input.validFrom ? new Date(input.validFrom) : null,
            validTo: input.validTo ? new Date(input.validTo) : null,
          },
        });
        await logEvent(tx, {
          facilityId: voucher.facilityId,
          entityType: 'voucher',
          entityId: voucher.id,
          type: 'created',
          body: `Voucher ${input.code} -${input.percent}% (×${input.maxUses})`,
          actorId: ctx.session.userId,
        });
        return voucher;
      }),
    ),

  voucherList: requireRole(Role.quan_ly, Role.ke_toan)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.voucher.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  // ── Receipt: draft → approve → cancel ────────────────────────────────────────
  receiptList: requireRole(Role.ke_toan, Role.quan_ly)
    .input(z.object({ studentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.receipt.findMany({
          where: { ...(input?.studentId ? { studentId: input.studentId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ),
    ),

  // Create a draft: resolve the price effective at creation date, stack tier + voucher under
  // the 35% cap, and store the computed amounts. The voucher is NOT consumed until approve.
  receiptCreate: requireRole(Role.ke_toan, Role.quan_ly)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        studentId: z.string().uuid(),
        courseId: z.string().uuid(),
        yearsPrepaid: z.number().int().min(1).max(3),
        period: z.string().optional(),
        voucherCode: z.string().optional(),
        opportunityId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const prices = await tx.coursePrice.findMany({
          where: { courseId: input.courseId, archivedAt: null },
          select: { effectiveFrom: true, amount: true },
        });
        const annualPrice = resolvePrice(prices, new Date());
        if (annualPrice == null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Khóa học chưa có giá hiệu lực' });
        }
        const gross = grossForYears(annualPrice, input.yearsPrepaid);
        const tierPercent = tierPercentForYears(input.yearsPrepaid, await tiersFor(tx, input.facilityId));

        let voucherId: string | null = null;
        let voucherPercent = 0;
        if (input.voucherCode) {
          const v = await tx.voucher.findFirst({
            where: { facilityId: input.facilityId, code: input.voucherCode, active: true, archivedAt: null },
          });
          if (!v) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher không hợp lệ' });
          // Fail early: reject an out-of-window voucher at create, not as a surprise at approve.
          // Compare against today at UTC midnight — the same basis @db.Date vouchers are stored on.
          const today = new Date(new Date().toISOString().slice(0, 10));
          if (v.validFrom && v.validFrom > today)
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher chưa đến ngày hiệu lực' });
          if (v.validTo && v.validTo < today)
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher đã hết hạn' });
          voucherId = v.id;
          voucherPercent = v.percent;
        }
        const effective = effectiveDiscountPercent(tierPercent, voucherPercent);
        const receipt = await tx.receipt.create({
          data: {
            facilityId: input.facilityId,
            studentId: input.studentId,
            courseId: input.courseId,
            period: input.period,
            yearsPrepaid: input.yearsPrepaid,
            annualPrice,
            grossAmount: gross,
            tierPercent,
            voucherId,
            voucherPercent,
            effectiveDiscountPercent: effective,
            netAmount: netAmount(gross, effective),
            collectedById: ctx.session.userId,
            opportunityId: input.opportunityId,
          },
        });
        await logEvent(tx, {
          facilityId: receipt.facilityId,
          entityType: 'receipt',
          entityId: receipt.id,
          type: 'created',
          body: `Phiếu thu nháp: ${receipt.netAmount.toLocaleString('vi-VN')}đ (giảm ${effective}%)`,
          actorId: ctx.session.userId,
        });
        // Notify ke_toan of this facility that a receipt is pending approval.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: input.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const keToanIds = facilityUsers
          .filter((uf) => uf.user.roles.includes('ke_toan'))
          .map((uf) => uf.userId);
        await emitStaffNotif(tx, {
          recipientIds: keToanIds,
          event: 'receipt_pending_approval',
          title: 'Phiếu thu chờ duyệt',
          body: `Phiếu thu ${receipt.netAmount.toLocaleString('vi-VN')}đ vừa được tạo, chờ kế toán duyệt`,
          data: { receiptId: receipt.id, netAmount: receipt.netAmount },
          facilityId: input.facilityId,
        });
        return receipt;
      }),
    ),

  // Approve: consume the voucher ATOMICALLY (0-row = CONFLICT, fixes legacy M2), allocate the
  // official PT-YYYY-NNNN number, and lock the receipt. Re-checks the validity window at approve.
  receiptApprove: requireRole(Role.ke_toan, Role.quan_ly)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (receipt.status !== 'draft') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phiếu thu không ở trạng thái nháp' });
        }
        if (receipt.voucherId) {
          const consumed = await tx.$executeRaw`
            UPDATE "voucher"
               SET "used_count" = "used_count" + 1
             WHERE "id" = ${receipt.voucherId}::uuid
               AND "active" = true
               AND "used_count" < "max_uses"
               AND ("valid_from" IS NULL OR "valid_from" <= CURRENT_DATE)
               AND ("valid_to"   IS NULL OR "valid_to"   >= CURRENT_DATE)`;
          if (consumed === 0) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Voucher đã hết lượt hoặc hết hạn' });
          }
        }
        const code = await nextReceiptCode(tx, receipt.facilityId, new Date().getFullYear());

        // Freeze sales-commission attribution at approve (docs/specs/payroll-v2-commission-design.md).
        // soldById = the linked opportunity's owner (the credited CVTV). kind: a receipt linked to an
        // opportunity that reached O5_ENROLLED counts as NEW (covers first-time AND win-back via a
        // fresh funnel); otherwise RENEWAL if the student has any prior collected receipt, else NEW.
        const opp = receipt.opportunityId
          ? await tx.opportunity.findUnique({ where: { id: receipt.opportunityId }, select: { ownerId: true, stage: true } })
          : null;
        const priorCollected = await tx.receipt.count({
          where: { studentId: receipt.studentId, id: { not: receipt.id }, status: { in: ['approved', 'sent', 'reconciled'] } },
        });
        const kind = opp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected > 0 ? 'renewal' : 'new';

        const approved = await tx.receipt.update({
          where: { id: receipt.id },
          data: {
            status: 'approved',
            code,
            approvedById: ctx.session.userId,
            approvedAt: new Date(),
            soldById: opp?.ownerId ?? null,
            kind,
          },
        });
        await logEvent(tx, {
          facilityId: approved.facilityId,
          entityType: 'receipt',
          entityId: approved.id,
          type: 'status_changed',
          body: `Duyệt phiếu ${code} (${approved.netAmount.toLocaleString('vi-VN')}đ)`,
          changes: [{ field: 'status', old: 'draft', new: 'approved' }],
          actorId: ctx.session.userId,
        });
        return approved;
      }),
    ),

  // Mark an approved receipt as sent (manual delivery — no online payment in scope).
  receiptMarkSent: requireRole(Role.ke_toan, Role.quan_ly)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const r = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (r.status !== 'approved') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ gửi được phiếu đã duyệt' });
        }
        const sent = await tx.receipt.update({
          where: { id: r.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: sent.facilityId,
          entityType: 'receipt',
          entityId: sent.id,
          type: 'status_changed',
          body: `Đã gửi phiếu ${sent.code}`,
          changes: [{ field: 'status', old: 'approved', new: 'sent' }],
          actorId: ctx.session.userId,
        });
        return sent;
      }),
    ),

  // Reconcile against the cash/bank ledger (manual — no payment gateway).
  receiptReconcile: requireRole(Role.ke_toan, Role.quan_ly)
    .input(z.object({ id: z.string().uuid(), note: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const r = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (r.status !== 'approved' && r.status !== 'sent') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ đối soát phiếu đã duyệt/đã gửi' });
        }
        const rec = await tx.receipt.update({
          where: { id: r.id },
          data: { status: 'reconciled', reconciledAt: new Date(), reconcileNote: input.note },
        });
        await logEvent(tx, {
          facilityId: rec.facilityId,
          entityType: 'receipt',
          entityId: rec.id,
          type: 'status_changed',
          body: `Đối soát phiếu ${rec.code}${input.note ? ': ' + input.note : ''}`,
          changes: [{ field: 'status', old: r.status, new: 'reconciled' }],
          actorId: ctx.session.userId,
        });
        return rec;
      }),
    ),

  // Cancel: refund the voucher use if the receipt had already consumed one.
  receiptCancel: requireRole(Role.ke_toan, Role.quan_ly)
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (receipt.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phiếu thu đã hủy' });
        }
        const hadConsumed = receipt.voucherId && receipt.status !== 'draft';
        if (hadConsumed) {
          await tx.$executeRaw`
            UPDATE "voucher" SET "used_count" = "used_count" - 1
             WHERE "id" = ${receipt.voucherId}::uuid AND "used_count" > 0`;
        }
        const cancelled = await tx.receipt.update({
          where: { id: receipt.id },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason },
        });
        await logEvent(tx, {
          facilityId: cancelled.facilityId,
          entityType: 'receipt',
          entityId: cancelled.id,
          type: 'status_changed',
          body: `Hủy phiếu: ${input.reason}${hadConsumed ? ' (hoàn lượt voucher)' : ''}`,
          changes: [{ field: 'status', old: receipt.status, new: 'cancelled' }],
          actorId: ctx.session.userId,
        });
        return cancelled;
      }),
    ),
});
