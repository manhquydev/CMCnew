import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent, logStatusChange } from '@cmc/audit';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';

export const enrollmentRouter = router({
  listByBatch: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.enrollment.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { student: { select: { studentCode: true, fullName: true, program: true } } },
        }),
      ),
    ),

  enroll: requireRole(Role.quan_ly, Role.sale)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classBatchId: z.string().uuid(),
        studentId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const batch = await tx.classBatch.findUniqueOrThrow({ where: { id: input.classBatchId } });
        const activeCount = await tx.enrollment.count({
          where: { classBatchId: input.classBatchId, status: 'active', archivedAt: null },
        });
        const enrollment = await tx.enrollment.create({
          data: {
            facilityId: input.facilityId,
            classBatchId: input.classBatchId,
            studentId: input.studentId,
            status: 'active',
          },
        });
        // HS có enrollment → chuyển lifecycle sang active.
        await tx.student.update({ where: { id: input.studentId }, data: { lifecycle: 'active' } });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'enrollment',
          entityId: enrollment.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        // Capacity = cảnh báo mềm (không chặn).
        const overCapacity = batch.capacity != null && activeCount + 1 > batch.capacity;
        return { enrollment, overCapacity, capacity: batch.capacity, enrolledCount: activeCount + 1 };
      }),
    ),

  // Hoàn tất thủ công (khi đóng lớp).
  complete: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.enrollment.findUniqueOrThrow({ where: { id: input.id } });
        const enrollment = await tx.enrollment.update({
          where: { id: input.id },
          data: { status: 'completed' },
        });
        await logStatusChange(
          tx,
          {
            facilityId: enrollment.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            actorId: ctx.session.userId,
          },
          'status',
          before.status,
          'completed',
        );
        return enrollment;
      }),
    ),
});
