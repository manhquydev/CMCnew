/** Mirrors the `Program` enum in schema.prisma. Kept as a local string union
 * (not imported from @cmc/db) so this package stays free of a Prisma dep. */
export type ClassProgram = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

/** Fixed 3-value abbreviation used in class batch codes. */
export const PROGRAM_CODE_ABBREV: Record<ClassProgram, string> = {
  UCREA: 'UCR',
  BRIGHT_IG: 'BIG',
  BLACK_HOLE: 'BH',
};

/** Fixed ordering for advisory-lock key encoding (see nextBatchCode). */
export const PROGRAM_ORDER_INDEX: Record<ClassProgram, number> = {
  UCREA: 0,
  BRIGHT_IG: 1,
  BLACK_HOLE: 2,
};

/** Class batch code: [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN] (per facility,
 * per program, per year). The atomic sequence increment lives in a DB
 * transaction; this only formats + guards overflow. */
export function formatBatchCode(
  facilityCode: string,
  program: ClassProgram,
  year: number,
  seq: number,
): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
  if (seq > 9999) throw new Error(`Batch sequence overflow (>9999) for year ${year}`);
  const yy = String(year).slice(-2).padStart(2, '0');
  return `${facilityCode}-${PROGRAM_CODE_ABBREV[program]}-${yy}-${String(seq).padStart(4, '0')}`;
}
