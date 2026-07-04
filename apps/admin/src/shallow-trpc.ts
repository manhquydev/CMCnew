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
  attendanceDeduction?: number | null;
  attendanceDeductionOverride?: number | null;
};
type BulkPayResult = { succeeded: string[]; failed: string[] };
type PeriodSummary = {
  periodKey: string;
  count: number;
  totalGross: number;
  totalNet: number;
  totalPit: number;
  totalInsurance: number;
  totalAttendanceDeduction: number;
  draftCount: number;
  finalizedCount: number;
  paidCount: number;
  finalizedNet: number;
};
type AttendanceReportDay = {
  date: string;
  shiftTemplateId: string;
  shiftName: string | null;
  punchCount: number;
  checkIn: string | Date | null;
  checkOut: string | Date | null;
  lateMinutes: number;
  earlyMinutes: number;
  penaltyAmount: number;
};
type AttendanceReportRow = {
  userId: string;
  displayName: string;
  workdays: number;
  lateMinutes: number;
  earlyMinutes: number;
  penaltyAmount: number;
  days: AttendanceReportDay[];
};
type AttendanceHistoryPunch = {
  id: string;
  timestamp: string | Date;
  method: string;
  // Absent on self-view (server strips it — employees don't need their own IP);
  // present when a manager views someone else's history (audit).
  ipAddress?: string;
  shiftTemplateId: string | null;
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
  payslipOverrideAttendanceDeduction: {
    mutate: (i: { id: string; amount: number; reason: string }) => Promise<PayslipRow>;
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

export const attendanceApi = trpc.checkInOut as unknown as {
  monthlyReport: { query: (i: { facilityId: number; periodKey: string }) => Promise<{ periodKey: string; rows: AttendanceReportRow[] }> };
  history: { query: (i: { userId?: string; fromDate: string; toDate: string }) => Promise<AttendanceHistoryPunch[]> };
};

export type BadgeRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  unlockCriteria: unknown;
  isActive: boolean;
  archivedAt: string | Date | null;
};

export const badgeApi = trpc.badge as unknown as {
  list: { query: (i: { facilityId: number }) => Promise<BadgeRow[]> };
  create: {
    mutate: (i: {
      facilityId: number;
      code: string;
      name: string;
      description?: string;
      iconUrl?: string;
      unlockCriteria: { kind: 'stars_total' | 'homework_count'; gte: number };
    }) => Promise<{ id: string }>;
  };
  archive: { mutate: (i: { id: string }) => Promise<{ ok: boolean }> };
  grant: { mutate: (i: { studentId: string; badgeId: string }) => Promise<{ awarded: boolean }> };
};
