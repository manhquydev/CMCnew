import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { enumerateSessions, detectConflicts, type SessionLike } from '@cmc/domain-academic';
import { router, protectedProcedure, requirePermission } from '../trpc.js';

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

  addSlot: requirePermission('schedule', 'addSlot')
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
        // Derive facilityId from the class batch (server-authoritative), never from the client input:
        // RLS scopes this lookup to the caller's facilities, so a batch in another facility throws —
        // closing the hole where a caller could pass their own facilityId with a foreign classBatchId
        // and create an orphan slot (input.facilityId is intentionally ignored).
        const batch = await tx.classBatch.findUniqueOrThrow({
          where: { id: input.classBatchId },
          select: { facilityId: true },
        });
        const slot = await tx.scheduleSlot.create({
          data: {
            facilityId: batch.facilityId,
            classBatchId: input.classBatchId,
            dayOfWeek: input.dayOfWeek,
            startTime: input.startTime,
            endTime: input.endTime,
            roomId: input.roomId,
            teacherId: input.teacherId,
          },
        });
        await logEvent(tx, {
          facilityId: batch.facilityId,
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

  // Lịch giảng dạy đa lớp — cross-class agenda cho giáo viên và quản lý.
  // giao_vien defaults to own sessions; quan_ly / head_teacher / super may view all facility or filter by teacherId.
  mySessions: protectedProcedure
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        from: z.string().date(),
        to: z.string().date(),
        teacherId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { session } = ctx;
        const isManager =
          session.isSuperAdmin ||
          session.roles.some((r) => ['quan_ly', 'head_teacher'].includes(r));
        // Managers may pass an explicit teacherId or omit to see all; giao_vien always own only.
        const teacherFilter = isManager ? input.teacherId : session.userId;

        const sessions = await tx.classSession.findMany({
          where: {
            facilityId: input.facilityId,
            sessionDate: {
              gte: new Date(input.from),
              lte: new Date(input.to),
            },
            ...(teacherFilter ? { teacherId: teacherFilter } : {}),
          },
          include: { batch: { select: { id: true, code: true, name: true } } },
          orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
        });

        // Resolve room names via a secondary query (ClassSession.roomId FK added in migration
        // 20260627010000; Prisma include would work but a batched secondary query avoids
        // pulling full Room rows for each session when only the name is needed).
        const roomIds = [...new Set(sessions.map((s) => s.roomId).filter(Boolean))] as string[];
        const rooms =
          roomIds.length > 0
            ? await tx.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true } })
            : [];
        const roomMap = new Map(rooms.map((r) => [r.id, r.name]));

        return sessions.map((s) => ({
          ...s,
          roomName: s.roomId ? (roomMap.get(s.roomId) ?? null) : null,
        }));
      }),
    ),

  // Sinh buổi học từ khung lịch — idempotent + chặn cứng trùng phòng/giáo viên.
  generateSessions: requirePermission('schedule', 'generateSessions')
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

        // Không có buổi mới (re-run idempotent) → không có gì để kiểm tra/tạo.
        // Phải return sớm trước reduce bên dưới vì reduce không có initial value sẽ ném trên mảng rỗng.
        if (fresh.length === 0) {
          return { created: 0, skipped: candidates.length };
        }

        // Trùng lịch (room/teacher) so với buổi chưa hủy trong cùng cơ sở, giới hạn trong
        // cửa sổ ngày của các buổi mới — tránh nạp toàn bộ lịch sử cơ sở (Bug A fix).
        const candidateDates = fresh.map((c) => new Date(c.sessionDate));
        const windowMin = candidateDates.reduce((a, b) => (a < b ? a : b));
        const windowMax = candidateDates.reduce((a, b) => (a > b ? a : b));
        const facilitySessions = await tx.classSession.findMany({
          where: {
            facilityId: batch.facilityId,
            status: { not: 'cancelled' },
            sessionDate: { gte: windowMin, lte: windowMax },
          },
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

        await tx.classSession.createMany({
          data: fresh.map((c) => ({
            facilityId: batch.facilityId,
            classBatchId: input.classBatchId,
            sessionDate: new Date(c.sessionDate),
            startTime: c.startTime,
            endTime: c.endTime,
            roomId: c.roomId ?? null,
            teacherId: c.teacherId ?? null,
            status: 'planned',
          })),
          skipDuplicates: true,
        });
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
