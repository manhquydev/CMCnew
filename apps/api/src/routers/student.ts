import { z } from 'zod';
import { withRls, Program } from '@cmc/db';
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
