import { describe, it, expect } from 'vitest';
import { weightedKpi, ratioToScore } from './kpi.js';

describe('weightedKpi — weighted composite (decision 0011)', () => {
  it('teacher 4-criteria composite (35/35/20/10)', () => {
    const out = weightedKpi([
      { criterion: 'teaching_quality', weight: 0.35, score: 80 },
      { criterion: 'retention', weight: 0.35, score: 70 },
      { criterion: 'homeroom', weight: 0.2, score: 90 },
      { criterion: 'compliance', weight: 0.1, score: 100 },
    ]);
    // 0.35*80 + 0.35*70 + 0.2*90 + 0.1*100 = 28 + 24.5 + 18 + 10 = 80.5
    expect(out.score).toBe(80.5);
    expect(out.breakdown).toHaveLength(4);
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() => weightedKpi([{ criterion: 'a', weight: 0.5, score: 50 }])).toThrow();
  });

  it('rejects out-of-range score', () => {
    expect(() => weightedKpi([{ criterion: 'a', weight: 1, score: 120 }])).toThrow();
  });
});

describe('ratioToScore — ratio (0..1) → 0..100, clamped', () => {
  it('maps retention 0.6 → 60', () => {
    expect(ratioToScore(0.6)).toBe(60);
  });
  it('clamps above-1 ratios to 100', () => {
    expect(ratioToScore(1.2)).toBe(100);
  });
  it('rejects negatives', () => {
    expect(() => ratioToScore(-0.1)).toThrow();
  });
});
