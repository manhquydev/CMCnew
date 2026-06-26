import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent, logStatusChange } from '@cmc/audit';
import { router, protectedProcedure, requirePermission, lmsProcedure } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

export const enrollmentRouter = router({
  /**
   * Student/parent view: returns all non-archived enrollments the LMS principal owns.
   *
   * Security: uses lmsProcedure (requires LMS session, no SYSTEM bypass) and
   * withRls(lmsRlsContextOf(ctx.lms)) which sets app.principal_kind + app.student_ids.
   * The enrollment_isolation RLS policy then filters `student_id = ANY(app.student_ids)`,
   * so this query is always scoped to the caller's own students — no cross-facility leak.
   */
  mine: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.enrollment.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          // Prisma relation field is named 'batch' (the FK column is class_batch_id).
          batch: {
            select: {
              code: true,
              name: true,
              course: { select: { code: true, name: true, program: true } },
            },
          },
        },
      }),
    ),
  ),

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

  enroll: requirePermission('enrollment', 'enroll')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classBatchId: z.string().uuid(),
        studentId: z.string().uuid(),
        // CRM seam: when the enrollment closes an opportunity (O5 won), record the link.
        opportunityId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const batch = await tx.classBatch.findUniqueOrThrow({ where: { id: input.classBatchId } });
        // Friendly guard before the DB unique([classBatchId, studentId]) fires a raw P2002 (→ 500).
        // A frontend double-submit or re-enroll of an active student returns a clean CONFLICT instead.
        const dup = await tx.enrollment.findFirst({
          where: { classBatchId: input.classBatchId, studentId: input.studentId, archivedAt: null },
          select: { id: true },
        });
        if (dup) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã được ghi danh vào lớp này' });
        }
        const activeCount = await tx.enrollment.count({
          where: { classBatchId: input.classBatchId, status: 'active', archivedAt: null },
        });
        const enrollment = await tx.enrollment.create({
          data: {
            facilityId: input.facilityId,
            classBatchId: input.classBatchId,
            studentId: input.studentId,
            status: 'active',
            opportunityId: input.opportunityId,
          },
        });
        // HS có enrollment → chuyển lifecycle sang active (chỉ khi chưa active; log transition).
        const student = await tx.student.findUniqueOrThrow({
          where: { id: input.studentId },
          select: { fullName: true, studentCode: true, lifecycle: true },
        });
        if (student.lifecycle !== 'active') {
          await tx.student.update({ where: { id: input.studentId }, data: { lifecycle: 'active' } });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'student',
            entityId: input.studentId,
            type: 'status_changed',
            body: `Lifecycle: ${student.lifecycle}→active (ghi danh)`,
            changes: [{ field: 'lifecycle', old: student.lifecycle, new: 'active' }],
            actorId: ctx.session.userId,
          });
        }
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'enrollment',
          entityId: enrollment.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        // Notify quan_ly + head_teacher of this facility about the new enrollment.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: input.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const notifyIds = facilityUsers
          .filter((uf) => uf.user.roles.includes('quan_ly') || uf.user.roles.includes('head_teacher'))
          .map((uf) => uf.userId);
        const pushNotifs = await emitStaffNotif(tx, {
          recipientIds: notifyIds,
          event: 'enrollment_new',
          title: 'Ghi danh mới',
          body: `HS ${student?.fullName ?? input.studentId} (${student?.studentCode ?? ''}) vừa được ghi danh vào lớp ${batch.code}`,
          data: { enrollmentId: enrollment.id, classBatchId: input.classBatchId, studentId: input.studentId },
          facilityId: input.facilityId,
        });
        // Capacity = cảnh báo mềm (không chặn).
        const overCapacity = batch.capacity != null && activeCount + 1 > batch.capacity;
        return { enrollment, overCapacity, capacity: batch.capacity, enrolledCount: activeCount + 1, pushNotifs };
      }).then(({ pushNotifs, ...result }) => { pushNotifs(); return result; }),
    ),

  // Hoàn tất thủ công (khi đóng lớp).
  complete: requirePermission('enrollment', 'complete')
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
