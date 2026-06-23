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
        const approved = await tx.receipt.update({
          where: { id: receipt.id },
          data: { status: 'approved', code, approvedById: ctx.session.userId, approvedAt: new Date() },
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
