import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, ClassStatus } from '@cmc/db';
import type { Prisma } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent, logStatusChange, addFollower } from '@cmc/audit';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';
import { nextBatchCode } from '../services/batch-code.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

const ENTITY = 'class_batch';
const TERMINAL_STATUSES: ClassStatus[] = ['closed', 'cancelled'];

/** Soft-cancel future scheduled parent meetings for a class batch. Returns cancelled count. */
async function cancelFutureParentMeetings(
  tx: Prisma.TransactionClient,
  classBatchId: string,
  now: Date,
): Promise<number> {
  const result = await tx.parentMeeting.updateMany({
    where: { classBatchId, status: 'scheduled', archivedAt: null, scheduledAt: { gte: now } },
    data: { status: 'cancelled' },
  });
  return result.count;
}

/** Restore future soft-cancelled parent meetings when a class is reopened. Returns restored count. */
async function restoreFutureParentMeetings(
  tx: Prisma.TransactionClient,
  classBatchId: string,
  now: Date,
): Promise<number> {
  const result = await tx.parentMeeting.updateMany({
    where: { classBatchId, status: 'cancelled', archivedAt: null, scheduledAt: { gte: now } },
    data: { status: 'scheduled' },
  });
  return result.count;
}

export const classBatchRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.classBatch.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { course: { select: { code: true, name: true, program: true } } },
      }),
    ),
  ),

  get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.classBatch.findUniqueOrThrow({
        where: { id: input.id },
        include: { course: true, _count: { select: { enrollments: true, sessions: true } } },
      }),
    ),
  ),

  create: requireRole(Role.quan_ly)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        courseId: z.string().uuid(),
        name: z.string().min(1),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        capacity: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const year = input.startDate
          ? new Date(input.startDate).getUTCFullYear()
          : new Date().getUTCFullYear();
        const code = await nextBatchCode(tx, input.facilityId, year);
        const batch = await tx.classBatch.create({
          data: {
            facilityId: input.facilityId,
            courseId: input.courseId,
            code,
            name: input.name,
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
            capacity: input.capacity ?? null,
            status: 'planned',
          },
        });
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: ENTITY,
          entityId: batch.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        await addFollower(tx, ENTITY, batch.id, ctx.session.userId);
        return batch;
      }),
    ),

  setStatus: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid(), status: z.nativeEnum(ClassStatus) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.classBatch.findUniqueOrThrow({ where: { id: input.id } });
        const batch = await tx.classBatch.update({
          where: { id: input.id },
          data: { status: input.status },
        });
        await logStatusChange(
          tx,
          { facilityId: batch.facilityId, entityType: ENTITY, entityId: batch.id, actorId: ctx.session.userId },
          'status',
          before.status,
          batch.status,
        );
        // Soft-cancel future parent meetings when transitioning into a terminal state.
        const nowTerminal = TERMINAL_STATUSES.includes(input.status);
        const wasTerminal = TERMINAL_STATUSES.includes(before.status as ClassStatus);
        if (nowTerminal && !wasTerminal) {
          const now = new Date(new Date().toISOString().slice(0, 10));
          const count = await cancelFutureParentMeetings(tx, batch.id, now);
          if (count > 0) {
            await logEvent(tx, {
              facilityId: batch.facilityId,
              entityType: ENTITY,
              entityId: batch.id,
              type: 'note',
              body: `Hủy mềm ${count} lịch họp PH tương lai (lớp ${input.status})`,
              actorId: ctx.session.userId,
            });
          }
        }
        return batch;
      }),
    ),

  // Hủy lớp linh hoạt: từ bất kỳ trạng thái, BẮT BUỘC lý do; buổi học tương lai → cancelled.
  cancel: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.classBatch.findUniqueOrThrow({ where: { id: input.id } });
        if (before.status === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lớp đã ở trạng thái hủy' });
        }
        const batch = await tx.classBatch.update({
          where: { id: input.id },
          data: { status: 'cancelled' },
        });
        // Cascade: buổi học chưa diễn ra → cancelled (buổi đã qua giữ nguyên để audit/điểm danh).
        const today = new Date(new Date().toISOString().slice(0, 10));
        const cancelled = await tx.classSession.updateMany({
          where: { classBatchId: batch.id, status: { not: 'cancelled' }, sessionDate: { gte: today } },
          data: { status: 'cancelled' },
        });
        // Cascade: lịch họp PH tương lai → cancelled.
        const cancelledMeetings = await cancelFutureParentMeetings(tx, batch.id, today);
        await logStatusChange(
          tx,
          { facilityId: batch.facilityId, entityType: ENTITY, entityId: batch.id, actorId: ctx.session.userId },
          'status',
          before.status,
          'cancelled',
        );
        const meetingNote = cancelledMeetings > 0 ? `; hủy mềm ${cancelledMeetings} lịch họp PH tương lai` : '';
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: ENTITY,
          entityId: batch.id,
          type: 'note',
          body: `Lý do hủy: ${input.reason} (huỷ ${cancelled.count} buổi chưa diễn ra${meetingNote})`,
          actorId: ctx.session.userId,
        });
        // Notify quan_ly of this facility that the class was cancelled.
        const managers = await tx.userFacility.findMany({
          where: { facilityId: batch.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const managerIds = managers
          .filter((uf) => uf.user.roles.includes('quan_ly'))
          .map((uf) => uf.userId);
        await emitStaffNotif(tx, {
          recipientIds: managerIds,
          event: 'class_cancelled',
          title: 'Lớp học đã bị hủy',
          body: `Lớp ${batch.code} — ${batch.name} đã bị hủy. Lý do: ${input.reason}`,
          data: { classBatchId: batch.id, code: batch.code },
          facilityId: batch.facilityId,
        });
        return { batch, cancelledSessions: cancelled.count, cancelledMeetings };
      }),
    ),

  // Mở lại lớp đã hủy.
  reopen: requireRole(Role.quan_ly)
    .input(z.object({ id: z.string().uuid(), toStatus: z.nativeEnum(ClassStatus), reason: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.classBatch.findUniqueOrThrow({ where: { id: input.id } });
        if (before.status !== 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ mở lại được lớp đang hủy' });
        }
        if (input.toStatus === 'cancelled') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'toStatus không hợp lệ' });
        }
        const batch = await tx.classBatch.update({
          where: { id: input.id },
          data: { status: input.toStatus },
        });
        await logStatusChange(
          tx,
          { facilityId: batch.facilityId, entityType: ENTITY, entityId: batch.id, actorId: ctx.session.userId },
          'status',
          'cancelled',
          batch.status,
        );
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: ENTITY,
          entityId: batch.id,
          type: 'note',
          body: `Mở lại lớp: ${input.reason}`,
          actorId: ctx.session.userId,
        });
        const now = new Date(new Date().toISOString().slice(0, 10));
        const restoredMeetings = await restoreFutureParentMeetings(tx, batch.id, now);
        if (restoredMeetings > 0) {
          await logEvent(tx, {
            facilityId: batch.facilityId,
            entityType: ENTITY,
            entityId: batch.id,
            type: 'note',
            body: `Khôi phục ${restoredMeetings} lịch họp PH tương lai (mở lại lớp)`,
            actorId: ctx.session.userId,
          });
        }
        return batch;
      }),
    ),
});
