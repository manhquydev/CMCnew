import { describe, it, expect } from 'vitest';
import { rangesOverlap } from './time.js';
import { enumerateSessions, enumerateSessionsByCount, detectConflicts } from './schedule.js';

describe('rangesOverlap', () => {
  it('detects overlap', () => {
    expect(rangesOverlap('09:00', '10:30', '10:00', '11:00')).toBe(true);
  });
  it('treats touching ranges as non-overlap', () => {
    expect(rangesOverlap('09:00', '10:00', '10:00', '11:00')).toBe(false);
  });
});

describe('enumerateSessions', () => {
  it('expands a weekly slot across a date range', () => {
    // 2026-06-01 is a Monday (dayOfWeek 1).
    const sessions = enumerateSessions(
      [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:30' }],
      '2026-06-01',
      '2026-06-22',
    );
    expect(sessions).toHaveLength(4); // 4 Mondays
    expect(sessions[0]!.sessionDate).toBe('2026-06-01');
    expect(sessions[3]!.sessionDate).toBe('2026-06-22');
  });
});

describe('enumerateSessionsByCount', () => {
  it('produces exactly N sessions on the matching weekday, starting on/after startDate', () => {
    // 2026-06-01 is a Monday (dayOfWeek 1).
    const sessions = enumerateSessionsByCount(
      [{ dayOfWeek: 1, startTime: '18:00', endTime: '19:30' }],
      '2026-06-01',
      12,
    );
    expect(sessions).toHaveLength(12);
    expect(sessions[0]!.sessionDate).toBe('2026-06-01');
    expect(sessions[11]!.sessionDate).toBe('2026-08-17'); // 12th Monday from 2026-06-01
    for (const s of sessions) {
      expect(new Date(`${s.sessionDate}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(s.startTime).toBe('18:00');
      expect(s.endTime).toBe('19:30');
    }
  });

  it('round-robins across multiple weekly slots in ascending day-of-week order', () => {
    // 2026-06-01 is a Monday; slot on Wed (3) and Mon (1), passed out of order.
    const sessions = enumerateSessionsByCount(
      [
        { dayOfWeek: 3, startTime: '10:00', endTime: '11:00' },
        { dayOfWeek: 1, startTime: '18:00', endTime: '19:30' },
      ],
      '2026-06-01',
      4,
    );
    expect(sessions.map((s) => s.sessionDate)).toEqual([
      '2026-06-01', // Mon
      '2026-06-03', // Wed
      '2026-06-08', // Mon
      '2026-06-10', // Wed
    ]);
  });

  it('returns empty array for zero/negative count or no slots', () => {
    expect(enumerateSessionsByCount([{ dayOfWeek: 1, startTime: '18:00', endTime: '19:30' }], '2026-06-01', 0)).toHaveLength(0);
    expect(enumerateSessionsByCount([], '2026-06-01', 5)).toHaveLength(0);
  });
});

describe('detectConflicts', () => {
  it('flags same-room overlap', () => {
    const a = { sessionDate: '2026-06-01', startTime: '18:00', endTime: '19:30', roomId: 'r1', teacherId: 't1' };
    const b = { sessionDate: '2026-06-01', startTime: '19:00', endTime: '20:00', roomId: 'r1', teacherId: 't2' };
    const conflicts = detectConflicts([a, b]);
    expect(conflicts.some((c) => c.kind === 'room')).toBe(true);
    expect(conflicts.some((c) => c.kind === 'teacher')).toBe(false);
  });
  it('flags same-teacher overlap in different rooms', () => {
    const a = { sessionDate: '2026-06-01', startTime: '18:00', endTime: '19:30', roomId: 'r1', teacherId: 't1' };
    const b = { sessionDate: '2026-06-01', startTime: '19:00', endTime: '20:00', roomId: 'r2', teacherId: 't1' };
    expect(detectConflicts([a, b]).some((c) => c.kind === 'teacher')).toBe(true);
  });
  it('no conflict on different days', () => {
    const a = { sessionDate: '2026-06-01', startTime: '18:00', endTime: '19:30', roomId: 'r1', teacherId: 't1' };
    const b = { sessionDate: '2026-06-02', startTime: '18:00', endTime: '19:30', roomId: 'r1', teacherId: 't1' };
    expect(detectConflicts([a, b])).toHaveLength(0);
  });
});
