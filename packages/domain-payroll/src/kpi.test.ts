import { describe, it, expect } from 'vitest';
import { weightedKpi, ratioToScore } from './kpi.js';
import { compensationParamsSchema, DEFAULT_PARAMS } from './params.js';

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

describe('kpiCriteria in DEFAULT_PARAMS (decision 0012)', () => {
  it('DEFAULT_PARAMS validates against compensationParamsSchema', () => {
    expect(() => compensationParamsSchema.parse(DEFAULT_PARAMS)).not.toThrow();
  });

  it('sales weights sum to 1', () => {
    const sum = DEFAULT_PARAMS.kpiCriteria.sales.reduce((s, c) => s + c.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
  });

  it('training weights sum to 1', () => {
    const sum = DEFAULT_PARAMS.kpiCriteria.training.reduce((s, c) => s + c.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
  });

  it('rejects block where weights do not sum to 1', () => {
    const bad = {
      ...DEFAULT_PARAMS,
      kpiCriteria: {
        ...DEFAULT_PARAMS.kpiCriteria,
        sales: [
          { key: 'a', label: 'A', weight: 0.5 },
          { key: 'b', label: 'B', weight: 0.3 }, // sum = 0.8, not 1
        ],
      },
    };
    expect(() => compensationParamsSchema.parse(bad)).toThrow();
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
