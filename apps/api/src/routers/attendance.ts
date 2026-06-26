import { z } from 'zod';
import { withRls, AttendanceStatus } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';

export const attendanceRouter = router({
  listBySession: protectedProcedure
    .input(z.object({ classSessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.attendance.findMany({ where: { classSessionId: input.classSessionId } }),
      ),
    ),

  // Giáo viên/quản lý chấm điểm danh (upsert, idempotent).
  mark: requirePermission('attendance', 'mark')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classSessionId: z.string().uuid(),
        enrollmentId: z.string().uuid(),
        status: z.nativeEnum(AttendanceStatus),
        excused: z.boolean().default(false),
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const now = new Date();
        const attendance = await tx.attendance.upsert({
          where: {
            classSessionId_enrollmentId: {
              classSessionId: input.classSessionId,
              enrollmentId: input.enrollmentId,
            },
          },
          update: {
            status: input.status,
            excused: input.excused,
            note: input.note,
            markedById: ctx.session.userId,
            markedAt: now,
          },
          create: {
            facilityId: input.facilityId,
            classSessionId: input.classSessionId,
            enrollmentId: input.enrollmentId,
            status: input.status,
            excused: input.excused,
            note: input.note,
            markedById: ctx.session.userId,
            markedAt: now,
          },
        });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'class_session',
          entityId: input.classSessionId,
          type: 'updated',
          body: `Điểm danh: ${input.status}${input.excused ? ' (có phép)' : ''}`,
          actorId: ctx.session.userId,
        });
        return attendance;
      }),
    ),
});
