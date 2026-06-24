import { z } from 'zod';

/** Tunable compensation parameters — the editable body of a CompensationPolicy version
 *  (docs/specs/payroll-v2-commission-design.md, CV1). Stored as JSON on `compensation_policy`,
 *  validated by `compensationParamsSchema`, read by the pure payroll functions. Admin edits create
 *  a NEW effective-dated version; payslip compute reads the version effective at the period, so
 *  edits apply forward only (finalized payslips keep their frozen numbers).
 *
 *  Design note: rate VALUES + bands are data (editable); tier BREAKPOINTS for commission
 *  (quota % thresholds 50/80/100/120/150) stay as code logic in commission.ts — they are stable
 *  policy structure, while the percentages are what gets tuned. KPI/PIT bands are fully data-driven. */

const taxBracketSchema = z.object({
  upTo: z.number().int().positive().nullable(), // null = top (no upper bound)
  rate: z.number().min(0).max(1),
});

const kpiBandSchema = z.object({
  minScore: z.number().min(0).max(100), // inclusive lower bound; bands evaluated high→low
  grade: z.string().min(1),
  ratio: z.number().min(0).max(1),
});

export const compensationParamsSchema = z.object({
  pit: z.object({
    brackets: z.array(taxBracketSchema).min(1),
    selfRelief: z.number().int().nonnegative(),
    dependentRelief: z.number().int().nonnegative(),
  }),
  kpi: z.object({
    training: z.array(kpiBandSchema).min(1),
    sales: z.array(kpiBandSchema).min(1),
  }),
  commission: z.object({
    /** CVTV new-customer rates at the fixed quota breakpoints [<50,50-80,80-100,100-120,120-150,>150]. */
    cvtvNewRates: z.array(z.number().min(0).max(1)).length(6),
    /** TPKD new rates at breakpoints [<80,80-100,100-120,120-150,>150]. */
    tpkdNewRates: z.array(z.number().min(0).max(1)).length(5),
    /** GĐTT new rates at breakpoints [<80,80-100,100-120,120-150,>150]. */
    gdttNewRates: z.array(z.number().min(0).max(1)).length(5),
    /** Flat renewal rate per role, applied when centre retention ≥ retentionFloor. */
    renewal: z.object({
      cvtv: z.number().min(0).max(1),
      tpkd: z.number().min(0).max(1),
      gdtt: z.number().min(0).max(1),
      gv: z.number().min(0).max(1),
      cskh: z.number().min(0).max(1),
    }),
    retentionFloor: z.number().min(0).max(1),
    /** Commission budget cap as a fraction of real revenue (PA2: ≤6%) — advisory warning. */
    budgetPct: z.number().min(0).max(1),
  }),
  /** Teaching overtime unit price (VND/hour) by teacher grade. */
  overtimeRates: z.record(z.string(), z.number().int().nonnegative()),
  /** Part-time package flat monthly gross (VND) by package code. */
  parttimePackages: z.record(z.string(), z.number().int().nonnegative()),
});

export type CompensationParams = z.infer<typeof compensationParamsSchema>;

/** Seed defaults: PA2 (sales) + the signed teaching decision. Used when no policy version exists
 *  and as the fallback for the pure functions. NOTE: the SALES KPI band is PROVISIONAL — PA2's
 *  source KPI tables are internally inconsistent; admin should confirm/edit it in the policy UI. */
export const DEFAULT_PARAMS: CompensationParams = {
  pit: {
    brackets: [
      { upTo: 5_000_000, rate: 0.05 },
      { upTo: 10_000_000, rate: 0.1 },
      { upTo: 18_000_000, rate: 0.15 },
      { upTo: 32_000_000, rate: 0.2 },
      { upTo: 52_000_000, rate: 0.25 },
      { upTo: 80_000_000, rate: 0.3 },
      { upTo: null, rate: 0.35 },
    ],
    selfRelief: 11_000_000,
    dependentRelief: 4_400_000,
  },
  kpi: {
    training: [
      { minScore: 85, grade: 'A', ratio: 1.0 },
      { minScore: 70, grade: 'B', ratio: 0.9 },
      { minScore: 50, grade: 'C', ratio: 0.8 },
      { minScore: 0, grade: 'D', ratio: 0 },
    ],
    // PROVISIONAL (PA2 appendix: A 90-100→100%, B 70-<90→90%; C/D inferred). Admin to confirm.
    sales: [
      { minScore: 90, grade: 'A', ratio: 1.0 },
      { minScore: 70, grade: 'B', ratio: 0.9 },
      { minScore: 50, grade: 'C', ratio: 0.7 },
      { minScore: 0, grade: 'D', ratio: 0 },
    ],
  },
  commission: {
    cvtvNewRates: [0, 0.01, 0.02, 0.03, 0.04, 0.045],
    tpkdNewRates: [0, 0.006, 0.01, 0.012, 0.015],
    gdttNewRates: [0, 0.004, 0.006, 0.008, 0.01],
    renewal: { cvtv: 0.022, tpkd: 0.005, gdtt: 0.005, gv: 0.01, cskh: 0.008 },
    retentionFloor: 0.5,
    budgetPct: 0.06,
  },
  overtimeRates: { B1: 100_000, B2: 120_000, B3: 130_000, B4: 150_000 },
  parttimePackages: { PT3: 3_000_000, PT4: 4_000_000, PT5: 5_000_000 },
};
