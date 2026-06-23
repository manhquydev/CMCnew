/** Pure grading logic (charter §4–5, spec phase-02 §2.5–2.7). No DB, no IO — the routers
 * pull rows, this module decides the numbers, and is unit-tested independently.
 *
 * Scales: homework / test / qualitative scores are 0..10; attendanceRate is 0..1; percents 0..100.
 * FinalGrade blends a qualitative score and a quantitative score by per-program weights:
 *   UCREA      = 100% qualitative / 0% quantitative
 *   BRIGHT_IG  = 60% qualitative / 40% quantitative
 *   BLACK_HOLE = 30% qualitative / 70% quantitative
 * The quantitative score is itself a blend of homework/test/attendance per a template formula. */

export type Program = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp10 = (v: number) => clamp(v, 0, 10);
const clamp01 = (v: number) => clamp(v, 0, 1);
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ProgramWeights {
  qualitative: number;
  quantitative: number;
}

/** Qualitative / quantitative split per program (charter). Sums to 1. */
export function programWeights(program: Program): ProgramWeights {
  switch (program) {
    case 'UCREA':
      return { qualitative: 1, quantitative: 0 };
    case 'BRIGHT_IG':
      return { qualitative: 0.6, quantitative: 0.4 };
    case 'BLACK_HOLE':
      return { qualitative: 0.3, quantitative: 0.7 };
  }
}

/** Average the pillar scores of a QualitativeAssessment.criteria ({pillar: 0..10}). */
export function qualitativeScore(criteria: Record<string, number>): number | null {
  const vals = Object.values(criteria).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (vals.length === 0) return null;
  return round2(vals.reduce((s, v) => s + clamp10(v), 0) / vals.length);
}

export interface QuantComponents {
  homeworkAvg?: number | null; // 0..10
  testScore?: number | null; // 0..10
  attendanceRate?: number | null; // 0..1
}

/** Weights for the quantitative blend (GradingTemplate.formula). Need not sum to 1 — the blend
 * renormalises over whichever components are actually present. */
export interface QuantFormula {
  homework: number;
  test: number;
  attendance: number;
}

/** Blend present quantitative components on a 0..10 scale, renormalising weights over what exists
 * (e.g. before the first test, blend homework+attendance only). null when nothing is present. */
export function quantitativeScore(c: QuantComponents, f: QuantFormula): number | null {
  const parts: { w: number; v: number }[] = [];
  if (c.homeworkAvg != null) parts.push({ w: f.homework, v: clamp10(c.homeworkAvg) });
  if (c.testScore != null) parts.push({ w: f.test, v: clamp10(c.testScore) });
  if (c.attendanceRate != null) parts.push({ w: f.attendance, v: clamp01(c.attendanceRate) * 10 });
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  if (parts.length === 0 || wsum <= 0) return null;
  return round2(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum);
}

export interface FinalGradeInput {
  program: Program;
  qualitativeScore?: number | null; // 0..10
  quant: QuantComponents;
  formula: QuantFormula;
  passMark?: number; // 0..10; default 5
}

export interface FinalGradeResult {
  quantitative: number | null; // blended quant score 0..10 (null if no quant inputs)
  finalScore: number | null; // 0..10 (null if a required weighted part is missing)
  passed: boolean;
  complete: boolean; // every part with weight>0 had an input
}

/** Compose the FinalGrade for (student, program, period). Blends qualitative + quantitative by
 * program weight, renormalising over present parts. `complete` is false while a weighted part is
 * still missing — the caller can store a provisional finalScore but flag it as not final. */
export function computeFinalGrade(input: FinalGradeInput): FinalGradeResult {
  const w = programWeights(input.program);
  const quant = quantitativeScore(input.quant, input.formula);
  const qual = input.qualitativeScore ?? null;

  const needQual = w.qualitative > 0;
  const needQuant = w.quantitative > 0;
  const haveQual = qual != null;
  const haveQuant = quant != null;
  const complete = (!needQual || haveQual) && (!needQuant || haveQuant);

  const parts: { w: number; v: number }[] = [];
  if (needQual && haveQual) parts.push({ w: w.qualitative, v: clamp10(qual) });
  if (needQuant && haveQuant) parts.push({ w: w.quantitative, v: quant });
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  const finalScore = parts.length > 0 && wsum > 0 ? round2(parts.reduce((s, p) => s + p.w * p.v, 0) / wsum) : null;

  const passMark = input.passMark ?? 5;
  const passed = finalScore != null && finalScore >= passMark;
  return { quantitative: quant, finalScore, passed, complete };
}

export interface Threshold {
  minPercent: number; // inclusive
  maxPercent: number; // inclusive
  grade: string; // letter / band
  result: string; // pass / fail label
}

/** Convert a 0..max score to a percent. */
export function scoreToPercent(score: number, max = 10): number {
  if (max <= 0) return 0;
  return clamp((score / max) * 100, 0, 100);
}

/** Map a percent to its GradingThreshold band. First matching band wins; null if none match. */
export function gradeFromPercent(percent: number, thresholds: readonly Threshold[]): Threshold | null {
  const p = clamp(percent, 0, 100);
  return thresholds.find((t) => p >= t.minPercent && p <= t.maxPercent) ?? null;
}
