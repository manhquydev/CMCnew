import { TRPCError } from '@trpc/server';

// Same ICT offset convention as apps/api/src/lib/exercise-open.ts (ICT_OFFSET_HOURS). Not
// exported there, so it's duplicated here rather than modifying that file (owned by a
// different, already-shipped phase) — attendance.ts already does the same (see its own
// ICT_OFFSET_HOURS constant).
const ICT_OFFSET_HOURS = 7;
const FIFTEEN_MINUTES_MS = 15 * 60_000;

/** Mirrors sessionEndUtc's Date.UTC construction, but for the session's start instant. */
function sessionStartUtc(sessionDate: Date, startTime: string): Date {
  const [hourRaw, minuteRaw] = startTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid session start time: ${startTime}`);
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

/**
 * The attendance-marking window for a session: opens 15 minutes before its scheduled start,
 * closes at the end of its ICT calendar day (24:00 ICT = 17:00 UTC of the same UTC date, since
 * `sessionDate` is stored as UTC-midnight of the ICT date).
 */
export function attendanceWindowFor(sessionDate: Date, startTime: string): { opensAt: Date; closesAt: Date } {
  const opensAt = new Date(sessionStartUtc(sessionDate, startTime).getTime() - FIFTEEN_MINUTES_MS);
  const closesAt = new Date(Date.UTC(
    sessionDate.getUTCFullYear(),
    sessionDate.getUTCMonth(),
    sessionDate.getUTCDate(),
    17, 0, 0, 0,
  ));
  return { opensAt, closesAt };
}

/** Throws BAD_REQUEST when `now` falls outside the session's attendance window. Server-side —
 * the source of truth; a UI mirror only disables the button as a convenience (KISS, duplicated
 * client-side rather than shared, since the server helper imports TRPCError). */
export function assertAttendanceWindowOpen(now: Date, sessionDate: Date, startTime: string): void {
  const { opensAt, closesAt } = attendanceWindowFor(sessionDate, startTime);
  if (now.getTime() < opensAt.getTime() || now.getTime() > closesAt.getTime()) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Ngoài giờ điểm danh (mở từ 15 phút trước giờ học đến hết ngày)',
    });
  }
}
