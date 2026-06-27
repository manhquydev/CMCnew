import { describe, it, expect } from 'vitest';
import { parentMeetingSchedule } from './parent-meeting-cadence.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('parentMeetingSchedule', () => {
  it('UCREA recurs every 5 months from the start date (first meeting one interval out)', () => {
    const dates = parentMeetingSchedule({ program: 'UCREA', startDate: d('2026-01-10'), horizonEnd: d('2027-01-10') });
    // 2026-06-10, 2026-11-10 within the 12-month horizon; 2027-04-10 is past it.
    expect(dates.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-06-10', '2026-11-10']);
  });

  it('Bright I.G / Black Hole recur every 3 months', () => {
    const ig = parentMeetingSchedule({ program: 'BRIGHT_IG', startDate: d('2026-01-01'), horizonEnd: d('2026-12-31') });
    expect(ig.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-04-01', '2026-07-01', '2026-10-01']); // Jan-2027 past horizon
    expect(parentMeetingSchedule({ program: 'BLACK_HOLE', startDate: d('2026-01-01'), horizonEnd: d('2026-12-31') })).toHaveLength(3);
  });

  it('stops at endDate when the class ends before the horizon', () => {
    const dates = parentMeetingSchedule({ program: 'UCREA', startDate: d('2026-01-10'), endDate: d('2026-07-01'), horizonEnd: d('2027-01-10') });
    expect(dates.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-06-10']); // 2026-11-10 is past endDate
  });

  it('clamps a month-end start to the target month end (no roll-forward drift)', () => {
    // Jan 31 + 3mo must land on Apr 30 (not May 1), and the next on Jul 31 — day does not drift.
    const dates = parentMeetingSchedule({ program: 'BRIGHT_IG', startDate: d('2026-01-31'), horizonEnd: d('2026-12-31') });
    expect(dates.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-04-30', '2026-07-31', '2026-10-31']);
  });

  it('includes a meeting that lands exactly on the horizon end (inclusive bound)', () => {
    // start + 3mo == horizonEnd → included.
    const dates = parentMeetingSchedule({ program: 'BRIGHT_IG', startDate: d('2026-01-15'), horizonEnd: d('2026-04-15') });
    expect(dates.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-04-15']);
  });

  it('open-ended class (no endDate) is bounded only by the horizon', () => {
    const dates = parentMeetingSchedule({ program: 'UCREA', startDate: d('2026-01-10'), endDate: null, horizonEnd: d('2027-06-24') });
    expect(dates.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-06-10', '2026-11-10', '2027-04-10']);
  });

  it('an unknown program produces no meetings', () => {
    expect(parentMeetingSchedule({ program: 'OTHER', startDate: d('2026-01-01'), horizonEnd: d('2030-01-01') })).toEqual([]);
  });
});
