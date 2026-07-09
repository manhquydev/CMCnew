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
        // The unique key has no status/archivedAt component (schema.prisma:396), so a prior
        // withdrawn/transferred/completed row (archivedAt still null) also hits this guard —
        // reactivate it instead of blocking with a misleading "already enrolled" CONFLICT.
        // Only an already-active/reserved row is a genuine duplicate.
        const dup = await tx.enrollment.findFirst({
          where: { classBatchId: input.classBatchId, studentId: input.studentId, archivedAt: null },
          select: { id: true, status: true },
        });
        if (dup && (dup.status === 'active' || dup.status === 'reserved')) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã được ghi danh vào lớp này' });
        }
        const activeCount = await tx.enrollment.count({
          where: { classBatchId: input.classBatchId, status: 'active', archivedAt: null },
        });
        let enrollment;
        if (dup) {
          enrollment = await tx.enrollment.update({
            where: { id: dup.id },
            data: { status: 'active', opportunityId: input.opportunityId ?? undefined },
          });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            type: 'status_changed',
            body: `Kích hoạt lại ghi danh vào lớp ${batch.code} (trạng thái trước: ${dup.status})`,
            changes: [{ field: 'status', old: dup.status, new: 'active' }],
            actorId: ctx.session.userId,
          });
        } else {
          enrollment = await tx.enrollment.create({
            data: {
              facilityId: input.facilityId,
              classBatchId: input.classBatchId,
              studentId: input.studentId,
              status: 'active',
              opportunityId: input.opportunityId,
            },
          });
          await logEvent(tx, {
            facilityId: input.facilityId,
            entityType: 'enrollment',
            entityId: enrollment.id,
            type: 'created',
            actorId: ctx.session.userId,
          });
        }
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
        // Notify both directors of this facility about the new enrollment.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: input.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const notifyIds = facilityUsers
          .filter((uf) => uf.user.roles.includes('giam_doc_kinh_doanh') || uf.user.roles.includes('giam_doc_dao_tao'))
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

  // Chuyển lớp (history-preserving): flip old enrollment → transferred, create a new active
  // enrollment in the target batch for the same student. Attendance/FinalGrade on the old
  // enrollment are left untouched — FinalGrade is student-keyed (not enrollment-keyed), so it
  // blends old+new class attendance automatically within the term (intentional, see plan).
  // Old-class exercise access is cut immediately once the old enrollment leaves 'active'
  // (exercise-open.ts scopes status:'active') — accepted trade-off, not a bug.
  transfer: requirePermission('enrollment', 'transfer')
    .input(
      z.object({
        enrollmentId: z.string().uuid(),
        targetClassBatchId: z.string().uuid(),
        effectiveDate: z.coerce.date().optional(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const oldEnrollment = await tx.enrollment.findUniqueOrThrow({
          where: { id: input.enrollmentId },
          include: { batch: { select: { id: true, code: true } } },
        });
        if (oldEnrollment.status === 'transferred' || oldEnrollment.status === 'withdrawn') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Ghi danh đã rời lớp (transferred/withdrawn) — không thể chuyển lớp lần nữa',
          });
        }
        if (oldEnrollment.status !== 'active' && oldEnrollment.status !== 'reserved') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Chỉ có thể chuyển lớp ghi danh đang active/reserved',
          });
        }
        if (oldEnrollment.classBatchId === input.targetClassBatchId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lớp đích trùng lớp hiện tại' });
        }

        const targetBatch = await tx.classBatch.findUniqueOrThrow({
          where: { id: input.targetClassBatchId },
        });
        if (targetBatch.status !== 'open' && targetBatch.status !== 'running') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Lớp đích chưa mở hoặc đã đóng — không thể chuyển vào',
          });
        }

        // Friendly guard before the DB unique([classBatchId, studentId]) fires a raw P2002 (→ 500)
        // — same defensive shape as `enroll`.
        const dup = await tx.enrollment.findFirst({
          where: {
            classBatchId: input.targetClassBatchId,
            studentId: oldEnrollment.studentId,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (dup) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Học sinh đã có ghi danh tại lớp đích' });
        }

        await tx.enrollment.update({
          where: { id: oldEnrollment.id },
          data: { status: 'transferred' },
        });

        const newEnrollment = await tx.enrollment.create({
          data: {
            facilityId: oldEnrollment.facilityId,
            classBatchId: input.targetClassBatchId,
            studentId: oldEnrollment.studentId,
            status: 'active',
            opportunityId: oldEnrollment.opportunityId,
            createdByReceiptId: null,
          },
        });

        // Capacity = cảnh báo mềm (không chặn), same convention as `enroll`.
        const activeCount = await tx.enrollment.count({
          where: { classBatchId: input.targetClassBatchId, status: 'active', archivedAt: null },
        });
        const overCapacity = targetBatch.capacity != null && activeCount > targetBatch.capacity;

        await logEvent(tx, {
          facilityId: oldEnrollment.facilityId,
          entityType: 'student',
          entityId: oldEnrollment.studentId,
          type: 'status_changed',
          body: `Chuyển lớp: ${oldEnrollment.batch.code} → ${targetBatch.code}${input.effectiveDate ? ` từ ${input.effectiveDate.toISOString().slice(0, 10)}` : ''}${input.reason ? ` (${input.reason})` : ''}`,
          changes: [
            { field: 'classBatchId', old: oldEnrollment.classBatchId, new: input.targetClassBatchId },
            { field: 'enrollmentStatus', old: oldEnrollment.status, new: 'transferred' },
          ],
          actorId: ctx.session.userId,
        });

        return {
          oldEnrollmentId: oldEnrollment.id,
          newEnrollmentId: newEnrollment.id,
          overCapacity,
          capacity: targetBatch.capacity,
          enrolledCount: activeCount,
        };
      }),
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
