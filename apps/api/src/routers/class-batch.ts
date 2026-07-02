import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, ClassStatus } from '@cmc/db';
import type { Prisma } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent, logStatusChange, addFollower, diffChanges } from '@cmc/audit';
import { router, protectedProcedure, requirePermission } from '../trpc.js';
import { nextBatchCode } from '../services/batch-code.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';
import { assertSlotRefsInFacility } from '../lib/slot-refs-guard.js';
import { DOW_LABEL } from '../lib/day-of-week-label.js';

const ENTITY = 'class_batch';
const TERMINAL_STATUSES: ClassStatus[] = ['closed', 'cancelled'];

const slotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    roomId: z.string().uuid().optional(),
    teacherId: z.string().uuid().optional(),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'Giờ bắt đầu phải trước giờ kết thúc',
    path: ['endTime'],
  });
type SlotInputShape = z.infer<typeof slotSchema>;

/** Reject two slots with the same (dayOfWeek, startTime) — createMany's skipDuplicates would
 * otherwise drop one silently, and detectConflicts doesn't catch it (no room/teacher overlap). */
function assertNoDuplicateSlots(slots: SlotInputShape[]): void {
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.dayOfWeek}|${s.startTime}`;
    if (seen.has(key)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Trùng khung lịch: ${DOW_LABEL[s.dayOfWeek]} ${s.startTime}`,
      });
    }
    seen.add(key);
  }
}

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

  create: requirePermission('classBatch', 'create')
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        courseId: z.string().uuid(),
        name: z.string().min(1),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        capacity: z.number().int().positive().optional(),
        // slots is the current shape (0..n weekly slots); initialSlot is kept for backward
        // compatibility with older clients and normalized into slots below.
        initialSlot: slotSchema.optional(),
        slots: z.array(slotSchema).optional(),
      }).refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
        message: 'Ngày khai giảng phải trước ngày kết thúc',
        path: ['endDate'],
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const slots: SlotInputShape[] = input.slots ?? (input.initialSlot ? [input.initialSlot] : []);
        assertNoDuplicateSlots(slots);

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
        for (const slot of slots) {
          // Facility-membership guard: schedule_slot has no DB FK on room_id /
          // teacher_id, so the app layer must reject cross-facility or fabricated
          // refs before the slot is created (design.md "scoped to facility" is
          // UI-only; the API is the trust boundary).
          await assertSlotRefsInFacility(tx, batch.facilityId, slot);
          await tx.scheduleSlot.create({
            data: {
              facilityId: batch.facilityId,
              classBatchId: batch.id,
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime,
              roomId: slot.roomId ?? null,
              teacherId: slot.teacherId ?? null,
            },
          });
        }
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: ENTITY,
          entityId: batch.id,
          type: 'created',
          actorId: ctx.session.userId,
        });
        if (slots.length > 0) {
          const listing = slots.map((s) => `${DOW_LABEL[s.dayOfWeek]} ${s.startTime}-${s.endTime}`).join('; ');
          await logEvent(tx, {
            facilityId: batch.facilityId,
            entityType: ENTITY,
            entityId: batch.id,
            type: 'updated',
            body: `Khung lịch (${slots.length}): ${listing}`,
            actorId: ctx.session.userId,
          });
        }
        await addFollower(tx, ENTITY, batch.id, ctx.session.userId);
        return batch;
      }),
    ),

  update: requirePermission('classBatch', 'update')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        capacity: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.classBatch.findUniqueOrThrow({ where: { id: input.id } });
        const batch = await tx.classBatch.update({
          where: { id: input.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.startDate !== undefined ? { startDate: new Date(input.startDate) } : {}),
            ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
            ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          },
        });
        // Compare primitive snapshots (not raw Prisma Date objects) — two separate Date
        // instances for the same instant are never === to each other, which would make
        // diffChanges report a false "change" on every update even when nothing moved.
        const snapshot = (b: typeof before) => ({
          name: b.name,
          startDate: b.startDate ? b.startDate.toISOString().slice(0, 10) : null,
          endDate: b.endDate ? b.endDate.toISOString().slice(0, 10) : null,
          capacity: b.capacity,
        });
        const changes = diffChanges(snapshot(before), snapshot(batch), [
          'name',
          'startDate',
          'endDate',
          'capacity',
        ]);
        if (changes.length > 0) {
          await logEvent(tx, {
            facilityId: batch.facilityId,
            entityType: ENTITY,
            entityId: batch.id,
            type: 'updated',
            changes,
            actorId: ctx.session.userId,
          });
        }
        return batch;
      }),
    ),

  setStatus: requirePermission('classBatch', 'setStatus')
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
  cancel: requirePermission('classBatch', 'cancel')
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
        // Notify giam_doc_dao_tao of this facility (classBatch.cancel owner) that the class was cancelled.
        const managers = await tx.userFacility.findMany({
          where: { facilityId: batch.facilityId },
          select: { userId: true, user: { select: { roles: true } } },
        });
        const managerIds = managers
          .filter((uf) => uf.user.roles.includes('giam_doc_dao_tao'))
          .map((uf) => uf.userId);
        // emitStaffNotif persists rows inside the tx and returns a push fn.
        // Push is called outside withRls so SSE fires only after the tx commits.
        const pushNotifs = await emitStaffNotif(tx, {
          recipientIds: managerIds,
          event: 'class_cancelled',
          title: 'Lớp học đã bị hủy',
          body: `Lớp ${batch.code} — ${batch.name} đã bị hủy. Lý do: ${input.reason}`,
          data: { classBatchId: batch.id, code: batch.code },
          facilityId: batch.facilityId,
        });
        return { batch, cancelledSessions: cancelled.count, cancelledMeetings, pushNotifs };
      }).then(({ pushNotifs, ...result }) => { pushNotifs(); return result; }),
    ),

  // Mở lại lớp đã hủy.
  reopen: requirePermission('classBatch', 'reopen')
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
        // Mirror cancel(): restore future sessions that the cancellation soft-cancelled so the
        // teacher's schedule isn't blank after reopen. Future cancelled → planned.
        const restoredSessions = await tx.classSession.updateMany({
          where: { classBatchId: batch.id, status: 'cancelled', sessionDate: { gte: now } },
          data: { status: 'planned' },
        });
        if (restoredSessions.count > 0) {
          await logEvent(tx, {
            facilityId: batch.facilityId,
            entityType: ENTITY,
            entityId: batch.id,
            type: 'note',
            body: `Khôi phục ${restoredSessions.count} buổi học tương lai (mở lại lớp)`,
            actorId: ctx.session.userId,
          });
        }
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
