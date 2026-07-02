import { describe, it, expect } from 'vitest';
import { csvText } from '../src/routers/finance.js';

// Unit test for the revenueReportCsv formula-injection guard (P3, decision documented at
// finance.ts:csvText). Course/facility codes are staff-entered free text (course.create has no
// character restriction), so a code itself — not just the entity name — could start with a
// guarded char; the guard covers the whole label unconditionally, not just the name portion.
describe('finance.csvText — CSV formula-injection guard', () => {
  it.each(['=SUM(A1:A9)', '+1+1', '-2+3', '@SUM(1)'])('prefixes a leading %s with a quote', (value) => {
    expect(csvText(value)).toBe(`'${value}`);
  });

  it('leaves an ordinary label untouched', () => {
    expect(csvText('HQ — Cơ sở chính')).toBe('HQ — Cơ sở chính');
  });

  it('quotes a cell containing a comma, and doubles embedded double-quotes', () => {
    expect(csvText('HQ, chi nhánh')).toBe('"HQ, chi nhánh"');
    expect(csvText('Khóa "VIP"')).toBe('"Khóa ""VIP"""');
  });

  it('applies both the leading-char guard and comma-quoting together', () => {
    expect(csvText('=SUM(1), oops')).toBe('"\'=SUM(1), oops"');
  });
});
