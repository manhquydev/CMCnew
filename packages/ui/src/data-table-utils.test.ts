import { describe, it, expect } from 'vitest';
import { applySearch, applySort, paginate, pageCount } from './data-table-utils.js';

type Row = { name: string; age: number };

const rows: Row[] = [
  { name: 'Châu', age: 30 },
  { name: 'An', age: 20 },
  { name: 'Bình', age: 25 },
];

describe('applySearch', () => {
  it('returns all rows for empty query', () => {
    expect(applySearch(rows, '   ', (r) => r.name)).toHaveLength(3);
  });
  it('filters case-insensitively on accessor text', () => {
    const out = applySearch(rows, 'an', (r) => r.name);
    expect(out.map((r) => r.name)).toEqual(['An']);
  });
});

describe('applySort', () => {
  it('returns input unchanged when no accessor', () => {
    expect(applySort(rows, undefined, 'asc')).toBe(rows);
  });
  it('sorts numbers ascending and descending without mutating input', () => {
    const asc = applySort(rows, (r) => r.age, 'asc');
    expect(asc.map((r) => r.age)).toEqual([20, 25, 30]);
    const desc = applySort(rows, (r) => r.age, 'desc');
    expect(desc.map((r) => r.age)).toEqual([30, 25, 20]);
    expect(rows[0]?.age).toBe(30); // original order preserved
  });
});

describe('paginate / pageCount', () => {
  it('slices the requested page', () => {
    expect(paginate(rows, 2, 2).map((r) => r.name)).toEqual(['Bình']);
  });
  it('computes at least one page', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(45, 20)).toBe(3);
  });
});
