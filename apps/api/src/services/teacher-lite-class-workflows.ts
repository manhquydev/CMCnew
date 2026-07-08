import { TRPCError } from '@trpc/server';
import { logEvent, logStatusChange } from '@cmc/audit';
import { type RequestSession } from '@cmc/auth';
import { Prisma, withRls } from '@cmc/db';
import { enumerateSessions, detectConflicts, type SessionLike } from '@cmc/domain-academic';
import { z } from 'zod';
import { assertSlotRefsInFacility } from '../lib/slot-refs-guard.js';
import { DOW_LABEL } from '../lib/day-of-week-label.js';
import { nextBatchCode } from './batch-code.js';
import { recomputeCurriculumMapping } from './curriculum-recompute.js';

const UUID = z.string().uuid();
const TIME = z.string().regex(/^\d{2}:\d{2}$/);

const slotSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: TIME,
    endTime: TIME,
    roomId: UUID.optional(),
    teacherId: UUID.optional(),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: 'Gio bat dau phai truoc gio ket thuc',
    path: ['endTime'],
  });

export const createTeacherLiteClassInput = z
  .object({
    facilityId: z.number().int().positive(),
    courseId: UUID,
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    capacity: z.number().int().positive().optional(),
    slot: slotSchema.optional(),
    generateSessions: z.boolean().default(true),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'Ngay khai giang phai truoc ngay ket thuc',
    path: ['endDate'],
  });

export const cancelTeacherLiteClassInput = z.object({
  id: UUID,
  reason: z.string().trim().min(1),
});

export const cancelTeacherLiteSessionInput = z.object({
  sessionId: UUID,
  reason: z.string().trim().min(1),
});

export type TeacherLiteClassCreateInput = z.infer<typeof createTeacherLiteClassInput>;
export type TeacherLiteClassCancelInput = z.infer<typeof cancelTeacherLiteClassInput>;
export type TeacherLiteSessionCancelInput = z.infer<typeof cancelTeacherLiteSessionInput>;

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

