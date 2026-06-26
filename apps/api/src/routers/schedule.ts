import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { enumerateSessions, detectConflicts, type SessionLike } from '@cmc/domain-academic';
import { router, protectedProcedure, requireRole, Role } from '../trpc.js';

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export const scheduleRouter = router({
  listSlots: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.scheduleSlot.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
      ),
    ),

  addSlot: requireRole(Role.quan_ly)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classBatchId: z.string().uuid(),
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        roomId: z.string().uuid().optional(),
        teacherId: z.string().uuid().optional(),
      }).refine((v) => v.startTime < v.endTime, {
        message: 'Giờ bắt đầu phải trước giờ kết thúc',
        path: ['endTime'],
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const slot = await tx.scheduleSlot.create({ data: { ...input } });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'class_batch',
          entityId: input.classBatchId,
          type: 'updated',
          body: `Thêm khung lịch: thứ ${input.dayOfWeek} ${input.startTime}-${input.endTime}`,
          actorId: ctx.session.userId,
        });
        return slot;
      }),
    ),

  listSessions: protectedProcedure
    .input(z.object({ classBatchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.classSession.findMany({
          where: { classBatchId: input.classBatchId },
          orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
        }),
      ),
    ),

  // Sinh buổi học từ khung lịch — idempotent + chặn cứng trùng phòng/giáo viên.
  generateSessions: requireRole(Role.quan_ly)
    .input(
      z.object({
        classBatchId: z.string().uuid(),
        startDate: z.string().date(),
        endDate: z.string().date(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const batch = await tx.classBatch.findUniqueOrThrow({ where: { id: input.classBatchId } });
        const slots = await tx.scheduleSlot.findMany({
          where: { classBatchId: input.classBatchId, archivedAt: null },
        });
        if (slots.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lớp chưa có khung lịch' });
        }
        const candidates = enumerateSessions(
          slots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            roomId: s.roomId,
            teacherId: s.teacherId,
          })),
          input.startDate,
          input.endDate,
        );

        // Idempotent: bỏ các buổi đã tồn tại (cùng ngày + giờ bắt đầu).
        const existing = await tx.classSession.findMany({
          where: { classBatchId: input.classBatchId },
          select: { sessionDate: true, startTime: true },
        });
        const existingKeys = new Set(existing.map((s) => `${dateKey(s.sessionDate)}|${s.startTime}`));
        const fresh = candidates.filter((c) => !existingKeys.has(`${c.sessionDate}|${c.startTime}`));

        // Trùng lịch (room/teacher) so với mọi buổi chưa hủy trong cùng cơ sở.
        const facilitySessions = await tx.classSession.findMany({
          where: { facilityId: batch.facilityId, status: { not: 'cancelled' } },
          select: { sessionDate: true, startTime: true, endTime: true, roomId: true, teacherId: true },
        });
        const conflicts = detectConflicts(
          fresh,
          facilitySessions.map<SessionLike>((s) => ({
            sessionDate: dateKey(s.sessionDate),
            startTime: s.startTime,
            endTime: s.endTime,
            roomId: s.roomId,
            teacherId: s.teacherId,
          })),
        );
        if (conflicts.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Trùng lịch (${conflicts.length}): ${conflicts
              .slice(0, 3)
              .map((c) => `${c.kind}@${c.date}`)
              .join(', ')}`,
          });
        }

        for (const c of fresh) {
          await tx.classSession.create({
            data: {
              facilityId: batch.facilityId,
              classBatchId: input.classBatchId,
              sessionDate: new Date(c.sessionDate),
              startTime: c.startTime,
              endTime: c.endTime,
              roomId: c.roomId ?? null,
              teacherId: c.teacherId ?? null,
              status: 'planned',
            },
          });
        }
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: input.classBatchId,
          type: 'updated',
          body: `Sinh lịch: tạo ${fresh.length} buổi (bỏ qua ${candidates.length - fresh.length} đã có)`,
          actorId: ctx.session.userId,
        });
        return { created: fresh.length, skipped: candidates.length - fresh.length };
      }),
    ),
});
