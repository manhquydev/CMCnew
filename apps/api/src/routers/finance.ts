import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, type Program } from '@cmc/db';
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
import { classifyCancelRollback } from '../services/student-provisioning.js';
import { router, requirePermission } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';
import { enqueueEmail } from '../services/email-outbox.js';

/** Generate a random 12-char hex temp password. Never stored plaintext — caller bcrypt-hashes it. */
function genTempPassword(): string {
  return randomBytes(6).toString('hex');
}

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
      z.object({
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
      }).refine(
        (d) => d.studentId || (d.parentPhone && d.studentName),
        { message: 'Cung cấp studentId (học sinh có sẵn) hoặc parentPhone + studentName (học sinh mới)' },
      ),
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
        // Notify ke_toan of this facility that a receipt is pending approval.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: input.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const keToanIds = facilityUsers
          .filter((uf) => uf.user.roles.includes('ke_toan'))
          .map((uf) => uf.userId);
        const pushNotifs = await emitStaffNotif(tx, {
          recipientIds: keToanIds,
          event: 'receipt_pending_approval',
          title: 'Phiếu thu chờ duyệt',
          body: `Phiếu thu ${receipt.netAmount.toLocaleString('vi-VN')}đ vừa được tạo, chờ kế toán duyệt`,
          data: { receiptId: receipt.id, netAmount: receipt.netAmount },
          facilityId: input.facilityId,
        });
        return { receipt, pushNotifs };
      }).then(({ pushNotifs, receipt }) => { pushNotifs(); return receipt; }),
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
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const receipt = await tx.receipt.findUniqueOrThrow({
          where: { id: input.id },
          include: {
            course: { select: { program: true } },
          },
        });
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

        // Allocate receipt code first — used to derive studentCode for new students.
        const code = await nextReceiptCode(tx, receipt.facilityId, new Date().getFullYear());

        // Claim the draft atomically before provisioning — prevents concurrent double-approve from
        // duplicating the student. The no-voucher path has no row-level lock prior to this point;
        // a second concurrent approve that passes the early status check above will find count=0
        // here and must abort. Because this is inside the same withRls transaction, any earlier
        // work (voucher consume, code allocation) is rolled back on throw.
        const claimed = await tx.receipt.updateMany({
          where: { id: input.id, status: 'draft' },
          data: { status: 'approved', code, approvedById: ctx.session.userId, approvedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu thu đã được duyệt bởi yêu cầu đồng thời' });
        }

        // ── Student provisioning ────────────────────────────────────────────────────
        let resolvedStudentId: string;
        let wasNewStudent = false;

        if (receipt.studentId) {
          // Existing student (renewal or explicit-link path): use the id already on the receipt.
          resolvedStudentId = receipt.studentId;
          // If parent info was also supplied, ensure guardian link exists (idempotent upsert).
          if (receipt.parentPhone) {
            const parentAcc = await tx.parentAccount.findFirst({ where: { phone: receipt.parentPhone } });
            if (parentAcc) {
              await tx.guardian.upsert({
                where: { parentAccountId_studentId: { parentAccountId: parentAcc.id, studentId: resolvedStudentId } },
                create: { facilityId: receipt.facilityId, parentAccountId: parentAcc.id, studentId: resolvedStudentId },
                update: {},
              });
            }
          }
        } else {
          // New-student path: dedupe by parent phone, then find-or-create.
          if (!receipt.parentPhone || !receipt.studentName) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Phiếu không có studentId hoặc parentPhone+studentName — không thể tạo học sinh',
            });
          }
          const program = receipt.course.program as Program;

          // Find or create the ParentAccount by phone.
          let parentAcc = await tx.parentAccount.findFirst({ where: { phone: receipt.parentPhone } });
          if (!parentAcc) {
            parentAcc = await tx.parentAccount.create({
              data: {
                phone: receipt.parentPhone,
                displayName: receipt.parentName ?? receipt.parentPhone,
                // Capture email if provided — enables OTP passwordless login for the parent.
                email: receipt.parentEmail ?? null,
                isActive: true,
              },
            });
            await logEvent(tx, {
              facilityId: receipt.facilityId,
              entityType: 'parent_account',
              entityId: parentAcc.id,
              type: 'created',
              body: `Tài khoản phụ huynh tạo tự động khi duyệt phiếu ${code}`,
              actorId: ctx.session.userId,
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
              (g) => g.student.fullName.trim().toLowerCase() === receipt.studentName!.trim().toLowerCase(),
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
          if (receipt.parentEmail && parentAcc.email !== receipt.parentEmail) {
            try {
              await tx.parentAccount.update({
                where: { id: parentAcc.id },
                data: { email: receipt.parentEmail },
              });
            } catch {
              // Unique violation: another account already owns that email — log and continue.
              await logEvent(tx, {
                facilityId: receipt.facilityId,
                entityType: 'parent_account',
                entityId: parentAcc.id,
                type: 'note',
                body: `parentEmail ${receipt.parentEmail} dari phiếu ${code} đã thuộc tài khoản khác — bỏ qua`,
                actorId: ctx.session.userId,
              });
            }
          }

          // Ensure Guardian link (idempotent).
          await tx.guardian.upsert({
            where: { parentAccountId_studentId: { parentAccountId: parentAcc.id, studentId: resolvedStudentId } },
            create: { facilityId: receipt.facilityId, parentAccountId: parentAcc.id, studentId: resolvedStudentId },
            update: {},
          });
        }

        // Activate student lifecycle (idempotent: only log the transition when it actually changes).
        const student = await tx.student.findUniqueOrThrow({
          where: { id: resolvedStudentId },
          select: { lifecycle: true, fullName: true, studentCode: true },
        });
        if (student.lifecycle !== 'active') {
          await tx.student.update({ where: { id: resolvedStudentId }, data: { lifecycle: 'active' } });
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
        if (receipt.classBatchId) {
          // Guard: the batch's course must match the receipt's course.
          // Enrolling a student into an unrelated batch corrupts attendance records and
          // mis-attributes commission to the wrong course.
          const batchForCourseCheck = await tx.classBatch.findUniqueOrThrow({
            where: { id: receipt.classBatchId },
            select: { courseId: true },
          });
          if (batchForCourseCheck.courseId !== receipt.courseId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Lớp học không thuộc khóa học trong phiếu thu (batch.courseId ≠ receipt.courseId)',
            });
          }

          const existing = await tx.enrollment.findFirst({
            where: { classBatchId: receipt.classBatchId, studentId: resolvedStudentId, archivedAt: null },
            select: { id: true },
          });
          if (!existing) {
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
          const tempPassword = genTempPassword();
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

          // Notify parent via email when parentEmail is available.
          // enqueueEmail is atomic with this txn (no-op if Graph absent).
          if (receipt.parentEmail && lmsAccount) {
            const parentName = receipt.parentName ?? undefined;
            await enqueueEmail(tx, {
              facilityId: receipt.facilityId,
              dedupKey: `lms_account_ready:${resolvedStudentId}`,
              to: receipt.parentEmail,
              mailbox: 'notify',
              kind: 'lms_account_ready',
              data: {
                parentName,
                studentName: student.fullName,
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
              select: { ownerId: true, stage: true, studentName: true },
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
          const receiptStudentName = (student?.fullName ?? receipt.studentName ?? '').trim().toLowerCase();
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
        const priorCollected = await tx.receipt.count({
          where: { studentId: resolvedStudentId, id: { not: receipt.id }, status: { in: ['approved', 'sent', 'reconciled'] } },
        });
        const kind = attributedOpp?.stage === 'O5_ENROLLED' ? 'new' : priorCollected > 0 ? 'renewal' : 'new';

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
        return { ...approved, lmsAccount };
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
        const wasApproved = receipt.status === 'approved' || receipt.status === 'sent' || receipt.status === 'reconciled';

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

        // ── Student/enrollment rollback (only when receipt was previously approved) ──────
        if (wasApproved && receipt.studentId) {
          // Fetch the enrollments created by this receipt (provenance-scoped).
          const provEnrollments = await tx.enrollment.findMany({
            where: { createdByReceiptId: receipt.id, archivedAt: null },
            select: { id: true, classBatchId: true, status: true },
          });

          // Count attendance on those specific enrollments only.
          const attendanceCount = provEnrollments.length > 0
            ? await tx.attendance.count({ where: { enrollmentId: { in: provEnrollments.map((e) => e.id) } } })
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
});
