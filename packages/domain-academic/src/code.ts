/** Class batch code: B-YYYY-NNNN (per facility, per year). The atomic sequence
 * increment lives in a DB transaction; this only formats + guards overflow. */
export function formatBatchCode(year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
  if (seq > 9999) throw new Error(`Batch sequence overflow (>9999) for year ${year}`);
  return `B-${year}-${String(seq).padStart(4, '0')}`;
}
