import { describe, it, expect } from 'vitest';
import {
  programWeights,
  qualitativeScore,
  quantitativeScore,
  computeFinalGrade,
  scoreToPercent,
  gradeFromPercent,
  type QuantFormula,
  type Threshold,
} from './grading.js';

const FORMULA: QuantFormula = { homework: 0.5, test: 0.3, attendance: 0.2 };

describe('programWeights', () => {
  it('matches the charter split per program', () => {
    expect(programWeights('UCREA')).toEqual({ qualitative: 1, quantitative: 0 });
    expect(programWeights('BRIGHT_IG')).toEqual({ qualitative: 0.6, quantitative: 0.4 });
    expect(programWeights('BLACK_HOLE')).toEqual({ qualitative: 0.3, quantitative: 0.7 });
  });
});

describe('qualitativeScore', () => {
  it('averages pillar scores', () => {
    expect(qualitativeScore({ creativity: 8, focus: 6, teamwork: 10 })).toBe(8);
  });
  it('returns null when there are no pillars', () => {
    expect(qualitativeScore({})).toBeNull();
  });
  it('clamps pillar values into 0..10', () => {
    expect(qualitativeScore({ a: 12, b: -4 })).toBe(5); // (10 + 0) / 2
  });
});

describe('quantitativeScore', () => {
  it('blends present components by weight', () => {
    // 0.5*8 + 0.3*6 + 0.2*(1.0*10) = 4 + 1.8 + 2 = 7.8
    expect(quantitativeScore({ homeworkAvg: 8, testScore: 6, attendanceRate: 1 }, FORMULA)).toBe(7.8);
  });
  it('renormalises over present components when one is missing', () => {
    // no test → (0.5*8 + 0.2*10) / (0.5+0.2) = 6 / 0.7 = 8.57
    expect(quantitativeScore({ homeworkAvg: 8, attendanceRate: 1 }, FORMULA)).toBe(8.57);
  });
  it('returns null when nothing is present', () => {
    expect(quantitativeScore({}, FORMULA)).toBeNull();
  });
});

describe('computeFinalGrade', () => {
  const quant = { homeworkAvg: 8, testScore: 6, attendanceRate: 1 }; // → quant 7.8

  it('UCREA = qualitative only, quant ignored', () => {
    const r = computeFinalGrade({ program: 'UCREA', qualitativeScore: 9, quant, formula: FORMULA });
    expect(r.finalScore).toBe(9);
    expect(r.passed).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('UCREA without a qualitative assessment is incomplete', () => {
    const r = computeFinalGrade({ program: 'UCREA', qualitativeScore: null, quant, formula: FORMULA });
    expect(r.finalScore).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('BRIGHT_IG = 60% qualitative + 40% quantitative', () => {
    // 0.6*8 + 0.4*7.8 = 4.8 + 3.12 = 7.92
    const r = computeFinalGrade({ program: 'BRIGHT_IG', qualitativeScore: 8, quant, formula: FORMULA });
    expect(r.quantitative).toBe(7.8);
    expect(r.finalScore).toBe(7.92);
    expect(r.complete).toBe(true);
  });

  it('BLACK_HOLE = 30% qualitative + 70% quantitative', () => {
    // 0.3*4 + 0.7*7.8 = 1.2 + 5.46 = 6.66
    const r = computeFinalGrade({ program: 'BLACK_HOLE', qualitativeScore: 4, quant, formula: FORMULA });
    expect(r.finalScore).toBe(6.66);
  });

  it('flags incomplete (provisional) when a weighted part is missing but still blends present parts', () => {
    const r = computeFinalGrade({ program: 'BRIGHT_IG', qualitativeScore: 8, quant: {}, formula: FORMULA });
    expect(r.quantitative).toBeNull();
    expect(r.finalScore).toBe(8); // renormalised over the qualitative part alone
    expect(r.complete).toBe(false);
  });

  it('pass boundary is inclusive at the pass mark', () => {
    expect(computeFinalGrade({ program: 'UCREA', qualitativeScore: 5, quant, formula: FORMULA }).passed).toBe(true);
    expect(computeFinalGrade({ program: 'UCREA', qualitativeScore: 4.99, quant, formula: FORMULA }).passed).toBe(false);
  });
});

describe('thresholds', () => {
  const THR: Threshold[] = [
    { minPercent: 0, maxPercent: 49, grade: 'F', result: 'fail' },
    { minPercent: 50, maxPercent: 79, grade: 'B', result: 'pass' },
    { minPercent: 80, maxPercent: 100, grade: 'A', result: 'pass' },
  ];
  it('scoreToPercent scales by max', () => {
    expect(scoreToPercent(8)).toBe(80);
    expect(scoreToPercent(5, 0)).toBe(0);
  });
  it('maps a percent to its band (inclusive bounds)', () => {
    expect(gradeFromPercent(85, THR)?.grade).toBe('A');
    expect(gradeFromPercent(50, THR)?.grade).toBe('B');
    expect(gradeFromPercent(49, THR)?.grade).toBe('F');
    expect(gradeFromPercent(100, THR)?.grade).toBe('A');
  });
  it('returns null when no band matches', () => {
    expect(gradeFromPercent(60, [{ minPercent: 80, maxPercent: 100, grade: 'A', result: 'pass' }])).toBeNull();
  });
});
