import { describe, it, expect } from 'vitest';
import { formatBatchCode, PROGRAM_CODE_ABBREV } from './code.js';

describe('formatBatchCode', () => {
  it('formats [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN] for all 3 programs', () => {
    expect(formatBatchCode('HQ', 'UCREA', 2026, 1)).toBe('HQ-UCR-26-0001');
    expect(formatBatchCode('CS2', 'BRIGHT_IG', 2026, 3)).toBe('CS2-BIG-26-0003');
    expect(formatBatchCode('HQ', 'BLACK_HOLE', 2027, 1)).toBe('HQ-BH-27-0001');
  });

  it('uses the fixed 3-value program abbreviation map', () => {
    expect(PROGRAM_CODE_ABBREV).toEqual({ UCREA: 'UCR', BRIGHT_IG: 'BIG', BLACK_HOLE: 'BH' });
  });

  it('pads year to 2 digits and sequence to 4 digits', () => {
    expect(formatBatchCode('HQ', 'UCREA', 2005, 1)).toBe('HQ-UCR-05-0001');
  });

  it('rejects non-positive-integer sequence', () => {
    expect(() => formatBatchCode('HQ', 'UCREA', 2026, 0)).toThrow();
    expect(() => formatBatchCode('HQ', 'UCREA', 2026, 1.5)).toThrow();
  });

  it('guards sequence overflow beyond 9999', () => {
    expect(() => formatBatchCode('HQ', 'UCREA', 2026, 10000)).toThrow(/overflow/);
  });
});
