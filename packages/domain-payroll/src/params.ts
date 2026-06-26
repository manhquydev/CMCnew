import { z } from 'zod';

/** Tunable compensation parameters — the editable body of a CompensationPolicy version
 *  (docs/specs/payroll-v2-commission-design.md, CV1). Stored as JSON on `compensation_policy`,
 *  validated by `compensationParamsSchema`, read by the pure payroll functions. Admin edits create
 *  a NEW effective-dated version; payslip compute reads the version effective at the period, so
 *  edits apply forward only (finalized payslips keep their frozen numbers).
 *
 *  Source of truth: Excel "Mẫu đánh giá KPI" (nguồn chuẩn, chốt 2026-06-25). CVTV new-customer
 *  commission is by QUOTA-ATTAINMENT % (not absolute revenue — docx mâu thuẫn, Excel thắng; xem
 *  decision 0012 + bottleneck report); renewal tiered by centre retention. All rate VALUES + bands
 *  are data (editable per CompensationPolicy); KPI/PIT bands fully data-driven. */

/** Tiêu chí KPI có trọng số — một phần tử trong danh sách kpiCriteria[block].
 *  HR chỉnh qua JSON policy UI; weights trong mỗi block PHẢI sum = 1 (±1e-6). */
export const kpiCriterionConfigSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
});

export type KpiCriterionConfig = z.infer<typeof kpiCriterionConfigSchema>;

const taxBracketSchema = z.object({
  upTo: z.number().int().positive().nullable(), // null = top (no upper bound)
  rate: z.number().min(0).max(1),
});

const kpiBandSchema = z.object({
  minScore: z.number().min(0).max(100), // inclusive lower bound; bands evaluated high→low
  grade: z.string().min(1),
  ratio: z.number().min(0).max(1),
});

/** Renewal commission tier — rate applies when centre retention ratio ≥ minRetention (0..1+). */
const retentionTierSchema = z.object({
  minRetention: z.number().min(0),
  rate: z.number().min(0).max(1),
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
    /** CVTV new-customer commission by QUOTA-ATTAINMENT % (Excel "Mẫu đánh giá KPI kinh doanh",
     *  PHỤ LỤC 02: "Theo tỷ lệ hoàn thành chỉ tiêu của cá nhân"; Excel là nguồn chuẩn — chốt
     *  2026-06-25). Rates at the 6 fixed quota breakpoints [<50%,50-80%,80-100%,100-120%,
     *  120-150%,>150%]. (NB: docx GĐ/Phó-GĐTT mô tả theo doanh thu tuyệt đối — MÂU THUẪN; Excel
     *  thắng theo quyết định chủ dự án. Xem report bottleneck.) Rate VALUES editable. */
    cvtvNewRates: z.array(z.number().min(0).max(1)).length(6),
    /** CVTV renewal commission by centre retention ratio (khớp cả docx + Excel): <50%=0 ·
     *  50–70%=1.5% · 70–90%=2% · ≥90%=2.2%. Inclusive lower bound. */
    cvtvRenewalTiers: z.array(retentionTierSchema).min(1),
    /** Manager (TPKD/GĐTT) new-customer rates at quota breakpoints [<80,80-100,100-120,120-150,>150].
     *  DEFERRED (team rollup) — kept for forward-compat; not wired in v1 (CVTV-only). */
    tpkdNewRates: z.array(z.number().min(0).max(1)).length(5),
    gdttNewRates: z.array(z.number().min(0).max(1)).length(5),
    /** Flat renewal rate for non-CVTV roles, applied when centre retention ≥ retentionFloor.
     *  DEFERRED for tpkd/gdtt; gv/cskh kept for future use. */
    renewal: z.object({
      tpkd: z.number().min(0).max(1),
      gdtt: z.number().min(0).max(1),
      gv: z.number().min(0).max(1),
      cskh: z.number().min(0).max(1),
    }),
    retentionFloor: z.number().min(0).max(1),
    /** Commission budget cap as a fraction of real revenue (chốt: ≤6% theo file Excel KPI). */
    budgetPct: z.number().min(0).max(1),
    /** Centre-retention ratio assumed for auto-fed renewal commission BEFORE CRM feeds the real
     *  figure. Conservative default (< 1) per ERP accrue-then-reconcile practice to avoid overpay;
     *  a tree-manager can override the final commission on the payslip. HR/BGD tune this.
     *  `.default` keeps existing stored policies (without this key) parseable — backward-compatible. */
    renewalRetentionDefault: z.number().min(0).max(2).default(0.9),
  }),
  /** Teaching overtime unit price (VND/hour) by teacher grade. */
  overtimeRates: z.record(z.string(), z.number().int().nonnegative()),
  /** Part-time package flat monthly gross (VND) by package code. */
  parttimePackages: z.record(z.string(), z.number().int().nonnegative()),
  /** Tiêu chí KPI có trọng số per block — HR chỉnh qua JSON policy UI (P05, decision 0012).
   *  weights mỗi block PHẢI sum = 1 (±1e-6); validate ở cả Zod (refine) + service (weightedKpi). */
  kpiCriteria: z.object({
    sales: z.array(kpiCriterionConfigSchema).min(1),
    training: z.array(kpiCriterionConfigSchema).min(1),
  }).refine(
    (c) => {
      const EPSILON = 1e-6;
      const salesSum = c.sales.reduce((s, x) => s + x.weight, 0);
      const trainingSum = c.training.reduce((s, x) => s + x.weight, 0);
      return Math.abs(salesSum - 1) <= EPSILON && Math.abs(trainingSum - 1) <= EPSILON;
    },
    { message: 'kpiCriteria weights cho mỗi block phải sum = 1 (±1e-6)' },
  ),
});

