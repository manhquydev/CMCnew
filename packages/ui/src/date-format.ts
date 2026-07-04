import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(customParseFormat);

/** Date -> 'YYYY-MM-DD' in LOCAL time (no UTC off-by-one). null -> undefined. */
export const toApiDate = (d: Date | null): string | undefined =>
  d ? dayjs(d).format('YYYY-MM-DD') : undefined;

/** Date -> 'YYYY-MM' in LOCAL time. null -> undefined. */
export const toApiMonth = (d: Date | null): string | undefined =>
  d ? dayjs(d).format('YYYY-MM') : undefined;

/** 'YYYY-MM-DD' -> Date at LOCAL midnight. empty or malformed -> null. */
export const parseApiDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = dayjs(s, 'YYYY-MM-DD');
  return d.isValid() ? d.toDate() : null;
};

/** 'YYYY-MM' -> Date at LOCAL first-of-month. empty or malformed -> null. */
export const parseApiMonth = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = dayjs(s, 'YYYY-MM');
  return d.isValid() ? d.toDate() : null;
};

/** Date|string -> 'DD/MM/YYYY' for display. */
export const fmtDate = (d: string | Date): string => dayjs(d).format('DD/MM/YYYY');
