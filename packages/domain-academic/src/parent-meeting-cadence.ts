// Parent-meeting auto-cadence (spec docs/specs/parent-meeting.md, charter §4).
// Meetings recur per program from the class start date; this pure function computes the schedule.
// Kept dependency-free so it unit-tests without a DB.

/** Cadence interval in months, by program. An unknown program yields no meetings. */
export const PARENT_MEETING_CADENCE_MONTHS: Record<string, number> = {
  UCREA: 5,
  BRIGHT_IG: 3,
  BLACK_HOLE: 3,
};

/**
 * Add whole months on a UTC-date basis (matches @db.Date; no local-tz drift). Clamps the day to the
 * target month's last day so a month-end start does not roll forward and drift: Jan 31 + 1mo → Feb 28,
 * not Mar 3. Keeps every meeting in its intended month.
 */
function addMonthsUtc(base: Date, months: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(base.getUTCDate(), lastDayOfTarget)));
}

export interface CadenceInput {
  program: string;
  startDate: Date;
  /** Class end; meetings past this are not generated. Null = open-ended (use horizonEnd only). */
  endDate?: Date | null;
  /** Upper bound for rolling generation (e.g. now + 12 months). */
  horizonEnd: Date;
}

/**
 * Meeting dates for one class: startDate + N×interval (N=1,2,…), up to min(endDate, horizonEnd).
 * The first meeting is one interval AFTER the start, not on the opening day. Deterministic, so
 * re-running and de-duplicating by date is idempotent.
 */
export function parentMeetingSchedule(input: CadenceInput): Date[] {
  const months = PARENT_MEETING_CADENCE_MONTHS[input.program];
  if (!months || months <= 0) return [];
  const limit =
    input.endDate && input.endDate.getTime() < input.horizonEnd.getTime() ? input.endDate : input.horizonEnd;
  const dates: Date[] = [];
  for (let n = 1; ; n++) {
    const at = addMonthsUtc(input.startDate, n * months);
    if (at.getTime() > limit.getTime()) break;
    dates.push(at);
    if (n > 1000) break; // safety backstop against a degenerate interval
  }
  return dates;
}
