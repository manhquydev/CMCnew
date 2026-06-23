import { describe, it, expect } from 'vitest';
import { parseCriteria, criteriaMet, evaluateBadges } from './badges.js';

describe('parseCriteria', () => {
  it('parses supported kinds', () => {
    expect(parseCriteria({ kind: 'stars_total', gte: 50 })).toEqual({ kind: 'stars_total', gte: 50 });
    expect(parseCriteria({ kind: 'homework_count', gte: 5 })).toEqual({ kind: 'homework_count', gte: 5 });
  });
  it('rejects unknown kind, missing/invalid gte, and non-objects', () => {
    expect(parseCriteria({ kind: 'streak', gte: 3 })).toBeNull();
    expect(parseCriteria({ kind: 'stars_total' })).toBeNull();
    expect(parseCriteria({ kind: 'stars_total', gte: 'x' })).toBeNull();
    expect(parseCriteria(null)).toBeNull();
    expect(parseCriteria('nope')).toBeNull();
  });
});

describe('criteriaMet', () => {
  const stats = { starsTotal: 100, homeworkCount: 5 };
  it('met at/above threshold (boundary inclusive)', () => {
    expect(criteriaMet({ kind: 'stars_total', gte: 100 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'homework_count', gte: 5 }, stats)).toBe(true);
  });
  it('not met below threshold', () => {
    expect(criteriaMet({ kind: 'stars_total', gte: 101 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'homework_count', gte: 6 }, stats)).toBe(false);
  });
});

describe('evaluateBadges', () => {
  const badges = [
    { id: 'a', unlockCriteria: { kind: 'stars_total', gte: 50 } },
    { id: 'b', unlockCriteria: { kind: 'stars_total', gte: 200 } },
    { id: 'c', unlockCriteria: { kind: 'homework_count', gte: 5 } },
    { id: 'd', unlockCriteria: { kind: 'unknown', gte: 1 } },
  ];
  it('returns ids of met badges, skipping unmet and unparseable', () => {
    expect(evaluateBadges(badges, { starsTotal: 100, homeworkCount: 5 })).toEqual(['a', 'c']);
  });
  it('empty when nothing met', () => {
    expect(evaluateBadges(badges, { starsTotal: 0, homeworkCount: 0 })).toEqual([]);
  });
});
