import { z } from 'zod';
import { withRls, Program } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';

const program = z.nativeEnum(Program);

export const studentRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.student.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } }),
    ),
  ),

  create: requireRole(Role.quan_ly, Role.sale)
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
});
