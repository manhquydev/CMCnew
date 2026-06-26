import { z } from 'zod';
import { withRls, Program, StudentLifecycle } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';

const program = z.nativeEnum(Program);
const lifecycle = z.nativeEnum(StudentLifecycle);

export const studentRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.student.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } }),
    ),
  ),

  create: requirePermission('student', 'create')
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
          actorId: ctx.session.userId,
        });
        return student;
      }),
    ),

  // Correct a student's profile after creation (name, DOB, program, lifecycle). Without this,
  // fixes required raw DB access. RLS keeps the update inside the caller's facility scope.
  update: requirePermission('student', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        fullName: z.string().min(1).optional(),
        program: program.optional(),
        dateOfBirth: z.string().date().nullable().optional(),
        lifecycle: lifecycle.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.student.findUniqueOrThrow({ where: { id: input.id } });
        const student = await tx.student.update({
          where: { id: input.id },
          data: {
            fullName: input.fullName ?? undefined,
            program: input.program ?? undefined,
            dateOfBirth:
              input.dateOfBirth === undefined ? undefined : input.dateOfBirth ? new Date(input.dateOfBirth) : null,
            lifecycle: input.lifecycle ?? undefined,
          },
        });
        await logEvent(tx, {
          facilityId: before.facilityId,
          entityType: 'student',
          entityId: student.id,
          type: 'updated',
          body: `Cập nhật hồ sơ HS ${student.fullName}`,
          actorId: ctx.session.userId,
        });
        return student;
      }),
    ),
});
