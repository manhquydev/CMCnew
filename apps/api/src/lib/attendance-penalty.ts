export const ATTENDANCE_LATE_RATE = 500;
export const ATTENDANCE_EARLY_RATE = 1000;

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AttendanceShiftEntryRow = {
  date: Date;
  shiftTemplateId: string;
  shiftTemplate: {
    name?: string;
    startTime: string;
    endTime: string;
  };
};

export type AttendancePunchRow = {
  id?: string;
  timestamp: Date;
  method?: string;
  shiftTemplateId: string | null;
};

export type AttendanceDaySummary = {
  date: string;
  shiftTemplateId: string;
  shiftName: string | null;
  punchCount: number;
  checkIn: Date | null;
  checkOut: Date | null;
  lateMinutes: number;
  earlyMinutes: number;
  penaltyAmount: number;
};

export type AttendanceSummary = {
  workdays: number;
  lateMinutes: number;
  earlyMinutes: number;
  penaltyAmount: number;
  days: AttendanceDaySummary[];
};

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date key: ${dateKey}`);
  return { year, month, day };
}

export function ictDateKey(date: Date): string {
  return new Date(date.getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

export function dateOnlyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ictDateRange(dateKey: string): { start: Date; end: Date } {
  const { year, month, day } = parseDateKey(dateKey);
  const start = new Date(Date.UTC(year, month - 1, day) - ICT_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function ictDayRangeFor(date = new Date()): { start: Date; end: Date; dateKey: string } {
  const dateKey = ictDateKey(date);
  const { start, end } = ictDateRange(dateKey);
  return { start, end, dateKey };
}

export function ictPeriodRange(periodKey: string): { start: Date; end: Date } {
  const [year, month] = periodKey.split('-').map(Number);
  if (!year || !month) throw new Error(`Invalid period key: ${periodKey}`);
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - ICT_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - ICT_OFFSET_MS),
  };
}

export function lateMinutes(punchTime: Date, shiftStart: string): number {
  const [h, m] = shiftStart.split(':').map(Number);
  const startMinutes = (h ?? 0) * 60 + (m ?? 0);
  const localH = (punchTime.getUTCHours() + 7) % 24;
  const localM = punchTime.getUTCMinutes();
  return Math.max(0, localH * 60 + localM - startMinutes);
}

export function earlyLeaveMinutes(punchTime: Date, shiftEnd: string): number {
  const [h, m] = shiftEnd.split(':').map(Number);
  const endMinutes = (h ?? 0) * 60 + (m ?? 0);
  const localH = (punchTime.getUTCHours() + 7) % 24;
  const localM = punchTime.getUTCMinutes();
  return Math.max(0, endMinutes - (localH * 60 + localM));
}

export function attendancePenaltyAmount(late: number, early: number): number {
  return late * ATTENDANCE_LATE_RATE + early * ATTENDANCE_EARLY_RATE;
}

export function summarizeAttendance(
  entries: AttendanceShiftEntryRow[],
  punches: AttendancePunchRow[],
): AttendanceSummary {
  const punchesByDay = new Map<string, AttendancePunchRow[]>();
  for (const punch of punches) {
    const key = ictDateKey(punch.timestamp);
    const bucket = punchesByDay.get(key) ?? [];
    bucket.push(punch);
    punchesByDay.set(key, bucket);
  }
  for (const bucket of punchesByDay.values()) bucket.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const entryCountByDate = new Map<string, number>();
  for (const entry of entries) {
    const date = dateOnlyKey(entry.date);
    entryCountByDate.set(date, (entryCountByDate.get(date) ?? 0) + 1);
  }

  const days = entries.map((entry) => {
    const date = dateOnlyKey(entry.date);
    const dayPunches = punchesByDay.get(date) ?? [];
    const exact = dayPunches.filter((p) => p.shiftTemplateId === entry.shiftTemplateId);
    const matched = exact.length > 0 ? exact : entryCountByDate.get(date) === 1 ? dayPunches : [];
    const checkIn = matched[0]?.timestamp ?? null;
    const checkOut = matched.length >= 2 ? matched[matched.length - 1]!.timestamp : null;
    const late = checkIn ? lateMinutes(checkIn, entry.shiftTemplate.startTime) : 0;
    const early = checkOut ? earlyLeaveMinutes(checkOut, entry.shiftTemplate.endTime) : 0;
    return {
      date,
      shiftTemplateId: entry.shiftTemplateId,
      shiftName: entry.shiftTemplate.name ?? null,
      punchCount: matched.length,
      checkIn,
      checkOut,
      lateMinutes: late,
      earlyMinutes: early,
      penaltyAmount: attendancePenaltyAmount(late, early),
    };
  });

  return {
    workdays: entries.length,
    lateMinutes: days.reduce((sum, d) => sum + d.lateMinutes, 0),
    earlyMinutes: days.reduce((sum, d) => sum + d.earlyMinutes, 0),
    penaltyAmount: days.reduce((sum, d) => sum + d.penaltyAmount, 0),
    days,
  };
}
