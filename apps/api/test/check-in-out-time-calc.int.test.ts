import { describe, it, expect } from 'vitest';
import { lateMinutes, earlyLeaveMinutes } from '../src/routers/check-in-out.js';

// Pure functions — no DB needed. Named *.int.test.ts to match the existing
// vitest.integration.config.ts include pattern (test/**/*.int.test.ts), the only
// runner wired up in this package (see test:int in package.json).
describe('check-in-out time-penalty math (VN local = UTC+7)', () => {
  it('lateMinutes is 0 exactly at shift start and grows for arrivals after it', () => {
    expect(lateMinutes(new Date('2099-01-01T15:00:00Z'), '22:00')).toBe(0);
    expect(lateMinutes(new Date('2099-01-01T15:15:00Z'), '22:00')).toBe(15);
    expect(lateMinutes(new Date('2099-01-01T16:30:00Z'), '22:00')).toBe(90);
  });

  it('lateMinutes is 0 for an early arrival (never negative)', () => {
    expect(lateMinutes(new Date('2099-01-01T14:45:00Z'), '22:00')).toBe(0);
  });

  it('earlyLeaveMinutes is 0 exactly at shift end and grows for check-outs before it', () => {
    expect(earlyLeaveMinutes(new Date('2099-01-01T16:00:00Z'), '23:00')).toBe(0);
    expect(earlyLeaveMinutes(new Date('2099-01-01T15:40:00Z'), '23:00')).toBe(20);
  });

  it('earlyLeaveMinutes is 0 for a check-out after shift end (never negative)', () => {
    expect(earlyLeaveMinutes(new Date('2099-01-01T16:30:00Z'), '23:00')).toBe(0);
  });
});
