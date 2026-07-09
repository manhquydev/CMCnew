import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls, Prisma } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent, diffChanges } from '@cmc/audit';
import { enumerateSessions, detectConflicts, type SessionLike } from '@cmc/domain-academic';
import { router, protectedProcedure, requirePermission, lmsProcedure } from '../trpc.js';
import { assertSlotRefsInFacility } from '../lib/slot-refs-guard.js';
import { recomputeCurriculumMapping } from '../services/curriculum-recompute.js';
import { DOW_LABEL } from '../lib/day-of-week-label.js';

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
        // Facility-membership guard (same rationale as classBatch.create): the
        // referenced room/teacher must belong to the batch's facility.
        await assertSlotRefsInFacility(tx, batch.facilityId, {
          roomId: input.roomId,
          teacherId: input.teacherId,
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
  // giao_vien defaults to own sessions; giam_doc_dao_tao / super may view all facility or filter by teacherId.
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
          session.roles.some((r) => r === 'giam_doc_dao_tao');
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
          include: {
            batch: { select: { id: true, code: true, name: true } },
            curriculumUnit: { select: { unitCode: true, theme: true } },
            curriculumLesson: { select: { lessonCode: true, seqInUnit: true, orderGlobal: true } },
          },
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

        // Recompute the curriculum-unit mapping for the WHOLE batch (not just the new
        // sessions) — re-running after a slot is added at an earlier weekday must not leave
        // stale unit assignments on the older sessions.
        const curriculumMap = await recomputeCurriculumMapping(tx, input.classBatchId, batch.courseId);
        const curriculumSummary = curriculumMap
          ? ` | Map curriculum: ${curriculumMap.mappedCount} buổi, ${curriculumMap.overflowCount} buổi dư (null), ${curriculumMap.uncoveredUnits} unit chưa phủ`
          : '';

        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: input.classBatchId,
          type: 'updated',
          body: `Sinh lịch: tạo ${fresh.length} buổi (bỏ qua ${candidates.length - fresh.length} đã có)${curriculumSummary}`,
          actorId: ctx.session.userId,
        });
        return { created: fresh.length, skipped: candidates.length - fresh.length };
      }),
    ),

  // Tạo buổi học bù (isMakeup=true) — buổi đơn lẻ, KHÔNG qua khung lịch (scheduleSlot).
  // Trùng phòng/GV bị chặn cứng như generateSessions (reuse detectConflicts). Buổi bù không
  // mở curriculumUnit cho cả lớp (Tier-A, exercise-open.ts) — chỉ HS có điểm danh present/late
  // trên buổi này được mở riêng (Tier-B).
  createMakeupSession: requirePermission('schedule', 'createMakeupSession')
    .input(
      z.object({
        classBatchId: z.string().uuid(),
        sessionDate: z.string().date(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/),
        roomId: z.string().uuid().optional(),
        teacherId: z.string().uuid().optional(),
        curriculumUnitId: z.string().uuid().optional(),
        curriculumLessonId: z.string().uuid().optional(),
      }).refine((v) => v.startTime < v.endTime, {
        message: 'Giờ bắt đầu phải trước giờ kết thúc',
        path: ['endTime'],
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const batch = await tx.classBatch.findUniqueOrThrow({
          where: { id: input.classBatchId },
          select: { id: true, facilityId: true, status: true },
        });
        if (batch.status !== 'open' && batch.status !== 'running') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Lớp phải đang mở hoặc đang học mới tạo được buổi bù',
          });
        }
        await assertSlotRefsInFacility(tx, batch.facilityId, {
          roomId: input.roomId,
          teacherId: input.teacherId,
        });

        const candidate: SessionLike = {
          sessionDate: input.sessionDate,
          startTime: input.startTime,
          endTime: input.endTime,
          roomId: input.roomId ?? null,
          teacherId: input.teacherId ?? null,
        };
        const facilitySessions = await tx.classSession.findMany({
          where: {
            facilityId: batch.facilityId,
            status: { not: 'cancelled' },
            sessionDate: new Date(input.sessionDate),
          },
          select: { sessionDate: true, startTime: true, endTime: true, roomId: true, teacherId: true },
        });
        const conflicts = detectConflicts(
          [candidate],
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

        let curriculumUnitId = input.curriculumUnitId ?? null;
        let curriculumLessonId = input.curriculumLessonId ?? null;
        if (input.curriculumLessonId) {
          const lesson = await tx.curriculumLesson.findUniqueOrThrow({
            where: { id: input.curriculumLessonId },
            select: { curriculumUnitId: true },
          });
          curriculumUnitId = lesson.curriculumUnitId;
        } else if (input.curriculumUnitId) {
          const lesson = await tx.curriculumLesson.findFirst({
            where: { curriculumUnitId: input.curriculumUnitId },
            orderBy: { seqInUnit: 'asc' },
            select: { id: true },
          });
          curriculumLessonId = lesson?.id ?? null;
        }

        let created;
        try {
          created = await tx.classSession.create({
            data: {
              facilityId: batch.facilityId,
              classBatchId: input.classBatchId,
              sessionDate: new Date(input.sessionDate),
              startTime: input.startTime,
              endTime: input.endTime,
              roomId: input.roomId ?? null,
              teacherId: input.teacherId ?? null,
              curriculumUnitId,
              curriculumLessonId,
              status: 'planned',
              isMakeup: true,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Lớp đã có buổi vào đúng ngày/giờ này',
            });
          }
          throw err;
        }

        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: input.classBatchId,
          type: 'updated',
          body: `Tạo buổi học bù: ${input.sessionDate} ${input.startTime}-${input.endTime}`,
          actorId: ctx.session.userId,
        });

        return created;
      }),
    ),

  // Sửa khung lịch (thứ/giờ/phòng/GV); tùy chọn áp dụng cho buổi tương lai chưa hủy của
  // CHÍNH lớp này (batch-scoped — red-team #5). Đổi thứ/giờ → recompute curriculum (Phase 3).
  editSlot: requirePermission('schedule', 'editSlot')
    .input(
      z.object({
        slotId: z.string().uuid(),
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        roomId: z.string().uuid().nullable().optional(),
        teacherId: z.string().uuid().nullable().optional(),
        applyToFuture: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.scheduleSlot.findUniqueOrThrow({ where: { id: input.slotId } });
        const next = {
          dayOfWeek: input.dayOfWeek ?? before.dayOfWeek,
          startTime: input.startTime ?? before.startTime,
          endTime: input.endTime ?? before.endTime,
          roomId: input.roomId !== undefined ? input.roomId : before.roomId,
          teacherId: input.teacherId !== undefined ? input.teacherId : before.teacherId,
        };
        if (next.startTime >= next.endTime) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Giờ bắt đầu phải trước giờ kết thúc' });
        }
        const batch = await tx.classBatch.findUniqueOrThrow({
          where: { id: before.classBatchId },
          select: { id: true, facilityId: true, courseId: true },
        });
        await assertSlotRefsInFacility(tx, batch.facilityId, {
          roomId: next.roomId ?? undefined,
          teacherId: next.teacherId ?? undefined,
        });

        const reordered = next.dayOfWeek !== before.dayOfWeek || next.startTime !== before.startTime;
        let movedCount = 0;

        if (input.applyToFuture) {
          const today = new Date(new Date().toISOString().slice(0, 10));
          // Match on the slot's OLD (dayOfWeek, startTime) — a session has no slotId FK, so
          // this is the only way to identify "buổi thuộc slot này" among the batch's sessions.
          // getUTCDay matches enumerateSessions' convention (avoids ICT/UTC weekday drift).
          // isMakeup: false — a makeup session (createMakeupSession) can coincidentally fall on
          // the same weekday/startTime as this slot but does not belong to it; recomputeCurriculumMapping
          // already excludes makeup sessions from the slot's regular set, so the mover must too.
          const candidates = await tx.classSession.findMany({
            where: {
              classBatchId: batch.id,
              status: { not: 'cancelled' },
              sessionDate: { gte: today },
              startTime: before.startTime,
              isMakeup: false,
            },
          });
          const matching = candidates.filter((s) => s.sessionDate.getUTCDay() === before.dayOfWeek);

          if (matching.length > 0) {
            const dayDelta = next.dayOfWeek - before.dayOfWeek;
            const proposed = matching.map((s) => {
              const d = new Date(s.sessionDate);
              d.setUTCDate(d.getUTCDate() + dayDelta);
              return { id: s.id, sessionDate: d, sessionDateKey: dateKey(d) };
            });
            const matchingIds = new Set(matching.map((s) => s.id));

            // (b) unique-key collision — the new (sessionDate,startTime) must not already
            // belong to a different session in this batch (red-team #6: avoid raw P2002).
            const batchSessions = await tx.classSession.findMany({
              where: { classBatchId: batch.id, id: { notIn: [...matchingIds] } },
              select: { sessionDate: true, startTime: true },
            });
            const takenKeys = new Set(batchSessions.map((s) => `${dateKey(s.sessionDate)}|${s.startTime}`));
            for (const p of proposed) {
              if (takenKeys.has(`${p.sessionDateKey}|${next.startTime}`)) {
                throw new TRPCError({
                  code: 'CONFLICT',
                  message: `Trùng buổi đã có trong lớp: ${p.sessionDateKey} ${next.startTime}`,
                });
              }
            }

            // (a) room/teacher conflict — other batches' sessions in the same facility/window,
            // excluding the sessions being moved (they don't conflict with themselves).
            const windowDates = proposed.map((p) => p.sessionDate);
            const windowMin = windowDates.reduce((a, b) => (a < b ? a : b));
            const windowMax = windowDates.reduce((a, b) => (a > b ? a : b));
            const facilitySessions = await tx.classSession.findMany({
              where: {
                facilityId: batch.facilityId,
                status: { not: 'cancelled' },
                sessionDate: { gte: windowMin, lte: windowMax },
                id: { notIn: [...matchingIds] },
              },
              select: { sessionDate: true, startTime: true, endTime: true, roomId: true, teacherId: true },
            });
            const conflicts = detectConflicts(
              proposed.map((p) => ({
                sessionDate: p.sessionDateKey,
                startTime: next.startTime,
                endTime: next.endTime,
                roomId: next.roomId ?? null,
                teacherId: next.teacherId ?? null,
              })),
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
                message: `Trùng lịch (${conflicts.length}) khi áp dụng buổi tương lai`,
              });
            }

            for (const p of proposed) {
              await tx.classSession.update({
                where: { id: p.id },
                data: {
                  sessionDate: p.sessionDate,
                  startTime: next.startTime,
                  endTime: next.endTime,
                  roomId: next.roomId,
                  teacherId: next.teacherId,
                },
              });
            }
            movedCount = proposed.length;
          }
        }

        const updatedSlot = await tx.scheduleSlot.update({
          where: { id: input.slotId },
          data: {
            dayOfWeek: next.dayOfWeek,
            startTime: next.startTime,
            endTime: next.endTime,
            roomId: next.roomId,
            teacherId: next.teacherId,
          },
        });

        const changes = diffChanges(before, updatedSlot, [
          'dayOfWeek',
          'startTime',
          'endTime',
          'roomId',
          'teacherId',
        ]);
        const futureNote = input.applyToFuture ? `Áp dụng cho ${movedCount} buổi tương lai` : undefined;
        if (changes.length > 0 || movedCount > 0) {
          await logEvent(tx, {
            facilityId: batch.facilityId,
            entityType: 'class_batch',
            entityId: batch.id,
            type: 'updated',
            changes: changes.length > 0 ? changes : undefined,
            body: futureNote,
            actorId: ctx.session.userId,
          });
        }

        // Reorder (day/time changed) with sessions actually moved → the curriculum-unit
        // mapping's chronological order may have shifted; recompute the whole batch.
        if (reordered && movedCount > 0) {
          await recomputeCurriculumMapping(tx, batch.id, batch.courseId);
        }

        return { slot: updatedSlot, movedSessions: movedCount };
      }),
    ),

  // LMS-facing: buổi học của (các) HS mà principal sở hữu, kèm nội dung curriculum theo
  // buổi (chủ đề/nội dung/tư duy/assessment). curriculumUnit null-safe — buổi chưa map vẫn
  // hiển thị (chỉ thiếu phần nội dung khung). Không cần permission registry — lmsProcedure
  // gates by principal ownership, không phải theo role nhân viên.
  sessionsForStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid().optional() }).optional())
    .query(({ ctx, input }) =>
      withRls(lmsRlsContextOf(ctx.lms), async (tx) => {
        const studentIds = input?.studentId ? [input.studentId] : ctx.lms.studentIds;
        for (const id of studentIds) {
          if (!ctx.lms.studentIds.includes(id)) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền xem học sinh này' });
          }
        }
        return tx.classSession.findMany({
          where: {
            status: { not: 'cancelled' },
            batch: { enrollments: { some: { studentId: { in: studentIds }, archivedAt: null } } },
          },
          select: {
            id: true,
            sessionDate: true,
            startTime: true,
            endTime: true,
            status: true,
            batch: { select: { id: true, code: true, name: true } },
            curriculumUnit: {
              select: {
                unitCode: true,
                unitType: true,
                theme: true,
                content: true,
                thinkingGoal: true,
                assessment: true,
              },
            },
            curriculumLesson: {
              select: {
                lessonCode: true,
                seqInUnit: true,
                orderGlobal: true,
              },
            },
          },
          orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
        });
      }),
    ),

  // Recompute curriculum-lesson mapping for all non-cancelled, non-makeup sessions of a batch.
  // Use when sessions were created before curriculum was seeded, leaving curriculumLessonId null.
  recomputeForBatch: requirePermission('schedule', 'recomputeForBatch')
    .input(z.object({ classBatchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const batch = await tx.classBatch.findUniqueOrThrow({
          where: { id: input.classBatchId },
          select: { courseId: true, facilityId: true, name: true },
        });
        const result = await recomputeCurriculumMapping(tx, input.classBatchId, batch.courseId);
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: input.classBatchId,
          type: 'updated',
          body: `Recompute curriculum mapping: ${result ? `${result.mappedCount} buổi mapped, ${result.overflowCount} dư, ${result.uncoveredUnits} unit chưa phủ` : 'không có unit nào'}`,
          actorId: ctx.session.userId,
        });
        return result;
      }),
    ),

  // Xóa khung lịch (soft-archive) — buổi đã sinh từ khung này KHÔNG bị xóa (giữ audit/điểm danh).
  removeSlot: requirePermission('schedule', 'removeSlot')
    .input(z.object({ slotId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const slot = await tx.scheduleSlot.findUniqueOrThrow({ where: { id: input.slotId } });
        const batch = await tx.classBatch.findUniqueOrThrow({
          where: { id: slot.classBatchId },
          select: { facilityId: true },
        });
        const archived = await tx.scheduleSlot.update({
          where: { id: input.slotId },
          data: { archivedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: slot.classBatchId,
          type: 'updated',
          body: `Xóa khung lịch: ${DOW_LABEL[slot.dayOfWeek]} ${slot.startTime}-${slot.endTime} (buổi đã sinh vẫn giữ nguyên)`,
          actorId: ctx.session.userId,
        });
        return archived;
      }),
    ),
});
