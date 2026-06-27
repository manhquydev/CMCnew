import { z } from 'zod';
import { TRPCError } from '@trpc/server';
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
        // facilityId kept for API backward-compat but ignored — derived server-side from the session.
        facilityId: z.number().int().positive().optional(),
        classSessionId: z.string().uuid(),
        enrollmentId: z.string().uuid(),
        status: z.nativeEnum(AttendanceStatus),
        excused: z.boolean().default(false),
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Validate that the enrollment and session belong to the same class batch.
        // A mismatched (enrollment, session) pair silently corrupts attendance rates
        // used by computeFinalGrade — reject it before any write.
        // facilityId is derived from the session record, not from the client, to prevent
        // a caller from injecting a foreign facilityId and writing cross-tenant rows.
        const [session, enrollment] = await Promise.all([
          tx.classSession.findUniqueOrThrow({
            where: { id: input.classSessionId },
            select: { classBatchId: true, facilityId: true, status: true },
          }),
          tx.enrollment.findUniqueOrThrow({
            where: { id: input.enrollmentId },
            select: { classBatchId: true, status: true },
          }),
        ]);
        if (enrollment.classBatchId !== session.classBatchId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Học sinh không thuộc lớp học của buổi học này',
          });
        }
        // A cancelled session has no real class — marking it would inflate/deflate the attendance rate
        // that computeFinalGrade derives.
        if (session.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Buổi học đã hủy — không thể điểm danh' });
        }
        // A student who has left the class (withdrawn/transferred) must not receive new attendance marks.
        // active / completed / reserved stay markable (final-session and trial attendance are valid).
        if (enrollment.status === 'withdrawn' || enrollment.status === 'transferred') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh đã rời lớp — không thể điểm danh' });
        }
        const facilityId = session.facilityId;
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
            facilityId,
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
          facilityId,
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
