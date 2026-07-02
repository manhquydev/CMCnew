import { trpc } from '@cmc/ui';

export type CompensationPolicyRow = {
  id: string;
  effectiveFrom: string | Date;
  note: string | null;
  createdAt: string | Date;
  params: unknown;
};

export const compensationApi = trpc.compensation as unknown as {
  list: { query: () => Promise<CompensationPolicyRow[]> };
  defaults: { query: () => Promise<unknown> };
  create: { mutate: (input: { effectiveFrom: string; params: unknown; note?: string }) => Promise<unknown> };
};

type PayrollRosterEntry = { id: string; displayName: string; primaryRole: string };
type PayslipRow = {
  id: string;
  periodKey: string;
  status: string;
  netIncome: number | null;
  grossIncome: number | null;
  kpiGrade: string | null;
};
type BulkPayResult = { succeeded: string[]; failed: string[] };
type PeriodSummary = {
  periodKey: string;
  count: number;
  totalGross: number;
  totalNet: number;
  totalPit: number;
  totalInsurance: number;
  draftCount: number;
  finalizedCount: number;
  paidCount: number;
  finalizedNet: number;
};
type KpiRow = {
  id: string;
  userId: string;
  facilityId: number;
  periodKey: string;
  block: string;
  status: string;
  autoScore: number;
  overrideScore: number | null;
  criterionScores: unknown;
};
type CriterionConfig = { key: string; label: string; weight: number };
type ScoreEntry = { key: string; score: number };

export const payrollApi = trpc.payroll as unknown as {
  roster: { query: (i: { facilityId: number }) => Promise<PayrollRosterEntry[]> };
  listByStaff: { query: (i: { staffId: string }) => Promise<PayslipRow[]> };
  payslipCompute: {
    mutate: (i: {
      userId: string;
      facilityId: number;
      periodKey: string;
      standardDays: number;
      workdays: number;
      kpiScore?: number;
      variablePay?: number;
      variableNote?: string;
      insuranceDeduction?: number;
    }) => Promise<PayslipRow>;
  };
  payslipFinalize: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipMarkPaid: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipReopen: { mutate: (i: { id: string }) => Promise<PayslipRow> };
  payslipBulkPay: { mutate: (i: { ids: string[] }) => Promise<BulkPayResult> };
  payslipPeriodSummary: { query: (i: { facilityId: number; periodKey: string }) => Promise<PeriodSummary> };
  payslipOverrideVariablePay: {
    mutate: (i: { userId: string; periodKey: string; amount: number; reason: string }) => Promise<PayslipRow>;
  };
  kpiList: { query: (i: { facilityId: number; periodKey: string }) => Promise<KpiRow[]> };
  kpiEvalStart: { mutate: (i: { userId: string; facilityId: number; periodKey: string; block: 'training' | 'sales' }) => Promise<unknown> };
  kpiAutoPrefill: { mutate: (i: { userId: string; facilityId: number; periodKey: string }) => Promise<unknown> };
  kpiEvalSubmit: { mutate: (i: { periodKey: string; scores: ScoreEntry[] }) => Promise<unknown> };
  kpiEvalConfirm: { mutate: (i: { userId: string; periodKey: string }) => Promise<unknown> };
  kpiEvalApprove: { mutate: (i: { userId: string; periodKey: string }) => Promise<unknown> };
  kpiOverride: { mutate: (i: { userId: string; periodKey: string; overrideScore: number; reason: string }) => Promise<unknown> };
  kpiEvalGet: { query: (i: { userId: string; periodKey: string }) => Promise<{ row: KpiRow; criteriaConfig: CriterionConfig[] }> };
};
