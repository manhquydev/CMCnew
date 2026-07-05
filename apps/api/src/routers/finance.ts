import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, type Program, type Prisma } from '@cmc/db';
import { rlsContextOf, normalizeLoginPhone, normalizeContactPhone, DEFAULT_STUDENT_PASSWORD } from '@cmc/auth';
import { OPEN_OPPORTUNITY_WHERE } from './crm.js';
import { logEvent } from '@cmc/audit';
import {
  resolvePrice,
  grossForYears,
  tierPercentForYears,
  effectiveDiscountPercent,
  netAmount,
  DEFAULT_DISCOUNT_TIERS,
  DISCOUNT_CAP_PERCENT,
  type DiscountTier,
} from '@cmc/domain-finance';
import { nextReceiptCode } from '../services/receipt-code.js';
import { classifyCancelRollback } from '../services/student-provisioning.js';
import { router, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';
import { enqueueEmail } from '../services/email-outbox.js';

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

/** Shape consumed by dashboard.myApprovals — mirrors the type in payroll.ts (structurally
 *  compatible; not re-exported to avoid a cross-router import for a single type alias). */
type ApprovalInboxItem = {
  domain: string;
  id: string;
  title: string;
  submittedAt: Date;
  actionKey: string;
};

/** Approval-inbox source: draft receipts awaiting ke_toan/giam_doc_kinh_doanh approval
 *  (receiptApprove, :272 — expects status 'draft'). */
export async function receiptPendingItems(
  tx: Prisma.TransactionClient,
  facilityId: number,
): Promise<ApprovalInboxItem[]> {
  const rows = await tx.receipt.findMany({
    where: { facilityId, status: 'draft' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      netAmount: true,
      createdAt: true,
      studentName: true,
      student: { select: { fullName: true } },
    },
  });
  return rows.map((r) => ({
    domain: 'receipt',
    id: r.id,
    title: `Phiếu thu ${r.netAmount.toLocaleString('vi-VN')}đ — ${r.student?.fullName ?? r.studentName ?? 'học sinh mới'}`,
    submittedAt: r.createdAt,
    actionKey: 'finance.receiptApprove',
  }));
}

// ── Revenue report + reconciliation worklist (P3) ────────────────────────────
// Read-only aggregation over Receipt + RefundRecord — no schema, no new money path.
// Period key = Receipt.approvedAt (money accepted + code allocated), NOT createdAt (draft time)
// and NOT issuedAt (does not exist on Receipt). This is a LIVE ledger view, not an immutable
// snapshot: a receipt cancelled after its approval month retroactively drops from that month's
// gross on re-run (status no longer qualifies) — intended accounting behavior, not a bug.
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const revenueReportInput = z
  .object({
    from: z.string().regex(dateOnly),
    to: z.string().regex(dateOnly), // exclusive upper bound
    groupBy: z.enum(['month', 'facility', 'course']),
  })
  .refine((d) => new Date(d.from) < new Date(d.to), {
    message: 'from phải trước to',
    path: ['to'],
  })
  .refine(
    (d) => new Date(d.to).getTime() - new Date(d.from).getTime() <= 1096 * 24 * 60 * 60 * 1000,
    { message: 'Khoảng thời gian tối đa 3 năm', path: ['to'] },
  );

type RevenueBucket = {
  key: string;
  label: string;
  gross: number;
  refunds: number;
  net: number;
  count: number;
};

// Gross = SUM(netAmount) of qualifying receipts bucketed by approvedAt; refunds = SUM(RefundRecord.
// amount) bucketed by the refund's OWN createdAt (the actual cash-out event), not the receipt's
// approvedAt — a refund issued in a later month must land in that later month's bucket.
// Raw SQL: RLS applies automatically (same session-scoped tx as every other query in this router).
async function computeRevenueBuckets(
  tx: Parameters<Parameters<typeof withRls>[1]>[0],
  input: { from: string; to: string; groupBy: 'month' | 'facility' | 'course' },
): Promise<RevenueBucket[]> {
  const from = new Date(input.from);
  const to = new Date(input.to);

  let grossRows: Array<{ key: string; gross: bigint; count: bigint }>;
  let refundRows: Array<{ key: string; refunds: bigint }>;

  if (input.groupBy === 'month') {
    grossRows = await tx.$queryRaw`
      SELECT to_char("approved_at", 'YYYY-MM') AS key,
             COALESCE(SUM("net_amount"), 0)::bigint AS gross,
             COUNT(*)::bigint AS count
      FROM "receipt"
      WHERE "status" IN ('approved','sent','reconciled')
        AND "approved_at" >= ${from} AND "approved_at" < ${to}
      GROUP BY 1`;
    refundRows = await tx.$queryRaw`
      SELECT to_char("created_at", 'YYYY-MM') AS key,
             COALESCE(SUM("amount"), 0)::bigint AS refunds
      FROM "refund_record"
      WHERE "created_at" >= ${from} AND "created_at" < ${to}
      GROUP BY 1`;
  } else if (input.groupBy === 'facility') {
    grossRows = await tx.$queryRaw`
      SELECT "facility_id"::text AS key,
             COALESCE(SUM("net_amount"), 0)::bigint AS gross,
             COUNT(*)::bigint AS count
      FROM "receipt"
      WHERE "status" IN ('approved','sent','reconciled')
        AND "approved_at" >= ${from} AND "approved_at" < ${to}
      GROUP BY "facility_id"`;
    refundRows = await tx.$queryRaw`
      SELECT "facility_id"::text AS key,
             COALESCE(SUM("amount"), 0)::bigint AS refunds
      FROM "refund_record"
      WHERE "created_at" >= ${from} AND "created_at" < ${to}
      GROUP BY "facility_id"`;
  } else {
    grossRows = await tx.$queryRaw`
      SELECT "course_id"::text AS key,
             COALESCE(SUM("net_amount"), 0)::bigint AS gross,
             COUNT(*)::bigint AS count
      FROM "receipt"
      WHERE "status" IN ('approved','sent','reconciled')
        AND "approved_at" >= ${from} AND "approved_at" < ${to}
      GROUP BY "course_id"`;
    refundRows = await tx.$queryRaw`
      SELECT r."course_id"::text AS key,
             COALESCE(SUM(rr."amount"), 0)::bigint AS refunds
      FROM "refund_record" rr
      JOIN "receipt" r ON r."id" = rr."receipt_id"
      WHERE rr."created_at" >= ${from} AND rr."created_at" < ${to}
      GROUP BY r."course_id"`;
  }

  const refundByKey = new Map(refundRows.map((r) => [r.key, Number(r.refunds)]));
  const grossByKey = new Map(grossRows.map((r) => [r.key, Number(r.gross)]));
  const countByKey = new Map(grossRows.map((r) => [r.key, Number(r.count)]));
  // Union of both sides: a bucket with refund activity but zero approved-receipt gross in the
  // period (e.g. a receipt approved in an earlier period, refunded in this one) must still show
  // up — iterating grossRows alone would silently drop that refund from the report entirely.
  const keys = [...new Set([...grossByKey.keys(), ...refundByKey.keys()])];
  const buckets: RevenueBucket[] = [];

  if (input.groupBy === 'month') {
    for (const key of keys) {
      const [y, m] = key.split('-');
      const gross = grossByKey.get(key) ?? 0;
      const refunds = refundByKey.get(key) ?? 0;
      buckets.push({
        key,
        label: `Tháng ${m}/${y}`,
        gross,
        refunds,
        net: gross - refunds,
        count: countByKey.get(key) ?? 0,
      });
    }
  } else if (input.groupBy === 'facility') {
    const ids = keys.map((k) => Number(k));
    const facilities = ids.length
      ? await tx.facility.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const labelMap = new Map(facilities.map((f) => [String(f.id), `${f.code} — ${f.name}`]));
    for (const key of keys) {
      const gross = grossByKey.get(key) ?? 0;
      const refunds = refundByKey.get(key) ?? 0;
      buckets.push({
        key,
        label: labelMap.get(key) ?? `#${key}`,
        gross,
        refunds,
        net: gross - refunds,
        count: countByKey.get(key) ?? 0,
      });
    }
  } else {
    const courses = keys.length
      ? await tx.course.findMany({
          where: { id: { in: keys } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const labelMap = new Map(courses.map((c) => [c.id, `${c.code} — ${c.name}`]));
    for (const key of keys) {
      const gross = grossByKey.get(key) ?? 0;
      const refunds = refundByKey.get(key) ?? 0;
      buckets.push({
        key,
        label: labelMap.get(key) ?? key,
        gross,
        refunds,
        net: gross - refunds,
        count: countByKey.get(key) ?? 0,
      });
    }
  }

  buckets.sort((a, b) => a.key.localeCompare(b.key));
  return buckets;
}

// Formula-injection guard: a cell starting with =/+/-/@ is prefixed with a literal quote so
// spreadsheet apps render it as text instead of evaluating it as a formula. Applied only to the
// text (label) column — gross/refunds/net/count are always emitted as plain integers, so a
// legitimately negative "net" bucket is never mistaken for an injection attempt.
//
// Applied unconditionally to the whole label (not just the entity name) — course/facility codes
// are staff-entered free text (course.create has no character restriction beyond non-empty), not
// system-assigned, so a code itself could start with a guarded char at cell position 0. The guard
// is the real boundary here, not the "code — name" label format; covered by a unit test.
export function csvText(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /["\r\n,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function csvNumber(n: number): string {
  return String(Math.trunc(n));
}

// UTF-8 BOM so Excel (vi locale) renders Vietnamese diacritics correctly; CRLF line endings for
// broad spreadsheet-app compatibility.
function buildRevenueCsv(buckets: RevenueBucket[]): string {
  const lines = ['key,label,gross,refunds,net,count'];
  for (const b of buckets) {
    lines.push(
      [
        csvText(b.key),
        csvText(b.label),
        csvNumber(b.gross),
        csvNumber(b.refunds),
        csvNumber(b.net),
        csvNumber(b.count),
      ].join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

export const financeRouter = router({
  // ── Config: course price (effective-dated) ──────────────────────────────────
  priceCreate: requirePermission('finance', 'priceCreate')
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

  priceList: requirePermission('finance', 'priceList')
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
  voucherCreate: requirePermission('finance', 'voucherCreate')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        code: z.string().min(1),
        percent: z.number().int().min(1).max(100),
        maxUses: z.number().int().positive().default(1),
        validFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        validTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
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

  voucherList: requirePermission('finance', 'voucherList')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.voucher.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  // ── Config: discount tier (per-facility year-prepaid discount %) ────────────
  discountTierList: requirePermission('finance', 'discountTierList')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tiers = await tx.discountTier.findMany({
          where: { facilityId: input.facilityId, archivedAt: null },
          orderBy: { years: 'asc' },
        });
        // 0 active rows → tiersFor() falls back to DEFAULT_DISCOUNT_TIERS at pricing time.
        return { tiers, usingDefaults: tiers.length === 0 };
      }),
    ),

  // Upsert on the (facilityId, years) unique constraint, which also covers archived rows —
  // re-adding a previously-archived year must reactivate the SAME row (clear archivedAt +
  // overwrite percent), never insert a second row. Archive is therefore not a per-row history:
  // the audit trail for a past receipt's discount is receipt.tierPercent (frozen at receipt
  // time, schema.prisma) plus the audit log below — not DiscountTier row history.
  discountTierUpsert: requirePermission('finance', 'discountTierUpsert')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        years: z.number().int().min(1),
        percent: z.number().int().min(1).max(DISCOUNT_CAP_PERCENT),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tier = await tx.discountTier.upsert({
          where: { facilityId_years: { facilityId: input.facilityId, years: input.years } },
          create: { facilityId: input.facilityId, years: input.years, percent: input.percent },
          update: { percent: input.percent, archivedAt: null },
        });
        await logEvent(tx, {
          facilityId: tier.facilityId,
          entityType: 'discount_tier',
          entityId: tier.id,
          type: 'updated',
          body: `Bậc giảm giá ${tier.years} năm → ${tier.percent}%`,
          actorId: ctx.session.userId,
        });
        return tier;
      }),
    ),

  discountTierArchive: requirePermission('finance', 'discountTierArchive')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const tier = await tx.discountTier.update({
          where: { id: input.id },
          data: { archivedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: tier.facilityId,
          entityType: 'discount_tier',
          entityId: tier.id,
          type: 'archived',
          body: `Lưu trữ bậc giảm giá ${tier.years} năm (${tier.percent}%)`,
          actorId: ctx.session.userId,
        });
        return tier;
      }),
    ),

  // ── Receipt: draft → approve → cancel ────────────────────────────────────────
  receiptList: requirePermission('finance', 'receiptList')
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

  receiptListOwn: requirePermission('finance', 'receiptListOwn')
    .input(z.object({ opportunityId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.receipt.findMany({
          where: {
            collectedById: ctx.session.userId,
            ...(input?.opportunityId ? { opportunityId: input.opportunityId } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ),
    ),

  // Create a draft: resolve the price effective at creation date, stack tier + voucher under
  // the 35% cap, and store the computed amounts. The voucher is NOT consumed until approve.
  //
  // Two paths:
  //   Existing student  — pass studentId (renewal, explicit link).
  //   New student       — pass parentPhone + studentName (+ optional parentName, studentDob,
  //                        classBatchId). Student is created atomically at receiptApprove, NOT here.
  //                        The receipt is a draft commitment; the student becomes "real" at approve.
  receiptCreate: requirePermission('finance', 'receiptCreate')
    .input(
      z
        .object({
          facilityId: z.number().int().positive(),
          // Existing-student path: set studentId.
          studentId: z.string().uuid().optional(),
          courseId: z.string().uuid(),
          yearsPrepaid: z.number().int().min(1).max(3),
          period: z.string().optional(),
          voucherCode: z.string().optional(),
          opportunityId: z.string().uuid().optional(),
          // New-student provisioning fields (F1).
          parentPhone: z.string().min(1).optional(),
          parentName: z.string().min(1).optional(),
          // Optional: captured at intake; enables OTP login + lms_account_ready notification at approve.
          parentEmail: z.string().email().optional(),
          studentName: z.string().min(1).optional(),
          studentDob: z.string().date().optional(),
          classBatchId: z.string().uuid().optional(),
          // Decision 0037: bypass flag for the soft duplicate-opportunity warning below. Two
          // siblings sharing one parent phone is legitimate, so this never hard-blocks — it just
          // requires staff to consciously re-submit once shown the match.
          confirmDuplicate: z.boolean().optional(),
        })
        .refine((d) => d.studentId || (d.parentPhone && d.studentName), {
          message:
            'Cung cấp studentId (học sinh có sẵn) hoặc parentPhone + studentName (học sinh mới)',
        }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Soft duplicate-opportunity warning (decision 0037): new-student path only, and only when
        // the caller didn't already link an opportunity. Uses the same OPEN_OPPORTUNITY_WHERE as
        // crm.opportunityLookupByPhone so the two features can never define "open" differently.
        if (!input.studentId && input.parentPhone && !input.opportunityId && !input.confirmDuplicate) {
          const dup = await tx.opportunity.findFirst({
            where: {
              facilityId: input.facilityId,
              archivedAt: null,
              ...OPEN_OPPORTUNITY_WHERE,
              contact: { phone: normalizeContactPhone(input.parentPhone) },
            },
            select: { id: true, studentName: true, contact: { select: { fullName: true } } },
          });
          if (dup) {
            return {
              status: 'warning' as const,
              duplicateWarning: {
                opportunityId: dup.id,
                parentName: dup.contact.fullName,
                studentName: dup.studentName,
              },
            };
          }
        }
        const prices = await tx.coursePrice.findMany({
          where: { courseId: input.courseId, archivedAt: null },
          select: { effectiveFrom: true, amount: true },
        });
        const annualPrice = resolvePrice(prices, new Date());
        if (annualPrice == null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Khóa học chưa có giá hiệu lực' });
        }
        const gross = grossForYears(annualPrice, input.yearsPrepaid);
        const tierPercent = tierPercentForYears(
          input.yearsPrepaid,
          await tiersFor(tx, input.facilityId),
        );

        let voucherId: string | null = null;
        let voucherPercent = 0;
        if (input.voucherCode) {
          const v = await tx.voucher.findFirst({
            where: {
              facilityId: input.facilityId,
              code: input.voucherCode,
              active: true,
              archivedAt: null,
            },
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
            studentId: input.studentId ?? null,
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
            // New-student provisioning fields — carried until approve, not acted on here.
            parentPhone: input.parentPhone ?? null,
            parentName: input.parentName ?? null,
            parentEmail: input.parentEmail ?? null,
            studentName: input.studentName ?? null,
            studentDob: input.studentDob ? new Date(input.studentDob) : null,
            classBatchId: input.classBatchId ?? null,
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
        // Notify the UNION of approvers (ke_toan ∪ giam_doc_kinh_doanh — mirrors the
        // receiptApprove grant) that a receipt is pending approval. Dedupe by userId so an
        // account holding both roles is not double-notified.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: input.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const approverIds = [
          ...new Set(
            facilityUsers
              .filter(
                (uf) =>
                  uf.user.roles.includes('ke_toan') ||
                  uf.user.roles.includes('giam_doc_kinh_doanh'),
              )
              .map((uf) => uf.userId),
          ),
        ];
        const pushNotifs = await emitStaffNotif(tx, {
          recipientIds: approverIds,
          event: 'receipt_pending_approval',
          title: 'Phiếu thu chờ duyệt',
          body: `Phiếu thu ${receipt.netAmount.toLocaleString('vi-VN')}đ vừa được tạo, chờ kế toán duyệt`,
          data: { receiptId: receipt.id, netAmount: receipt.netAmount },
          facilityId: input.facilityId,
        });
        return { status: 'success' as const, receipt, pushNotifs };
      }).then((result) => {
        if (result.status === 'warning') return result;
        result.pushNotifs();
        return { status: 'success' as const, receipt: result.receipt };
      }),
    ),

  // Approve: ATOMICALLY voucher consume + receipt code + student provisioning + enrollment.
  // Everything is inside one transaction: any failure rolls back all sub-operations.
  //
  // Student provisioning (F1):
  //   1. If receipt.studentId is already set → student pre-exists; ensure guardian link if parent
  //      phone is also on the receipt.
  //   2. If receipt.studentId is null (new-student path) → dedupe by parentPhone:
  //        Hit  → reuse matched student (no createdByReceiptId set on student).
  //        Miss → create ParentAccount + Student; set student.createdByReceiptId = receipt.id.
  //   3. If receipt.classBatchId is set → create Enrollment (idempotent: skip if already enrolled).
  //   4. Set student.lifecycle = 'active'.
  //   5. Stamp receipt.studentId with the resolved id (for commission attribution below).
  receiptApprove: requirePermission('finance', 'receiptApprove')
    .input(
      z.object({
        id: z.string().uuid(),
        // Optional: director may supply parent email at approve time (new-student path only) when
        // it wasn't captured at intake — enables OTP login once the ParentAccount is provisioned.
        parentEmail: z.string().email().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            course: { select: { program: true } },
          },
        });
        if (receipt.status !== 'draft') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Phiếu thu không ở trạng thái nháp',
          });
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

        // Allocate receipt code first — used to derive studentCode for new students.
        const code = await nextReceiptCode(tx, receipt.facilityId, new Date().getFullYear());

        // Claim the draft atomically before provisioning — prevents concurrent double-approve from
        // duplicating the student. The no-voucher path has no row-level lock prior to this point;
        // a second concurrent approve that passes the early status check above will find count=0
        // here and must abort. Because this is inside the same withRls transaction, any earlier
        // work (voucher consume, code allocation) is rolled back on throw.
        const claimed = await tx.receipt.updateMany({
          where: { id: input.id, status: 'draft' },
          data: {
            status: 'approved',
            code,
            approvedById: ctx.session.userId,
            approvedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Phiếu thu đã được duyệt bởi yêu cầu đồng thời',
          });
        }

        // ── Student provisioning ────────────────────────────────────────────────────
        let resolvedStudentId: string;
        let wasNewStudent = false;
        // Set only on the new-student path — the family-login phone to surface in the
        // provisioning email (null when the parent's phone didn't normalize to a valid VN mobile).
        let normalizedFamilyPhone: string | null = null;

        if (receipt.studentId) {
          // Existing student (renewal or explicit-link path): use the id already on the receipt.
          resolvedStudentId = receipt.studentId;
          // If parent info was also supplied, ensure guardian link exists (idempotent upsert).
          if (receipt.parentPhone) {
            const parentAcc = await tx.parentAccount.findFirst({
              where: { phone: receipt.parentPhone },
            });
            if (parentAcc) {
              await tx.guardian.upsert({
                where: {
                  parentAccountId_studentId: {
                    parentAccountId: parentAcc.id,
                    studentId: resolvedStudentId,
                  },
                },
                create: {
                  facilityId: receipt.facilityId,
                  parentAccountId: parentAcc.id,
                  studentId: resolvedStudentId,
                },
                update: {},
              });
            }
          }
        } else {
          // New-student path: dedupe by parent phone, then find-or-create.
          if (!receipt.parentPhone || !receipt.studentName) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Phiếu không có studentId hoặc parentPhone+studentName — không thể tạo học sinh',
            });
          }
          const program = receipt.course.program as Program;

          // Canonical family-login phone (decision 0033 D1). Falls back to the raw value when it
          // doesn't look like a plausible VN mobile — dedupe/storage never throws on a bad phone,
          // it just means that family has no phone-login, only the break-glass loginStudent path.
          normalizedFamilyPhone = normalizeLoginPhone(receipt.parentPhone);
          const loginPhone = normalizedFamilyPhone ?? receipt.parentPhone;

          // Find or create the ParentAccount by phone. RACE-SAFE (decision 0033 D5/S1): two
          // brand-new siblings of the SAME not-yet-existing phone approved concurrently must NOT
          // abort this money transaction. `INSERT ... ON CONFLICT DO NOTHING` never raises — the
          // loser's insert silently no-ops and both siblings converge on the winner's refetched row.
          let parentAcc = await tx.parentAccount.findFirst({ where: { phone: loginPhone } });
          // Set when the new-ParentAccount insert below hits an email collision, so the
          // propagatedEmail check further down skips its own attempt instead of logging a second
          // redundant "note" event for the exact same email conflict.
          let emailCollisionHandled = false;
          if (!parentAcc) {
            const newId = randomUUID();
            const email = input.parentEmail ?? receipt.parentEmail ?? null;
            const displayName = receipt.parentName ?? loginPhone;
            let inserted: number;
            // A savepoint is REQUIRED here, not optional: Postgres aborts the entire surrounding
            // transaction after any statement error (code 25P02, "current transaction is aborted"),
            // so a plain try/catch retry would fail a second time on the very next statement — a
            // bare try/catch here silently does NOT recover, it just relabels the error. Verified
            // empirically against the dev DB during code review.
            await tx.$executeRawUnsafe('SAVEPOINT sp_parent_email');
            try {
              inserted = await tx.$executeRaw`
                INSERT INTO "parent_account" ("id", "phone", "display_name", "email", "is_active")
                VALUES (${newId}::uuid, ${loginPhone}, ${displayName}, ${email}, true)
                ON CONFLICT ("phone") DO NOTHING`;
            } catch {
              // Unique violation on email (a DIFFERENT parent already owns that email) — roll back
              // to the savepoint (clears the aborted-transaction state) then retry without the
              // email, so the phone-keyed row still gets created rather than surfacing a raw
              // Postgres error to the ke_toan approving this receipt. ON CONFLICT ("phone") only
              // guards the phone column, so an email collision on a genuinely new phone still
              // throws — mirrors the propagatedEmail catch a few lines below (same non-blocking
              // philosophy, same savepoint requirement).
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_parent_email');
              inserted = await tx.$executeRaw`
                INSERT INTO "parent_account" ("id", "phone", "display_name", "email", "is_active")
                VALUES (${newId}::uuid, ${loginPhone}, ${displayName}, NULL, true)
                ON CONFLICT ("phone") DO NOTHING`;
              emailCollisionHandled = true;
              await logEvent(tx, {
                facilityId: receipt.facilityId,
                entityType: 'parent_account',
                entityId: newId,
                type: 'note',
                body: `Email ${email} khi duyệt phiếu ${code} đã thuộc tài khoản khác — tạo tài khoản phụ huynh mới không kèm email`,
                actorId: ctx.session.userId,
              });
            }
            parentAcc = await tx.parentAccount.findFirstOrThrow({ where: { phone: loginPhone } });
            if (inserted > 0) {
              await logEvent(tx, {
                facilityId: receipt.facilityId,
                entityType: 'parent_account',
                entityId: parentAcc.id,
                type: 'created',
                body: `Tài khoản phụ huynh tạo tự động khi duyệt phiếu ${code}`,
                actorId: ctx.session.userId,
              });
            }
          }
          // Family password set ONCE, idempotent: a returning parent's existing family password is
          // NEVER overwritten (this is what lets a 2nd sibling just link, no new credential minted).
          if (!parentAcc.passwordHash) {
            const familyPasswordHash = await hashPassword(DEFAULT_STUDENT_PASSWORD);
            parentAcc = await tx.parentAccount.update({
              where: { id: parentAcc.id },
              data: { passwordHash: familyPasswordHash },
            });
          }

          // Find existing student linked to this parent (dedupe).
          // If multiple children share the same parent, match by studentName (case-insensitive).
          const guardians = await tx.guardian.findMany({
            where: { parentAccountId: parentAcc.id },
            include: { student: { select: { id: true, fullName: true, archivedAt: true } } },
          });
          const activeGuardians = guardians.filter((g) => !g.student.archivedAt);
          // Always disambiguate by name — even when exactly one guardian exists.
          // Merging two distinct children (mixed money/attendance) is the worse failure,
          // so we never auto-reuse without a name match.
          const matchedStudent =
            activeGuardians.find(
              (g) =>
                g.student.fullName.trim().toLowerCase() ===
                receipt.studentName!.trim().toLowerCase(),
            )?.student ?? null;

          if (matchedStudent) {
            // Dedupe hit: reuse existing student — do NOT set createdByReceiptId.
            resolvedStudentId = matchedStudent.id;
            await logEvent(tx, {
              facilityId: receipt.facilityId,
              entityType: 'student',
              entityId: resolvedStudentId,
              type: 'note',
              body: `Học sinh khớp dedupe (SĐT ${receipt.parentPhone}) khi duyệt phiếu ${code}`,
              actorId: ctx.session.userId,
            });
          } else {
            // No match: create new student. studentCode derived from the receipt code for traceability.
            const studentCode = 'HS' + code.substring(2); // PT-YYYY-NNNN → HS-YYYY-NNNN
            const newStudent = await tx.student.create({
              data: {
                facilityId: receipt.facilityId,
                studentCode,
                fullName: receipt.studentName,
                program,
                dateOfBirth: receipt.studentDob ?? null,
                lifecycle: 'admitted',
                createdByReceiptId: receipt.id, // provenance: this receipt created this student
              },
            });
            wasNewStudent = true;
            resolvedStudentId = newStudent.id;
            await logEvent(tx, {
              facilityId: receipt.facilityId,
              entityType: 'student',
              entityId: newStudent.id,
              type: 'created',
              body: `Học sinh tạo tự động khi duyệt phiếu ${code} (SĐT PH: ${receipt.parentPhone})`,
              actorId: ctx.session.userId,
            });
          }

          // Propagate parentEmail to the ParentAccount when provided (idempotent: ignore if already set to same value).
          // This enables OTP login even when the account was originally created phone-only.
          // Resolves input.parentEmail (supplied at approve time) OR receipt.parentEmail (captured at
          // intake) — same fallback as the new-ParentAccount insert above and the notify-email check below.
          // Skip entirely if the new-ParentAccount insert above already hit this exact email
          // collision (emailCollisionHandled) — avoids logging the same conflict twice.
          const propagatedEmail = input.parentEmail ?? receipt.parentEmail;
          if (!emailCollisionHandled && propagatedEmail && parentAcc.email !== propagatedEmail) {
            // Savepoint required — see the identical note on the new-ParentAccount insert above:
            // Postgres aborts the whole transaction on a unique-violation, so a bare try/catch here
            // does not actually recover; every statement after an uncaught abort (guardian.upsert
            // below, and everything through the end of receiptApprove) would fail with 25P02.
            await tx.$executeRawUnsafe('SAVEPOINT sp_propagated_email');
            try {
              await tx.parentAccount.update({
                where: { id: parentAcc.id },
                data: { email: propagatedEmail },
              });
            } catch {
              // Unique violation: another account already owns that email — roll back to the
              // savepoint (clears the aborted-transaction state), log, and continue.
              await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp_propagated_email');
              await logEvent(tx, {
                facilityId: receipt.facilityId,
                entityType: 'parent_account',
                entityId: parentAcc.id,
                type: 'note',
                body: `parentEmail ${propagatedEmail} dari phiếu ${code} đã thuộc tài khoản khác — bỏ qua`,
                actorId: ctx.session.userId,
              });
            }
          }

          // Ensure Guardian link (idempotent).
          await tx.guardian.upsert({
            where: {
              parentAccountId_studentId: {
                parentAccountId: parentAcc.id,
                studentId: resolvedStudentId,
              },
            },
            create: {
              facilityId: receipt.facilityId,
              parentAccountId: parentAcc.id,
              studentId: resolvedStudentId,
            },
            update: {},
          });
        }

        // Activate student lifecycle (idempotent: only log the transition when it actually changes).
        const student = await tx.student.findUniqueOrThrow({
          where: { id: resolvedStudentId },
          select: { lifecycle: true, fullName: true, studentCode: true },
        });
        if (student.lifecycle !== 'active') {
          await tx.student.update({
            where: { id: resolvedStudentId },
            data: { lifecycle: 'active' },
          });
          await logEvent(tx, {
            facilityId: receipt.facilityId,
            entityType: 'student',
            entityId: resolvedStudentId,
            type: 'status_changed',
            body: `Lifecycle: ${student.lifecycle}→active (phiếu ${code} duyệt)`,
            changes: [{ field: 'lifecycle', old: student.lifecycle, new: 'active' }],
            actorId: ctx.session.userId,
          });
        }

        // Create enrollment if a class batch was specified (idempotent: skip on duplicate).
        // null when no classBatchId (no class picked at receipt time — capacity check N/A).
        let overCapacity: boolean | null = null;
        if (receipt.classBatchId) {
          // No courseId-match guard: ClassBatch.courseId references the curriculum-content course
          // (drives LMS homework mapping), while Receipt.courseId references the priced sales
          // course (what was billed) — two structurally separate catalogs, not the same entity.
          // Staff picks the class explicitly in the UI; that choice is trusted here.
          //
          // Facility-match guard kept: a multi-facility staff member (director/admin with grants
          // across facilities) could otherwise enroll a student billed at facility A into a batch
          // that physically belongs to facility B via the class picker — that's a real defect
          // (wrong roster, wrong attendance scoping), distinct from the courseId conflation above.
          const batchForFacilityCheck = await tx.classBatch.findUniqueOrThrow({
            where: { id: receipt.classBatchId },
            select: { facilityId: true, capacity: true },
          });
          if (batchForFacilityCheck.facilityId !== receipt.facilityId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Lớp học không thuộc cơ sở của phiếu thu',
            });
          }

          const existing = await tx.enrollment.findFirst({
            where: {
              classBatchId: receipt.classBatchId,
              studentId: resolvedStudentId,
              archivedAt: null,
            },
            select: { id: true },
          });
          // Capacity = cảnh báo mềm (không chặn), đồng nhất với enrollment.enroll/transfer —
          // trước đây đường tiền này không tính overCapacity, nhồi vượt sức chứa không cảnh báo.
          const activeCount = await tx.enrollment.count({
            where: { classBatchId: receipt.classBatchId, status: 'active', archivedAt: null },
          });
          if (!existing) {
            overCapacity =
              batchForFacilityCheck.capacity != null && activeCount + 1 > batchForFacilityCheck.capacity;
            const enrollment = await tx.enrollment.create({
              data: {
                facilityId: receipt.facilityId,
                classBatchId: receipt.classBatchId,
                studentId: resolvedStudentId,
                status: 'active',
                opportunityId: receipt.opportunityId ?? null,
                createdByReceiptId: receipt.id, // provenance for rollback scoping
              },
            });
            await logEvent(tx, {
              facilityId: receipt.facilityId,
              entityType: 'enrollment',
              entityId: enrollment.id,
              type: 'created',
              body: `Ghi danh tự động khi duyệt phiếu ${code}`,
              actorId: ctx.session.userId,
            });
          } else {
            // Idempotent retry: no new seat taken, activeCount already reflects it — no +1.
            overCapacity =
              batchForFacilityCheck.capacity != null && activeCount > batchForFacilityCheck.capacity;
          }
        }
        // ── LMS StudentAccount provisioning ────────────────────────────────────────
        // Auto-create a StudentAccount only when this approve created a brand-new student.
        // Idempotent: if an account already exists, skip and return no credential. A pre-existing
        // or dedupe-matched student without an LMS account is provisioned on demand by staff via
        // student.resetLmsPassword (create-or-reset), keeping this money path minimal.
        // The tempPassword is returned plaintext exactly once (not stored); staff relay it to the parent.
        let lmsAccount: { loginCode: string; tempPassword: string } | null = null;

        const existingLmsAcc = await tx.studentAccount.findUnique({
          where: { studentId: resolvedStudentId },
          select: { id: true, loginCode: true },
        });

        if (!existingLmsAcc && wasNewStudent) {
          // Fixed default (decision 0033 D2) — this is the break-glass loginStudent fallback for
          // when the family has no usable phone; the family login (above) is the primary path.
          const tempPassword = DEFAULT_STUDENT_PASSWORD;
          const passwordHash = await hashPassword(tempPassword);
          // loginCode must be GLOBALLY unique (student_account.login_code is a global @unique), but
          // studentCode is only facility-scoped (receipt codes are allocated per-facility), so two
          // facilities can both mint "HS-2026-0001". Prefix with the facility code (itself globally
          // unique) → e.g. "HQ-HS-2026-0042" — so a second facility's student never collides and rolls
          // back the whole receipt.approve (the money path).
          const facility = await tx.facility.findUniqueOrThrow({
            where: { id: receipt.facilityId },
            select: { code: true },
          });
          const loginCode = `${facility.code}-${student.studentCode}`;
          const lmsRec = await tx.studentAccount.create({
            data: {
              studentId: resolvedStudentId,
              loginCode,
              passwordHash,
              isActive: true,
            },
          });
          lmsAccount = { loginCode: lmsRec.loginCode, tempPassword };
          await logEvent(tx, {
            facilityId: receipt.facilityId,
            entityType: 'student',
            entityId: resolvedStudentId,
            type: 'created',
            body: `Tài khoản LMS tạo tự động khi duyệt phiếu ${code} (mã: ${lmsRec.loginCode})`,
            actorId: ctx.session.userId,
          });

          // Notify parent via email when parentEmail is available. Falls back to receipt.parentEmail
          // for the case where it was captured at intake (receiptCreate); input.parentEmail covers the
          // "supplied at approve time" dialog path (director/ke_toan filling it in for a new-student
          // receipt that had none) — same resolution as the ParentAccount creation above (line ~732).
          const notifyEmail = input.parentEmail ?? receipt.parentEmail;
          if (notifyEmail && lmsAccount) {
            const parentName = receipt.parentName ?? undefined;
            await enqueueEmail(tx, {
              facilityId: receipt.facilityId,
              dedupKey: `lms_account_ready:${resolvedStudentId}`,
              to: notifyEmail,
              mailbox: 'notify',
              kind: 'lms_account_ready',
              data: {
                parentName,
                studentName: student.fullName,
                familyPhone: normalizedFamilyPhone ?? undefined,
                loginCode: lmsRec.loginCode,
                tempPassword,
              },
            });
          }
        }
        // ── End LMS provisioning ────────────────────────────────────────────────────

        // ── End student provisioning ────────────────────────────────────────────────

        // Freeze sales-commission attribution at approve (docs/specs/payroll-v2-commission-design.md).
        // soldById = the linked opportunity's owner (the credited CVTV). kind: a receipt linked to an
        // opportunity that reached O5_ENROLLED counts as NEW (covers first-time AND win-back via a
        // fresh funnel); otherwise RENEWAL if the student has any prior collected receipt, else NEW.
        const opp = receipt.opportunityId
          ? await tx.opportunity.findUnique({
              where: { id: receipt.opportunityId },
              select: {
                id: true,
                ownerId: true,
                stage: true,
                studentName: true,
                closedAt: true,
                lostReason: true,
              },
            })
          : null;

        // Attribution guard: only credit commission from the linked opportunity when it actually
        // belongs to this receipt's student. The opportunity's studentName (when set) is matched
        // against the student's name; on MISMATCH we DROP the commission credit (and stage-based
        // kind) and audit it — a name typo must never block revenue collection, only prevent
        // mis-attributing the sale to the wrong consultant. A null opp.studentName can't be
        // validated, so it is trusted (legacy/loose link).
        let attributedOpp = opp;
        if (opp?.studentName) {
          const student = await tx.student.findUnique({
            where: { id: resolvedStudentId },
            select: { fullName: true },
          });
          const oppName = opp.studentName.trim().toLowerCase();
          const receiptStudentName = (student?.fullName ?? receipt.studentName ?? '')
            .trim()
            .toLowerCase();
          if (!receiptStudentName || oppName !== receiptStudentName) {
            attributedOpp = null; // unrelated opportunity → no commission credit
            await logEvent(tx, {
              facilityId: receipt.facilityId,
              entityType: 'receipt',
              entityId: receipt.id,
              type: 'updated',
              body: `Bỏ quy kết hoa hồng khi duyệt ${code}: cơ hội "${opp.studentName}" không khớp học sinh "${student?.fullName ?? receipt.studentName ?? '—'}"`,
              actorId: ctx.session.userId,
            });
          }
        }
        if (attributedOpp?.closedAt && attributedOpp.lostReason) {
          attributedOpp = null;
        }
        const priorCollected = await tx.receipt.count({
          where: {
            studentId: resolvedStudentId,
            id: { not: receipt.id },
            status: { in: ['approved', 'sent', 'reconciled'] },
          },
        });
        const kind = attributedOpp ? 'new' : priorCollected > 0 ? 'renewal' : 'new';

        if (attributedOpp && attributedOpp.stage !== 'O5_ENROLLED') {
          await tx.opportunity.update({
            where: { id: attributedOpp.id },
            data: { stage: 'O5_ENROLLED', closedAt: new Date(), lostReason: null, lostNote: null },
          });
          await logEvent(tx, {
            facilityId: receipt.facilityId,
            entityType: 'opportunity',
            entityId: attributedOpp.id,
            type: 'status_changed',
            body: `Cơ hội tự chuyển O5 khi duyệt phiếu ${code}`,
            changes: [{ field: 'stage', old: attributedOpp.stage, new: 'O5_ENROLLED' }],
            actorId: ctx.session.userId,
          });
        }

        // status, code, approvedById, approvedAt were already stamped by the conditional claim above.
        // Only stamp fields that depend on provisioning results.
        const approved = await tx.receipt.update({
          where: { id: receipt.id },
          data: {
            studentId: resolvedStudentId, // stamp resolved student (noop if was already set)
            soldById: attributedOpp?.ownerId ?? null,
            kind,
          },
        });
        await logEvent(tx, {
          facilityId: approved.facilityId,
          entityType: 'receipt',
          entityId: approved.id,
          type: 'status_changed',
          body: `Duyệt phiếu ${code} (${approved.netAmount.toLocaleString('vi-VN')}đ)${wasNewStudent ? ' — học sinh mới' : ''}${lmsAccount ? ' + tài khoản LMS' : ''}`,
          changes: [{ field: 'status', old: 'draft', new: 'approved' }],
          actorId: ctx.session.userId,
        });
        // lmsAccount is returned once so staff can relay the credential to the parent.
        // tempPassword is NOT stored anywhere after this point.
        return { ...approved, lmsAccount, overCapacity };
      }),
    ),

  // Mark an approved receipt as sent (manual delivery — no online payment in scope).
  receiptMarkSent: requirePermission('finance', 'receiptMarkSent')
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
  receiptReconcile: requirePermission('finance', 'receiptReconcile')
    .input(z.object({ id: z.string().uuid(), note: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const r = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (r.status !== 'approved' && r.status !== 'sent') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Chỉ đối soát phiếu đã duyệt/đã gửi',
          });
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

  // Cancel: refund voucher use + student/enrollment rollback when the receipt was previously approved.
  //
  // Rollback branches (F1) — only runs when status was approved/sent/reconciled:
  //   void_student  = student was created by THIS receipt AND has 0 attendance on its
  //                   enrollments AND no other approved receipt → soft-archive student + withdraw enrollments.
  //   refund_only   = pre-existing student / has attendance / has other approved receipt
  //                 → withdraw only the enrollment(s) created by this receipt; student untouched.
  //
  // Commission claw-back: receipt.status flips to 'cancelled'; payroll.ts period-filter
  // (status IN approved/sent/reconciled) naturally excludes cancelled receipts — no extra logic needed.
  receiptCancel: requirePermission('finance', 'receiptCancel')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: input.id } });
        if (receipt.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Phiếu thu đã hủy' });
        }

        // Was this receipt ever approved? (affects voucher refund + student rollback)
        const wasApproved =
          receipt.status === 'approved' ||
          receipt.status === 'sent' ||
          receipt.status === 'reconciled';

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

        if (wasApproved && receipt.opportunityId) {
          const opp = await tx.opportunity.findUnique({
            where: { id: receipt.opportunityId },
            select: { id: true, stage: true, closedAt: true, lostReason: true },
          });
          if (opp?.stage === 'O5_ENROLLED' && opp.closedAt && !opp.lostReason) {
            const approvedOnOpp = await tx.receipt.count({
              where: {
                opportunityId: receipt.opportunityId,
                id: { not: receipt.id },
                status: { in: ['approved', 'sent', 'reconciled'] },
              },
            });
            if (approvedOnOpp === 0) {
              await tx.opportunity.update({
                where: { id: receipt.opportunityId },
                data: { stage: 'O4_TESTED', closedAt: null },
              });
              await logEvent(tx, {
                facilityId: cancelled.facilityId,
                entityType: 'opportunity',
                entityId: receipt.opportunityId,
                type: 'status_changed',
                body: `Cơ hội quay về O4 khi hủy phiếu ${cancelled.code ?? receipt.id}`,
                changes: [{ field: 'stage', old: 'O5_ENROLLED', new: 'O4_TESTED' }],
                actorId: ctx.session.userId,
              });
            }
          }
        }

        // ── Student/enrollment rollback (only when receipt was previously approved) ──────
        if (wasApproved && receipt.studentId) {
          // Fetch the enrollments created by this receipt (provenance-scoped).
          const provEnrollments = await tx.enrollment.findMany({
            where: { createdByReceiptId: receipt.id, archivedAt: null },
            select: { id: true, classBatchId: true, status: true },
          });

          // Count attendance on those specific enrollments only.
          const attendanceCount =
            provEnrollments.length > 0
              ? await tx.attendance.count({
                  where: { enrollmentId: { in: provEnrollments.map((e) => e.id) } },
                })
              : 0;

          // Count other approved receipts for this student (excluding the one being cancelled).
          const otherApprovedCount = await tx.receipt.count({
            where: {
              studentId: receipt.studentId,
              id: { not: receipt.id },
              status: { in: ['approved', 'sent', 'reconciled'] },
            },
          });

          // Fetch the student's provenance to decide which branch to take.
          const studentRec = await tx.student.findUniqueOrThrow({
            where: { id: receipt.studentId },
            select: { createdByReceiptId: true, fullName: true },
          });

          const decision = classifyCancelRollback({
            receiptId: receipt.id,
            studentCreatedByReceiptId: studentRec.createdByReceiptId,
            attendanceCountForThisReceiptEnrollments: attendanceCount,
            otherApprovedReceiptCount: otherApprovedCount,
          });

          // Wind down the enrollments created by this receipt regardless of branch.
          if (provEnrollments.length > 0) {
            await tx.enrollment.updateMany({
              where: { id: { in: provEnrollments.map((e) => e.id) } },
              data: { status: 'withdrawn' },
            });
            for (const enr of provEnrollments) {
              await logEvent(tx, {
                facilityId: cancelled.facilityId,
                entityType: 'enrollment',
                entityId: enr.id,
                type: 'status_changed',
                body: `Ghi danh bị thu hồi khi hủy phiếu ${cancelled.code ?? receipt.id} (${decision.action})`,
                changes: [{ field: 'status', old: enr.status, new: 'withdrawn' }],
                actorId: ctx.session.userId,
              });
            }
          }

          if (decision.action === 'void_student') {
            // Soft-archive the student — never hard-delete.
            await tx.student.update({
              where: { id: receipt.studentId },
              data: { archivedAt: new Date() },
            });
            await logEvent(tx, {
              facilityId: cancelled.facilityId,
              entityType: 'student',
              entityId: receipt.studentId,
              type: 'archived',
              body: `Học sinh tạm lưu trữ (void): phiếu ${cancelled.code ?? receipt.id} bị hủy, không có buổi học, không có phiếu khác`,
              actorId: ctx.session.userId,
            });
          }
          // refund_only: student untouched (no further action).
        }
        // ── End rollback ─────────────────────────────────────────────────────────────

        return cancelled;
      }),
    ),

  // Append-only refund ledger (money-out), decision 0028. Never mutates receipt.netAmount.
  // Guard folded into ONE atomic critical section (SELECT ... FOR UPDATE on the receipt row,
  // not read-then-check): status must be 'cancelled' AND approvedAt must be set (a draft
  // cancelled before ever being approved never took money in, so it gets no refund row), and
  // the running sum of refunds for this receipt must stay <= receipt.netAmount. The row lock
  // serializes concurrent refundCreate calls on the same receipt: the second call blocks on
  // FOR UPDATE until the first commits, then re-reads the sum including the first's insert.
  refundCreate: requirePermission('finance', 'refundCreate')
    .input(
      z.object({
        receiptId: z.string().uuid(),
        amount: z.number().int().min(1),
        reason: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // RLS-filtered: a cross-facility caller gets 0 rows here, same as any other receipt read.
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            facility_id: number;
            net_amount: number;
            status: string;
            approved_at: Date | null;
          }>
        >`
          SELECT id, facility_id, net_amount, status, approved_at
          FROM "receipt"
          WHERE id = ${input.receiptId}::uuid
          FOR UPDATE
        `;
        const receipt = locked[0];
        if (!receipt || receipt.status !== 'cancelled' || receipt.approved_at === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Chỉ ghi hoàn tiền cho phiếu đã hủy và đã từng được duyệt',
          });
        }
        const sumRows = await tx.$queryRaw<Array<{ sum: number }>>`
          SELECT COALESCE(SUM(amount), 0)::int AS sum
          FROM "refund_record"
          WHERE receipt_id = ${input.receiptId}::uuid
        `;
        const alreadyRefunded = sumRows[0]?.sum ?? 0;
        if (alreadyRefunded + input.amount > receipt.net_amount) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Vượt số tiền phiếu: đã hoàn ${alreadyRefunded.toLocaleString('vi-VN')}đ / ${receipt.net_amount.toLocaleString('vi-VN')}đ`,
          });
        }
        const refund = await tx.refundRecord.create({
          data: {
            receiptId: input.receiptId,
            facilityId: receipt.facility_id,
            amount: input.amount,
            reason: input.reason,
            recordedById: ctx.session.userId,
          },
        });
        await logEvent(tx, {
          facilityId: refund.facilityId,
          entityType: 'receipt',
          entityId: refund.receiptId,
          type: 'note',
          body: `Hoàn tiền ${refund.amount.toLocaleString('vi-VN')}đ: ${refund.reason}`,
          actorId: ctx.session.userId,
        });
        return refund;
      }),
    ),

  refundList: requirePermission('finance', 'refundList')
    .input(z.object({ receiptId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.refundRecord.findMany({
          where: { receiptId: input.receiptId },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  // Send an approved receipt to the payer by email. Recipient defaults to the resolved payer
  // (receipt.parentEmail for new-student receipts; guardian→parentAccount.email for renewals,
  // scoped to this receipt's facility so a cross-facility guardian link can't leak); an explicit
  // `to` override is available to the same approver roles and is audited as a note. The dedupKey
  // embeds a hash of the target address so a resend to a CORRECTED address always enqueues a
  // fresh row, while a same-address resend stays a no-op via enqueueEmail's existing dedup swallow.
  sendReceiptEmail: requirePermission('finance', 'sendReceiptEmail')
    .input(z.object({ receiptId: z.string().uuid(), to: z.string().email().optional() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({
          where: { id: input.receiptId },
          include: { student: { select: { fullName: true } } },
        });
        if (!(['approved', 'sent', 'reconciled'] as string[]).includes(receipt.status)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ gửi email cho phiếu đã duyệt' });
        }
        let to = input.to;
        if (!to) {
          if (receipt.parentEmail) {
            to = receipt.parentEmail;
          } else if (receipt.studentId) {
            const guardian = await tx.guardian.findFirst({
              where: {
                studentId: receipt.studentId,
                facilityId: receipt.facilityId,
                parent: { email: { not: null } },
              },
              select: { parent: { select: { email: true } } },
              orderBy: { createdAt: 'asc' },
            });
            to = guardian?.parent.email ?? undefined;
          }
        }
        if (!to) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Không tìm được email người nhận — nhập email thủ công',
          });
        }
        const facility = await tx.facility.findUniqueOrThrow({
          where: { id: receipt.facilityId },
          select: { name: true },
        });
        const targetHash = createHash('sha256')
          .update(to.trim().toLowerCase())
          .digest('hex')
          .slice(0, 16);
        // enqueueEmail is deliberately the LAST statement before the conditional logEvent: a
        // dedupKey collision (automatic resend to the same address, a true no-op) aborts the
        // underlying Postgres transaction even though the JS exception is caught inside
        // enqueueEmail — no further query may run in this tx once that happens, so logEvent
        // only fires when a row was actually inserted.
        const inserted = await enqueueEmail(tx, {
          facilityId: receipt.facilityId,
          dedupKey: `receipt:${receipt.id}:${targetHash}`,
          to,
          mailbox: 'notify',
          kind: 'receipt',
          data: {
            receiptCode: receipt.code ?? receipt.id.slice(0, 8),
            netAmount: receipt.netAmount,
            studentName: receipt.student?.fullName ?? receipt.studentName ?? 'học sinh',
            facilityName: facility.name,
            approvedAt: receipt.approvedAt ? receipt.approvedAt.toLocaleDateString('vi-VN') : '—',
          },
        });
        if (!inserted) return { to };
        await logEvent(tx, {
          facilityId: receipt.facilityId,
          entityType: 'receipt',
          entityId: receipt.id,
          type: 'note',
          body: `Gửi phiếu thu qua email tới ${to}`,
          actorId: ctx.session.userId,
        });
        return { to };
      }),
    ),

  // Revenue report grouped by month / facility / course — gross − refunds = net (P3).
  revenueReport: requirePermission('finance', 'revenueReport')
    .input(revenueReportInput)
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) => computeRevenueBuckets(tx, input)),
    ),

  // Same aggregation as revenueReport, serialized to CSV (BOM + gross/refunds/net/count columns,
  // formula-injection guarded). A single server-side string keeps VND/date formatting consistent
  // and avoids a client-side CSV dependency.
  revenueReportCsv: requirePermission('finance', 'revenueReport')
    .input(revenueReportInput)
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const buckets = await computeRevenueBuckets(tx, input);
        return { csv: buildRevenueCsv(buckets), rowCount: buckets.length };
      }),
    ),

  // "Chưa đối soát kỳ này": approved/sent (not yet reconciled, not cancelled) receipts in a
  // period, bucketed by the same approvedAt key as revenueReport. Reuses the EXISTING
  // receiptReconcile mutation per row — no new money mutation here.
  reconcileWorklist: requirePermission('finance', 'reconcileWorklist')
    .input(
      z
        .object({
          from: z.string().regex(dateOnly),
          to: z.string().regex(dateOnly),
          facilityId: z.number().int().positive().optional(),
        })
        .refine((d) => new Date(d.from) < new Date(d.to), {
          message: 'from phải trước to',
          path: ['to'],
        })
        .refine(
          (d) => new Date(d.to).getTime() - new Date(d.from).getTime() <= 1096 * 24 * 60 * 60 * 1000,
          { message: 'Khoảng thời gian tối đa 3 năm', path: ['to'] },
        ),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.receipt.findMany({
          where: {
            status: { in: ['approved', 'sent'] },
            approvedAt: { gte: new Date(input.from), lt: new Date(input.to) },
            ...(input.facilityId ? { facilityId: input.facilityId } : {}),
          },
          orderBy: { approvedAt: 'asc' },
          take: 500,
          select: {
            id: true,
            code: true,
            netAmount: true,
            facilityId: true,
            approvedAt: true,
            status: true,
          },
        }),
      ),
    ),
});
