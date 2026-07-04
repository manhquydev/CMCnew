import { describe, it, expect } from 'vitest';
import { ictDateKey, ictDateRange, ictDayRangeFor } from '../src/lib/attendance-penalty.js';

// Pure functions — no DB needed. Plain *.test.ts (picked up by the default vitest
// config only) matches how permission-parity.test.ts / brevo-client.test.ts are run.
describe('attendance ICT day-boundary (GMT+7) — day-reset correctness', () => {
  it('16:59Z (=23:59 ICT) and 17:01Z (=00:01 ICT next day) resolve to different dateKeys', () => {
    const lateNight = new Date('2026-07-04T16:59:00Z');
    const justAfterMidnight = new Date('2026-07-04T17:01:00Z');
    expect(ictDateKey(lateNight)).toBe('2026-07-04');
    expect(ictDateKey(justAfterMidnight)).toBe('2026-07-05');
  });

  it('17:00:00Z is exactly the ICT midnight boundary — belongs to the new day', () => {
    expect(ictDateKey(new Date('2026-07-04T16:59:59Z'))).toBe('2026-07-04');
    expect(ictDateKey(new Date('2026-07-04T17:00:00Z'))).toBe('2026-07-05');
  });

  it('ictDateRange(dateKey) produces a [start,end) window that exactly contains only that ICT day', () => {
    const { start, end } = ictDateRange('2026-07-04');
    // 2026-07-04 00:00 ICT = 2026-07-03T17:00:00Z; 2026-07-05 00:00 ICT = 2026-07-04T17:00:00Z
    expect(start.toISOString()).toBe('2026-07-03T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-04T17:00:00.000Z');
    expect(ictDateKey(new Date(start.getTime()))).toBe('2026-07-04');
    expect(ictDateKey(new Date(end.getTime() - 1))).toBe('2026-07-04');
    expect(ictDateKey(new Date(end.getTime()))).toBe('2026-07-05'); // end is exclusive
  });

  it('ictDayRangeFor mirrors ictDateRange for "now"', () => {
    const now = new Date('2026-07-04T18:30:00Z'); // 01:30 ICT on 2026-07-05
    const { dateKey, start, end } = ictDayRangeFor(now);
    expect(dateKey).toBe('2026-07-05');
    expect(start.toISOString()).toBe(ictDateRange('2026-07-05').start.toISOString());
    expect(end.toISOString()).toBe(ictDateRange('2026-07-05').end.toISOString());
  });
});