function assertFacilityAccess(session: RequestSession, facilityId: number) {
  if (!session.isSuperAdmin && !session.facilityIds.includes(facilityId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Khong co quyen tren co so nay' });
  }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

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

/**
 * Sinh buổi học ban đầu từ 1..n khung lịch tuần — dùng chung bởi teacherLite.createClass
 * (1 slot) và classBatch.create (n slots), thay cho nút "Sinh buổi" thủ công.
 */
export async function generateInitialSessions(
  tx: Prisma.TransactionClient,
  args: {
    facilityId: number;
    classBatchId: string;
    courseId: string;
    startDate?: string;
    endDate?: string;
    slots?: z.infer<typeof slotSchema>[];
    actorId: string;
  },
) {
  if (!args.slots || args.slots.length === 0 || !args.startDate || !args.endDate) {
    return { created: 0, skipped: 0 };
  }

  const candidates = enumerateSessions(args.slots, args.startDate, args.endDate);
  if (candidates.length === 0) return { created: 0, skipped: 0 };

  const existing = await tx.classSession.findMany({
    where: { classBatchId: args.classBatchId },
    select: { sessionDate: true, startTime: true },
  });
  const existingKeys = new Set(existing.map((s) => `${dateKey(s.sessionDate)}|${s.startTime}`));
  const fresh = candidates.filter((c) => !existingKeys.has(`${c.sessionDate}|${c.startTime}`));
  if (fresh.length === 0) return { created: 0, skipped: candidates.length };

  const candidateDates = fresh.map((c) => new Date(c.sessionDate));
  const windowMin = candidateDates.reduce((a, b) => (a < b ? a : b));
  const windowMax = candidateDates.reduce((a, b) => (a > b ? a : b));
  const facilitySessions = await tx.classSession.findMany({
    where: {
      facilityId: args.facilityId,
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
      message: `Trung lich (${conflicts.length}): ${conflicts
        .slice(0, 3)
        .map((c) => `${c.kind}@${c.date}`)
        .join(', ')}`,
    });
  }

  await tx.classSession.createMany({
    data: fresh.map((c) => ({
      facilityId: args.facilityId,
      classBatchId: args.classBatchId,
      sessionDate: new Date(c.sessionDate),
      startTime: c.startTime,
      endTime: c.endTime,
      roomId: c.roomId ?? null,
      teacherId: c.teacherId ?? null,
      status: 'planned',
    })),
    skipDuplicates: true,
  });
  await recomputeCurriculumMapping(tx, args.classBatchId, args.courseId);
  await logEvent(tx, {
    facilityId: args.facilityId,
    entityType: 'class_batch',
    entityId: args.classBatchId,
    type: 'updated',
    body: `Tu dong sinh ${fresh.length} buoi hoc ban dau`,
    actorId: args.actorId,
  });
  return { created: fresh.length, skipped: candidates.length - fresh.length };
}

export async function createTeacherLiteClass(
  session: RequestSession,
  input: TeacherLiteClassCreateInput,
) {
  assertFacilityAccess(session, input.facilityId);

  try {
    return await withRls(
      { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
      async (tx) => {
        if (input.slot) {
          await assertSlotRefsInFacility(tx, input.facilityId, input.slot);
        }

        const year = input.startDate
          ? new Date(input.startDate).getUTCFullYear()
          : new Date().getUTCFullYear();
        const [facility, course] = await Promise.all([
          tx.facility.findUniqueOrThrow({ where: { id: input.facilityId }, select: { code: true } }),
          tx.course.findUniqueOrThrow({ where: { id: input.courseId }, select: { program: true } }),
        ]);
        const code = await nextBatchCode(tx, input.facilityId, facility.code, course.program, year);
        const batch = await tx.classBatch.create({
          data: {
            facilityId: input.facilityId,
            courseId: input.courseId,
            code,
            name: code,
            startDate: input.startDate ? new Date(input.startDate) : null,
            endDate: input.endDate ? new Date(input.endDate) : null,
            capacity: input.capacity ?? null,
            status: 'open',
          },
        });

        if (input.slot) {
          await tx.scheduleSlot.create({
            data: {
              facilityId: batch.facilityId,
              classBatchId: batch.id,
              dayOfWeek: input.slot.dayOfWeek,
              startTime: input.slot.startTime,
              endTime: input.slot.endTime,
              roomId: input.slot.roomId ?? null,
              teacherId: input.slot.teacherId ?? null,
            },
          });
        }

        const sessions = input.generateSessions
          ? await generateInitialSessions(tx, {
              facilityId: batch.facilityId,
              classBatchId: batch.id,
              courseId: batch.courseId,
              startDate: input.startDate,
              endDate: input.endDate,
              slots: input.slot ? [input.slot] : undefined,
              actorId: session.userId,
            })
          : { created: 0, skipped: 0 };

        await logEvent(tx, {
          facilityId: batch.facilityId,
          entityType: 'class_batch',
          entityId: batch.id,
          type: 'created',
          body: input.slot
            ? `Teacher Lite: ${DOW_LABEL[input.slot.dayOfWeek]} ${input.slot.startTime}-${input.slot.endTime}`
            : 'Teacher Lite',
          actorId: session.userId,
        });

        return { batch, sessions };
      },
    );
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Ma lop hoac buoi hoc da ton tai' });
    }
    throw error;
  }
}

export async function cancelTeacherLiteClass(
  session: RequestSession,
  input: TeacherLiteClassCancelInput,
) {
  return withRls(
    { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
    async (tx) => {
      const before = await tx.classBatch.findUniqueOrThrow({ where: { id: input.id } });
      assertFacilityAccess(session, before.facilityId);
      if (before.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lop da o trang thai huy' });
      }

      const batch = await tx.classBatch.update({
        where: { id: input.id },
        data: { status: 'cancelled' },
      });
      const today = new Date(new Date().toISOString().slice(0, 10));
      const cancelled = await tx.classSession.updateMany({
        where: { classBatchId: batch.id, status: { not: 'cancelled' }, sessionDate: { gte: today } },
        data: { status: 'cancelled' },
      });
      const cancelledMeetings = await cancelFutureParentMeetings(tx, batch.id, today);
      await logStatusChange(
        tx,
        { facilityId: batch.facilityId, entityType: 'class_batch', entityId: batch.id, actorId: session.userId },
        'status',
        before.status,
        'cancelled',
      );
      await logEvent(tx, {
        facilityId: batch.facilityId,
        entityType: 'class_batch',
        entityId: batch.id,
        type: 'note',
        body: `Teacher Lite huy lop: ${input.reason} (huy ${cancelled.count} buoi, ${cancelledMeetings} lich hop PH)`,
        actorId: session.userId,
      });
      return { batch, cancelledSessions: cancelled.count, cancelledMeetings };
    },
  );
}

export async function cancelTeacherLiteSession(
  session: RequestSession,
  input: TeacherLiteSessionCancelInput,
) {
  return withRls(
    { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin },
    async (tx) => {
      const before = await tx.classSession.findUniqueOrThrow({
        where: { id: input.sessionId },
        select: {
          id: true,
          facilityId: true,
          classBatchId: true,
          sessionDate: true,
          startTime: true,
          endTime: true,
          status: true,
        },
      });
      assertFacilityAccess(session, before.facilityId);
      if (before.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Buoi hoc da o trang thai huy' });
      }

      const cancelled = await tx.classSession.update({
        where: { id: before.id },
        data: { status: 'cancelled' },
      });
      await logStatusChange(
        tx,
        { facilityId: before.facilityId, entityType: 'class_session', entityId: before.id, actorId: session.userId },
        'status',
        before.status,
        'cancelled',
      );
      await logEvent(tx, {
        facilityId: before.facilityId,
        entityType: 'class_batch',
        entityId: before.classBatchId,
        type: 'note',
        body: `Teacher Lite huy buoi ${dateKey(before.sessionDate)} ${before.startTime}-${before.endTime}: ${input.reason}`,
        actorId: session.userId,
      });
      return cancelled;
    },
  );
}
