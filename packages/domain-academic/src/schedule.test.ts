import { describe, it, expect } from 'vitest';
import { formatBatchCode } from './code.js';
import { rangesOverlap } from './time.js';
import { enumerateSessions, detectConflicts } from './schedule.js';

describe('formatBatchCode', () => {
  it('pads to 4 digits', () => {
    expect(formatBatchCode(2026, 1)).toBe('B-2026-0001');
    expect(formatBatchCode(2026, 42)).toBe('B-2026-0042');
  });
  it('throws on overflow', () => {
    expect(() => formatBatchCode(2026, 10000)).toThrow(/overflow/);
  });
});

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
