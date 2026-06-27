import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Program, hashPassword } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission, superAdminProcedure } from '../trpc.js';

const program = z.nativeEnum(Program);

export const studentRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.student.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } }),
    ),
  ),

  // Aggregate detail: core fields + linked guardians, enrollments, receipts, final grades.
  // RLS enforced via withRls — a student from another facility returns NOT_FOUND.
  // Uses protectedProcedure (same gate as student.list) so any authenticated staff can view.
  detail: protectedProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          include: {
            guardians: {
              include: {
                parent: {
                  select: {
                    id: true,
                    displayName: true,
                    email: true,
                    phone: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
            enrollments: {
              where: { archivedAt: null },
              include: {
                batch: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    startDate: true,
                    endDate: true,
                    status: true,
                    course: {
                      select: { id: true, code: true, name: true, program: true },
                    },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
            receipts: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                code: true,
                grossAmount: true,
                netAmount: true,
                status: true,
                kind: true,
                createdAt: true,
                approvedAt: true,
                opportunity: {
                  select: { id: true, stage: true, createdAt: true },
                },
              },
            },
            finalGrades: {
              orderBy: { computedAt: 'desc' },
              select: {
                id: true,
                program: true,
                level: true,
                periodKey: true,
                finalScore: true,
                passed: true,
                complete: true,
                computedAt: true,
              },
            },
            // LMS access info: staff can see loginCode + active status; passwordHash is excluded.
            account: {
              select: {
                loginCode: true,
                isActive: true,
                createdAt: true,
              },
            },
          },
        }),
      ),
    ),

  // Break-glass / seed / migration path only. Normal student creation happens atomically at
  // receipt.approve (F1). This procedure is gated to super_admin so that no regular staff
  // UI path can create an orphan student outside the financial provisioning seam.
  create: superAdminProcedure
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        studentCode: z.string().min(1),
        fullName: z.string().min(1),
        program,
        dateOfBirth: z.string().date().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const student = await tx.student.create({
          data: {
            facilityId: input.facilityId,
            studentCode: input.studentCode,
            fullName: input.fullName,
            program: input.program,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
            lifecycle: 'admitted',
          },
        });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'student',
          entityId: student.id,
          type: 'created',
          body: 'Học sinh tạo thủ công (break-glass/seed — không qua phiếu thu)',
          actorId: ctx.session.userId,
        });
        return student;
      }),
    ),

  // Create-or-reset a student's LMS login. If the student has no account yet (created before
  // auto-provisioning, or matched via dedupe), one is created with loginCode = studentCode;
  // otherwise the password is regenerated and tokenVersion bumped (invalidates live LMS JWTs).
  // A new temp password is returned ONCE for staff to relay. Gate: quan_ly + both directors.
  resetLmsPassword: requirePermission('student', 'resetLmsPassword')
    .input(z.object({ studentId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Facility-scoped lookup FIRST: a student outside the caller's RLS scope is not visible,
        // so we never touch a credential the caller may not manage.
        const student = await tx.student.findUnique({
          where: { id: input.studentId },
          select: { studentCode: true, facilityId: true },
        });
        if (!student) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy học sinh' });
        }
        const existing = await tx.studentAccount.findUnique({
          where: { studentId: input.studentId },
          select: { id: true, tokenVersion: true },
        });
        const tempPassword = randomBytes(6).toString('hex');
        const passwordHash = await hashPassword(tempPassword);
        const acc = existing
          ? await tx.studentAccount.update({
              where: { id: existing.id },
              data: { passwordHash, tokenVersion: existing.tokenVersion + 1 },
              select: { loginCode: true },
            })
          : await tx.studentAccount.create({
              data: {
                studentId: input.studentId,
                loginCode: student.studentCode,
                passwordHash,
                isActive: true,
              },
              select: { loginCode: true },
            });
        await logEvent(tx, {
          facilityId: student.facilityId,
          entityType: 'student',
          entityId: input.studentId,
          type: 'updated',
          body: existing ? 'Đặt lại mật khẩu LMS' : 'Tạo tài khoản LMS',
          actorId: ctx.session.userId,
        });
        // tempPassword is returned once and never stored — caller must relay it to the parent.
        return { loginCode: acc.loginCode, tempPassword };
      }),
    ),

  // Correct a student's name or date of birth after creation.
  // Program changes happen via enrollment; lifecycle changes happen via explicit lifecycle
  // actions (afterSale.setStudentLifecycle). Only data-correction fields are editable here.
  update: requirePermission('student', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        fullName: z.string().min(1).optional(),
        dateOfBirth: z.string().date().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.student.findUniqueOrThrow({ where: { id: input.id } });
        const student = await tx.student.update({
          where: { id: input.id },
          data: {
            fullName: input.fullName ?? undefined,
            dateOfBirth:
              input.dateOfBirth === undefined ? undefined : input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          },
        });
        const changed: string[] = [];
        if (input.fullName !== undefined && input.fullName !== before.fullName) {
          changed.push(`tên: "${before.fullName}" → "${student.fullName}"`);
        }
        if (input.dateOfBirth !== undefined) {
          const dobBefore = before.dateOfBirth ? before.dateOfBirth.toISOString().slice(0, 10) : null;
          if (input.dateOfBirth !== dobBefore) {
            changed.push(`ngày sinh: ${dobBefore ?? '(chưa có)'} → ${input.dateOfBirth ?? '(xoá)'}`);
          }
        }
        await logEvent(tx, {
          facilityId: before.facilityId,
          entityType: 'student',
          entityId: student.id,
          type: 'updated',
          body: changed.length > 0
            ? `Sửa hồ sơ HS: ${changed.join('; ')}`
            : `Sửa hồ sơ HS ${student.fullName} (không thay đổi)`,
          actorId: ctx.session.userId,
        });
        return student;
      }),
    ),
});
