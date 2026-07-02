import { TRPCError } from '@trpc/server';
import type { Prisma } from '@cmc/db';

const ICT_OFFSET_HOURS = 7;

export function sessionEndUtc(sessionDate: Date, endTime: string): Date {
  const [hourRaw, minuteRaw] = endTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid session end time: ${endTime}`);
  }
  return new Date(Date.UTC(
    sessionDate.getUTCFullYear(),
    sessionDate.getUTCMonth(),
    sessionDate.getUTCDate(),
    hour - ICT_OFFSET_HOURS,
    minute,
    0,
    0,
  ));
}

export function sessionHasEnded(sessionDate: Date, endTime: string, now: Date = new Date()): boolean {
  return sessionEndUtc(sessionDate, endTime).getTime() <= now.getTime();
}

export async function openedUnitIdsFor(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumUnitId: { not: null },
      batch: {
        enrollments: {
          some: {
            studentId: { in: studentIds },
            status: 'active',
            archivedAt: null,
          },
        },
      },
    },
    select: { curriculumUnitId: true, sessionDate: true, endTime: true },
  });
  return [...new Set(
    sessions
      .filter((s) => s.curriculumUnitId && sessionHasEnded(s.sessionDate, s.endTime, now))
      .map((s) => s.curriculumUnitId!),
  )];
}

export async function assertExerciseOpenForStudent(
  tx: Prisma.TransactionClient,
  exerciseId: string,
  studentId: string,
  now: Date = new Date(),
) {
  const exercise = await tx.exercise.findUniqueOrThrow({
    where: { id: exerciseId },
    select: { id: true, status: true, curriculumUnitId: true },
  });
  if (exercise.status !== 'published') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Bài tập chưa được công bố' });
  }

  const sessions = await tx.classSession.findMany({
    where: {
      status: { not: 'cancelled' },
      curriculumUnitId: exercise.curriculumUnitId,
      batch: {
        enrollments: {
          some: {
            studentId,
            status: 'active',
            archivedAt: null,
          },
        },
      },
    },
    select: { facilityId: true, sessionDate: true, endTime: true },
  });
  const openedSession = sessions.find((s) => sessionHasEnded(s.sessionDate, s.endTime, now));
  if (!openedSession) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Bài tập chưa mở cho học sinh này' });
  }

  return { exercise, facilityId: openedSession.facilityId };
}
