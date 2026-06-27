/* Pure data helpers for DataTable. Extracted so search/sort/paginate logic is
   unit-testable in a node environment (no DOM needed). */

export type SortDir = 'asc' | 'desc';

export function applySearch<T>(
  rows: T[],
  query: string,
  getText: (row: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => getText(r).toLowerCase().includes(q));
}

export function applySort<T>(
  rows: T[],
  getValue: ((row: T) => unknown) | undefined,
  dir: SortDir,
): T[] {
  if (!getValue) return rows;
  const sorted = [...rows].sort((a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return -1;
    if (bv == null) return 1;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), 'vi');
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return rows;
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
