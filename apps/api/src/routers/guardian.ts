import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, hashPassword, GuardianRelation, Prisma, type RlsContext } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf, DEFAULT_STUDENT_PASSWORD } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, requirePermission, parentProcedure } from '../trpc.js';
import { throttle } from '../rate-limit.js';

// System-context read used only for request-time candidate resolution (requestLink) — a parent's
// own RLS context cannot see students outside its own guardianed children, but resolving a match
// requires searching across all students. This mirrors the identity-resolution pattern in
// packages/auth/src/lms.ts (SYSTEM_RLS) — read-only, never used to write.
const SYSTEM_CTX: RlsContext = { facilityIds: [], isSuperAdmin: true };

const LINK_REQUEST_LIMIT = Number(process.env.LINK_REQUEST_RATE_LIMIT ?? 5);

// Parent/student accounts are SYSTEM-WIDE identities (no facility_id) — facilities are linked
// branches, not silos (docs/specs/facility-model-decision.md). Leadership (the two directors, super)
// manages them at the system level; RLS now allows any staff to read these identity rows, while
// linking a guardian to a student still respects that student's facility (operational scoping).
export const guardianRouter = router({
  parentList: requirePermission('guardian', 'parentList').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.parentAccount.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, email: true, phone: true, displayName: true, isActive: true, createdAt: true },
      }),
    ),
  ),

  parentCreate: requirePermission('guardian', 'parentCreate')
    .input(
      z
        .object({
          displayName: z.string().min(1),
          email: z.string().email().optional(),
          phone: z.string().min(6).optional(),
          // Optional: parents log in passwordless via Email OTP. A password may still be set for
          // legacy/phone-only accounts that cannot receive an OTP email.
          password: z.string().min(6).optional(),
        })
        .refine((v) => v.email || v.phone, { message: 'Cần email hoặc số điện thoại' }),
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      // Normalize email so OTP login (which looks up by lower-cased email) always matches, and so the
      // unique constraint is effectively case-insensitive.
      const email = input.email?.trim().toLowerCase();
      return withRls(rlsContextOf(ctx.session), async (tx) => {
        const created = await tx.parentAccount.create({
          data: {
            displayName: input.displayName,
            email,
            phone: input.phone,
            passwordHash,
          },
          select: { id: true, email: true, phone: true, displayName: true },
        });
        // parent_account là identity system-wide (không facilityId) → audit facilityId=null.
        await logEvent(tx, {
          facilityId: null,
          entityType: 'parent_account',
          entityId: created.id,
          type: 'created',
          body: `Tạo tài khoản phụ huynh ${created.displayName}`,
          actorId: ctx.session.userId,
        });
        return created;
      });
    }),

  parentUpdate: requirePermission('guardian', 'parentUpdate')
    .input(
      z
        .object({
          id: z.string().uuid(),
          displayName: z.string().min(1).optional(),
          email: z.string().email().optional(),
          phone: z.string().min(6).optional(),
        })
        .refine((v) => v.displayName !== undefined || v.email !== undefined || v.phone !== undefined, {
          message: 'Không có trường nào để cập nhật',
        }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.parentAccount.findUnique({
          where: { id: input.id },
          select: { id: true, displayName: true, email: true, phone: true },
        });
        if (!before) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản phụ huynh' });
        }
        const email = input.email?.trim().toLowerCase();
        const data: Prisma.ParentAccountUpdateInput = {};
        if (input.displayName !== undefined) data.displayName = input.displayName;
        if (input.email !== undefined) data.email = email;
        if (input.phone !== undefined) data.phone = input.phone;
        const updated = await tx.parentAccount.update({
          where: { id: input.id },
          data,
          select: { id: true, email: true, phone: true, displayName: true },
        });
        await logEvent(tx, {
          facilityId: null,
          entityType: 'parent_account',
          entityId: updated.id,
          type: 'updated',
          body: `Cập nhật phụ huynh ${updated.displayName}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  // Guardians of a student, with the parent's identity.
  listForStudent: requirePermission('guardian', 'listForStudent')
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.guardian.findMany({
          where: { studentId: input.studentId },
          include: { parent: { select: { id: true, displayName: true, email: true, phone: true } } },
        }),
      ),
    ),

  // Link a parent to a student (facility inherited from the student). Idempotent on the unique.
  link: requirePermission('guardian', 'link')
    .input(
      z.object({
        parentAccountId: z.string().uuid(),
        studentId: z.string().uuid(),
        relation: z.nativeEnum(GuardianRelation).default(GuardianRelation.guardian),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.findUniqueOrThrow({ where: { id: input.studentId } });
        const guardian = await tx.guardian.upsert({
          where: { parentAccountId_studentId: { parentAccountId: input.parentAccountId, studentId: input.studentId } },
          update: { relation: input.relation },
          create: {
            facilityId: student.facilityId,
            parentAccountId: input.parentAccountId,
            studentId: input.studentId,
            relation: input.relation,
          },
        });
        await logEvent(tx, {
          facilityId: guardian.facilityId,
          entityType: 'guardian',
          entityId: guardian.id,
          type: 'created',
          body: `Liên kết phụ huynh ↔ ${student.fullName} (${input.relation})`,
          actorId: ctx.session.userId,
        });
        return guardian;
      }),
    ),

  unlink: requirePermission('guardian', 'unlink')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const g = await tx.guardian.findUniqueOrThrow({ where: { id: input.id } });
        await tx.guardian.delete({ where: { id: input.id } });
        await logEvent(tx, {
          facilityId: g.facilityId,
          entityType: 'guardian',
          entityId: g.id,
          type: 'archived',
          body: 'Gỡ liên kết phụ huynh',
          actorId: ctx.session.userId,
        });
        return { ok: true };
      }),
    ),

  // ── Parent self-service (anti-takeover: parent can never write `guardian` directly) ─────────

  // Parent edits their own ParentAccount row only — RLS additionally pins id = accountId.
  profileUpdate: parentProcedure
    .input(
      z.object({
        displayName: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().min(6).optional(),
        emailNotifications: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.ParentAccountUpdateInput = {};
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.email !== undefined) data.email = input.email.trim().toLowerCase();
      if (input.phone !== undefined) data.phone = input.phone.trim();
      if (input.emailNotifications !== undefined) data.emailNotifications = input.emailNotifications;
      try {
        return await withRls(lmsRlsContextOf(ctx.lms), (tx) =>
          tx.parentAccount.update({
            where: { id: ctx.lms.accountId },
            data,
            select: { id: true, displayName: true, email: true, phone: true, emailNotifications: true },
          }),
        );
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Email hoặc số điện thoại đã được sử dụng' });
        }
        throw err;
      }
    }),

  // Self-link REQUEST only — never creates a Guardian row. facilityId/matchedStudentId are
  // resolved here, at request time, under a system-context read (best-effort; ambiguous ⇒ null).
  // Rate-limited per account AND per IP (mirrors the OTP pattern) so an authenticated parent
  // cannot spam the staff review queue. Response is always the same generic shape — no
  // match/no-match oracle for an attacker probing phone numbers.
  requestLink: parentProcedure
    .input(
      z
        .object({
          studentPhone: z.string().min(6).optional(),
          studentCode: z.string().min(1).optional(),
        })
        .refine((v) => v.studentPhone || v.studentCode, { message: 'Cần số điện thoại hoặc mã học sinh' }),
    )
    .mutation(async ({ ctx, input }) => {
      throttle(`linkreq:acct:${ctx.lms.accountId}`, LINK_REQUEST_LIMIT);
      throttle(`linkreq:ip:${ctx.ip}`, LINK_REQUEST_LIMIT);

      const candidates = await withRls(SYSTEM_CTX, (tx) =>
        input.studentCode
          ? tx.student.findMany({
              where: { studentCode: input.studentCode },
              select: { id: true, facilityId: true },
            })
          : tx.student.findMany({
              where: { guardians: { some: { parent: { phone: input.studentPhone } } } },
              select: { id: true, facilityId: true },
            }),
      );
      const unique = candidates.length === 1 ? candidates[0] : null;

      await withRls(lmsRlsContextOf(ctx.lms), (tx) =>
        tx.guardianLinkRequest.create({
          data: {
            requestedByAccountId: ctx.lms.accountId,
            studentPhone: input.studentPhone,
            studentCode: input.studentCode,
            matchedStudentId: unique?.id,
            facilityId: unique?.facilityId,
          },
        }),
      );

      return { ok: true as const };
    }),

  // Parent's own request history — RLS additionally pins requestedByAccountId = accountId.
  linkRequestListMine: parentProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.guardianLinkRequest.findMany({
        where: { requestedByAccountId: ctx.lms.accountId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, studentPhone: true, studentCode: true, status: true, reason: true, createdAt: true },
      }),
    ),
  ),

  // ── Family login credential (decision 0033) ──────────────────────────────────────────────

  // Parent self-service: no old password required — the caller IS the family credential
  // (authenticated parent session). Own account only (id from session, never client input).
  // Bumps tokenVersion → revokes any live family/parent (email-OTP) session immediately.
  changeFamilyPassword: parentProcedure
    .input(z.object({ newPassword: z.string().min(6) }))
    .mutation(async ({ ctx, input }) => {
      throttle(`familypwchange:${ctx.lms.accountId}`, LINK_REQUEST_LIMIT);
      const passwordHash = await hashPassword(input.newPassword);
      await withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        await tx.parentAccount.update({
          where: { id: ctx.lms.accountId },
          data: { passwordHash, tokenVersion: { increment: 1 } },
        });
        await logEvent(tx, {
          facilityId: null,
          entityType: 'parent_account',
          entityId: ctx.lms.accountId,
          type: 'updated',
          body: 'Đổi mật khẩu đăng nhập gia đình (tự phục vụ)',
          actorId: ctx.lms.accountId,
        });
      });
      return { ok: true as const };
    }),

  // ERP staff reset: force back to the fixed default, confirm-only (mirrors
  // student.resetLmsPassword's gate — both directors). No cascade to child StudentAccount
  // sessions (decision 0033 D6 — accepted, student session security is de-scoped); bumping
  // tokenVersion here DOES evict any live family/parent (email-OTP) session immediately.
  resetFamilyPassword: requirePermission('guardian', 'resetFamilyPassword')
    .input(z.object({ parentAccountId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const acc = await tx.parentAccount.findUnique({
          where: { id: input.parentAccountId },
          select: { id: true },
        });
        if (!acc) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản phụ huynh' });
        }
        const passwordHash = await hashPassword(DEFAULT_STUDENT_PASSWORD);
        await tx.parentAccount.update({
          where: { id: input.parentAccountId },
          data: { passwordHash, tokenVersion: { increment: 1 } },
        });
        await logEvent(tx, {
          facilityId: null,
          entityType: 'parent_account',
          entityId: input.parentAccountId,
          type: 'updated',
          body: 'Đặt lại mật khẩu đăng nhập gia đình về mặc định',
          actorId: ctx.session.userId,
        });
        return { ok: true as const };
      }),
    ),

  // ── Staff review queue ────────────────────────────────────────────────────────────────────

  // Pending queue: facility-scoped resolved rows + the director-global unresolved bucket (RLS
  // grants any staff read access to facility_id IS NULL rows; the permission grant above narrows
  // who can actually call this procedure to the two directors). Ambiguous rows (no matchedStudentId)
  // are annotated with candidate students so staff can pick one explicitly at review.
  linkRequestList: requirePermission('guardian', 'linkRequestList').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), async (tx) => {
      const rows = await tx.guardianLinkRequest.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { requestedBy: { select: { id: true, displayName: true, email: true, phone: true } } },
      });
      return Promise.all(
        rows.map(async (r) => {
          if (r.matchedStudentId) return { ...r, candidates: [] };
          const candidates = r.studentCode
            ? await tx.student.findMany({
                where: { studentCode: r.studentCode },
                select: { id: true, fullName: true, studentCode: true, facilityId: true },
              })
            : r.studentPhone
              ? await tx.student.findMany({
                  where: { guardians: { some: { parent: { phone: r.studentPhone } } } },
                  select: { id: true, fullName: true, studentCode: true, facilityId: true },
                })
              : [];
          return { ...r, candidates };
        }),
      );
    }),
  ),

  // Approve creates exactly one Guardian (reusing `link`'s upsert logic) and closes the request;
  // reject just closes it. `studentId` is required only when the request is ambiguous
  // (matchedStudentId null) — staff explicitly picks from `linkRequestList`'s candidates.
  linkRequestReview: requirePermission('guardian', 'linkRequestReview')
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['approved', 'rejected']),
        studentId: z.string().uuid().optional(),
        relation: z.nativeEnum(GuardianRelation).default(GuardianRelation.guardian),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const reqRow = await tx.guardianLinkRequest.findUniqueOrThrow({ where: { id: input.id } });
        if (reqRow.status !== 'pending') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Yêu cầu đã được xử lý' });
        }

        if (input.decision === 'rejected') {
          const updated = await tx.guardianLinkRequest.update({
            where: { id: input.id },
            data: {
              status: 'rejected',
              reviewedById: ctx.session.userId,
              reviewedAt: new Date(),
              reason: input.reason,
            },
          });
          return { ok: true as const, guardianId: null, request: updated };
        }

        const studentId = reqRow.matchedStudentId ?? input.studentId;
        if (!studentId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cần chọn học sinh để duyệt yêu cầu này' });
        }
        const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
        const guardian = await tx.guardian.upsert({
          where: { parentAccountId_studentId: { parentAccountId: reqRow.requestedByAccountId, studentId } },
          update: { relation: input.relation },
          create: {
            facilityId: student.facilityId,
            parentAccountId: reqRow.requestedByAccountId,
            studentId,
            relation: input.relation,
          },
        });
        const updated = await tx.guardianLinkRequest.update({
          where: { id: input.id },
          data: {
            status: 'approved',
            reviewedById: ctx.session.userId,
            reviewedAt: new Date(),
            reason: input.reason,
          },
        });
        await logEvent(tx, {
          facilityId: guardian.facilityId,
          entityType: 'guardian',
          entityId: guardian.id,
          type: 'created',
          body: `Duyệt yêu cầu tự liên kết phụ huynh ↔ ${student.fullName} (${input.relation})`,
          actorId: ctx.session.userId,
        });
        return { ok: true as const, guardianId: guardian.id, request: updated };
      }),
    ),
});