export type CompensationParams = z.infer<typeof compensationParamsSchema>;

/** Seed defaults từ tài liệu "Cơ cấu thu nhập CMC 2026". Dùng khi chưa có policy version nào và
 *  làm fallback cho các hàm thuần. */
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
    // Khối Đào tạo: A(85-100)=100% · B(70-85)=90% · C(50-70)=80% · D(<50)=0%.
    training: [
      { minScore: 85, grade: 'A', ratio: 1.0 },
      { minScore: 70, grade: 'B', ratio: 0.9 },
      { minScore: 50, grade: 'C', ratio: 0.8 },
      { minScore: 0, grade: 'D', ratio: 0 },
    ],
    // Khối Kinh doanh (4 bậc — file Excel "Mẫu đánh giá KPI -kinh doanh", cột "% thưởng KPI", chốt
    // 2026-06-25): A(90-100)=100% · B(80-<90)=80% · C(60-<80)=50% · D(<60)=0%.
    sales: [
      { minScore: 90, grade: 'A', ratio: 1.0 },
      { minScore: 80, grade: 'B', ratio: 0.8 },
      { minScore: 60, grade: 'C', ratio: 0.5 },
      { minScore: 0, grade: 'D', ratio: 0 },
    ],
  },
  commission: {
    // Rates at quota breakpoints [<50%, 50-80%, 80-100%, 100-120%, >120-150%, >150%].
    cvtvNewRates: [0, 0.01, 0.02, 0.03, 0.04, 0.05],
    cvtvRenewalTiers: [
      { minRetention: 0, rate: 0 },
      { minRetention: 0.5, rate: 0.015 },
      { minRetention: 0.7, rate: 0.02 },
      { minRetention: 0.9, rate: 0.022 },
    ],
    // DEFERRED + UNVERIFIED (v1 = CVTV only). docx GĐTT gợi ý TPKD 0/0.7/1.0/1.2, GĐTT 0/0.6/0.8/1.0
    // nhưng Excel cells illegible + mapping 5-band không rõ → giữ placeholder, KHÔNG dùng khi chưa chốt.
    tpkdNewRates: [0, 0.006, 0.01, 0.012, 0.015],
    gdttNewRates: [0, 0.004, 0.006, 0.008, 0.01],
    renewal: { tpkd: 0.005, gdtt: 0.005, gv: 0.01, cskh: 0.008 },
    retentionFloor: 0.5,
    budgetPct: 0.06,
    // Conservative pre-CRM assumption (90% retention) — accrue slightly below full to limit
    // overpay, reconcilable via a tree-manager override on the payslip. HR/BGD may raise to 1.
    renewalRetentionDefault: 0.9,
  },
  overtimeRates: { B1: 100_000, B2: 120_000, B3: 130_000, B4: 150_000 },
  parttimePackages: { PT3: 3_000_000, PT4: 4_000_000, PT5: 5_000_000 },
  // Seed từ decision 0012 (provisional — HR chỉnh qua JSON policy UI).
  kpiCriteria: {
    sales: [
      { key: 'doanh_so', label: 'Doanh số', weight: 0.7 },
      { key: 'tuan_thu', label: 'Tuân thủ', weight: 0.2 },
      { key: 'khac', label: 'Khác', weight: 0.1 },
    ],
    training: [
      { key: 'chuyen_mon', label: 'Chuyên môn', weight: 0.6 },
      { key: 'tuan_thu', label: 'Tuân thủ', weight: 0.2 },
      { key: 'khac', label: 'Khác', weight: 0.2 },
    ],
  },
};
