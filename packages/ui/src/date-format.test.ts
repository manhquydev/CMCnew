import { describe, expect, it } from 'vitest';
import { fmtDate, parseApiDate, parseApiMonth, toApiDate, toApiMonth } from './date-format.js';

describe('date-format', () => {
  it('toApiDate formats a Date as YYYY-MM-DD in local time', () => {
    expect(toApiDate(new Date(2026, 5, 15))).toBe('2026-06-15');
  });

  it('toApiDate returns undefined for null', () => {
    expect(toApiDate(null)).toBeUndefined();
  });

  it('round-trips a date string with no day shift', () => {
    expect(toApiDate(parseApiDate('2026-06-15'))).toBe('2026-06-15');
  });

  it('toApiMonth formats a Date as YYYY-MM in local time', () => {
    expect(toApiMonth(new Date(2026, 5, 1))).toBe('2026-06');
  });

  it('round-trips a month string with no shift', () => {
    expect(toApiMonth(parseApiMonth('2026-06'))).toBe('2026-06');
  });

  it('parseApiDate returns null for empty/undefined/null', () => {
    expect(parseApiDate('')).toBeNull();
    expect(parseApiDate(undefined)).toBeNull();
    expect(parseApiDate(null)).toBeNull();
  });

  it('parseApiDate produces local-midnight components with no UTC rollback', () => {
    const d = parseApiDate('2026-06-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(15);
  });

  it('parseApiDate produces exact local midnight (00:00), not a UTC-parsed time-of-day', () => {
    // Catches a regression to native `new Date(s)` (UTC-string parse) regardless of which
    // side of UTC the pinned test TZ sits on — a UTC-parsed date would carry a non-zero
    // time-of-day here instead of true local midnight.
    const d = parseApiDate('2026-06-15')!;
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('parseApiDate/parseApiMonth return null for malformed input', () => {
    expect(parseApiDate('not-a-date')).toBeNull();
    expect(parseApiMonth('not-a-month')).toBeNull();
  });

  it('fmtDate renders DD/MM/YYYY for display', () => {
    expect(fmtDate('2026-06-15')).toBe('15/06/2026');
    expect(fmtDate(new Date(2026, 5, 15))).toBe('15/06/2026');
  });
});
