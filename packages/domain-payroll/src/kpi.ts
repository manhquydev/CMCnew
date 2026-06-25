/** Weighted-composite KPI engine (decision 0011). Both teacher (4 criteria) and sales KPI reduce
 *  to a set of {weight, score} components → a single 0..100 score + a breakdown for transparency.
 *  Pure + tested; the router fills component scores from real data, this does the arithmetic. */

export interface KpiCriterion {
  /** Stable key, e.g. 'teaching_quality' | 'retention' | 'homeroom' | 'compliance'. */
  criterion: string;
  /** Weight in [0,1]; weights across criteria should sum to 1 (validated). */
  weight: number;
  /** Component score in [0,100]. */
  score: number;
}

export interface KpiComposite {
  score: number; // 0..100, rounded to 2 decimals
  breakdown: KpiCriterion[];
}

const EPSILON = 1e-6;

/** Combine weighted criteria into a single 0..100 score. Weights must sum to 1 (±1e-6). */
export function weightedKpi(criteria: KpiCriterion[]): KpiComposite {
  if (criteria.length === 0) throw new Error('weightedKpi needs at least one criterion');
  let weightSum = 0;
  let acc = 0;
  for (const c of criteria) {
    if (c.weight < 0 || c.weight > 1) throw new Error(`weight out of range for ${c.criterion}: ${c.weight}`);
    if (c.score < 0 || c.score > 100) throw new Error(`score out of range for ${c.criterion}: ${c.score}`);
    weightSum += c.weight;
    acc += c.weight * c.score;
  }
  if (Math.abs(weightSum - 1) > EPSILON) throw new Error(`criterion weights must sum to 1, got ${weightSum}`);
  return { score: Math.round(acc * 100) / 100, breakdown: criteria };
}

/** Convert a 0..1 ratio (e.g. retention %, on-time %) to a 0..100 KPI component score.
 *  Ratios above 1 clamp to 100 (you can't exceed full marks for "% of students retained"). */
export function ratioToScore(ratio: number): number {
  if (ratio < 0) throw new Error('ratio must be >= 0');
  return Math.min(100, Math.round(ratio * 100 * 100) / 100);
}
