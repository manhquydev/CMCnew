import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import {
  assemblePayslip,
  cvtvNewCustomerRate,
  renewalRate,
  commissionAmount,
  weightedKpi,
  ratioToScore,
} from '@cmc/domain-payroll';
import { effectiveParamsAt } from './compensation.js';
import { router, requireRole, protectedProcedure, Role } from '../trpc.js';
import { canOverrideKpi } from '../lib/kpi-authz.js';
import { callioConfigFromEnv, fetchPeriodCdrs, aggregateValidCalls } from '../lib/callio-client.js';

// Payroll is HR-confidential: every procedure is role-gated to hr/ke_toan (super passes).
// Non-HR staff have no code path to salary data. RLS adds facility isolation on top.
const HR_ROLES = [Role.hr, Role.ke_toan] as const;

/** Last calendar day of a YYYY-MM period (UTC), used to resolve the effective salary rate. */
function periodEnd(periodKey: string): Date {
  const parts = periodKey.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  return new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of month m
}

/** First and one-past-last UTC instants of a YYYY-MM period — for date-range filters. */
function periodRange(periodKey: string): { start: Date; end: Date } {
  const [y, m] = periodKey.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y!, m! - 1, 1)),
    end: new Date(Date.UTC(y!, m!, 1)), // exclusive: first day of following month
  };
}

export const payrollRouter = router({
  // Facility staff roster (id + name) for picking an employee — RLS-visible to facility staff.
  roster: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.appUser.findMany({
          where: { isActive: true, facilities: { some: { facilityId: input.facilityId } } },
          orderBy: { displayName: 'asc' },
          select: { id: true, displayName: true, primaryRole: true },
        }),
      ),
    ),

  profileUpsert: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        position: z.string().min(1),
        grade: z.string().optional(),
        dependents: z.number().int().min(0).default(0),
        startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        callioExt: z.string().optional(),
        // Required when changing an existing grade — a salary-band change must be justified + audited.
        reason: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // A grade change on an existing profile is a sensitive payroll action: it must carry a
        // reason and is audited old→new. Initial create or unchanged grade needs no reason.
        const existing = await tx.employmentProfile.findUnique({
          where: { userId: input.userId },
          select: { grade: true },
        });
        const gradeChanged = !!(existing && existing.grade && input.grade && existing.grade !== input.grade);
        if (gradeChanged && !input.reason?.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Đổi bậc lương cần lý do' });
        }
        const profile = await tx.employmentProfile.upsert({
          where: { userId: input.userId },
          update: {
            position: input.position,
            grade: input.grade,
            dependents: input.dependents,
            startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
            callioExt: input.callioExt,
          },
          create: {
            facilityId: input.facilityId,
            userId: input.userId,
            position: input.position,
            grade: input.grade,
            dependents: input.dependents,
            startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
            callioExt: input.callioExt,
          },
        });
        const body = gradeChanged
          ? `Đổi bậc lương ${existing!.grade}→${input.grade}: ${input.reason!.trim()}`
          : `Hồ sơ NS: ${input.position}${input.grade ? ' ' + input.grade : ''}`;
        await logEvent(tx, { facilityId: profile.facilityId, entityType: 'employment_profile', entityId: profile.id, type: 'updated', body, actorId: ctx.session.userId });
        return profile;
      }),
    ),

  profileList: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.employmentProfile.findMany({ where: { facilityId: input.facilityId, archivedAt: null }, orderBy: { createdAt: 'desc' } }),
      ),
    ),

  rateCreate: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        baseSalary: z.number().int().nonnegative(),
        mealAllowance: z.number().int().nonnegative().default(0),
        otherAllowance: z.number().int().nonnegative().default(0),
        kpiMax: z.number().int().nonnegative().default(0),
        monthlyQuota: z.number().int().nonnegative().default(0),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const rate = await tx.salaryRate.create({
          data: { ...input, effectiveFrom: new Date(input.effectiveFrom), createdById: ctx.session.userId },
        });
        await logEvent(tx, { facilityId: rate.facilityId, entityType: 'salary_rate', entityId: rate.id, type: 'created', body: `Mức lương từ ${input.effectiveFrom}: LCB ${input.baseSalary.toLocaleString('vi-VN')}đ`, actorId: ctx.session.userId });
        return rate;
      }),
    ),

  rateList: requireRole(...HR_ROLES)
    .input(z.object({ userId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.salaryRate.findMany({ where: { userId: input.userId, archivedAt: null }, orderBy: { effectiveFrom: 'desc' } }),
      ),
    ),

  // Auto-compute a sale's commission for a period from collected receipts credited to them
  // (docs/specs/payroll-v2-commission-design.md, CV4). Uses the CompensationPolicy effective at the
  // period; quota = the sale's effective SalaryRate.monthlyQuota. v1 treats the sale as a CVTV
  // (manager/team rollup deferred) and takes the centre retention ratio as an input (default 1 =
  // gate met) until centre-retention is computed from CRM. A preview for HR to fill variablePay.
  commissionForSale: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        centreRetentionRatio: z.number().min(0).max(2).default(1),
      }),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const params = await effectiveParamsAt(tx, input.periodKey);
        const rate = await tx.salaryRate.findFirst({
          where: { userId: input.userId, archivedAt: null, effectiveFrom: { lte: periodEnd(input.periodKey) } },
          orderBy: { effectiveFrom: 'desc' },
          select: { monthlyQuota: true },
        });
        const quota = rate?.monthlyQuota ?? 0;

        const [y, mo] = input.periodKey.split('-').map(Number);
        const start = new Date(Date.UTC(y!, mo! - 1, 1));
        const end = new Date(Date.UTC(y!, mo!, 1)); // exclusive next-month start
        const grouped = await tx.receipt.groupBy({
          by: ['kind'],
          where: {
            soldById: input.userId,
            facilityId: input.facilityId,
            status: { in: ['approved', 'sent', 'reconciled'] },
            approvedAt: { gte: start, lt: end },
          },
          _sum: { netAmount: true },
        });
        const newRevenue = grouped.find((g) => g.kind === 'new')?._sum.netAmount ?? 0;
        const renewalRevenue = grouped.find((g) => g.kind === 'renewal')?._sum.netAmount ?? 0;

        const attainment = quota > 0 ? newRevenue / quota : 0;
        const rateNew = cvtvNewCustomerRate(attainment, params);
        const rateRenew = renewalRate('cvtv', input.centreRetentionRatio, params);
        const commissionNew = commissionAmount(newRevenue, rateNew);
        const commissionRenewal = commissionAmount(renewalRevenue, rateRenew);
        const total = commissionNew + commissionRenewal;
        const budgetCap = Math.round((newRevenue + renewalRevenue) * params.commission.budgetPct);
        return {
          quota,
          newRevenue,
          renewalRevenue,
          attainment,
          rateNew,
          rateRenew,
          commissionNew,
          commissionRenewal,
          total,
          budgetCap,
          overBudget: total > budgetCap,
        };
      }),
    ),

  // Compute (or recompute) a draft payslip for (employee, period). Finalize gating: a finalized
  // or paid slip cannot be recomputed. All figures come from @cmc/domain-payroll.
  // kpiScore is optional: when omitted, resolved from KpiScore record (overrideScore ?? autoScore).
  payslipCompute: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        standardDays: z.number().int().positive(),
        workdays: z.number().int().min(0),
        kpiScore: z.number().min(0).max(100).optional(),
        variablePay: z.number().int().nonnegative().default(0),
        variableNote: z.string().optional(),
        insuranceDeduction: z.number().int().nonnegative().default(0),
        dependents: z.number().int().min(0).optional(),
      }).refine((v) => v.workdays <= v.standardDays, {
        message: 'Số ngày công không được vượt quá số ngày chuẩn',
        path: ['workdays'],
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const existing = await tx.payslip.findUnique({ where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } } });
        if (existing && existing.status !== 'draft') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu lương đã chốt — không tính lại được' });
        }
        const rate = await tx.salaryRate.findFirst({
          where: { userId: input.userId, archivedAt: null, effectiveFrom: { lte: periodEnd(input.periodKey) } },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!rate) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nhân sự chưa có mức lương hiệu lực' });
        const profile = await tx.employmentProfile.findUnique({ where: { userId: input.userId } });
        const dependents = input.dependents ?? profile?.dependents ?? 0;

        // Compute with the CompensationPolicy effective at the period (CV6 — close the config loop):
        // PIT brackets/reliefs + KPI band come from the live policy, not hardcoded constants. KPI band
        // is block-specific — a 'sale' is graded on the sales band, everyone else on training.
        const params = await effectiveParamsAt(tx, input.periodKey);
        const emp = await tx.appUser.findUnique({ where: { id: input.userId }, select: { roles: true } });
        const block: 'training' | 'sales' = emp?.roles.includes(Role.sale) ? 'sales' : 'training';

        // Resolve kpiScore: if not provided, read from KpiScore record (overrideScore ?? autoScore).
        let kpiScore: number;
        if (input.kpiScore !== undefined) {
          kpiScore = input.kpiScore;
        } else {
          const kpiRow = await tx.kpiScore.findUnique({
            where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
            select: { autoScore: true, overrideScore: true },
          });
          kpiScore = kpiRow ? (kpiRow.overrideScore ?? kpiRow.autoScore) : 0;
        }

        // Commission auto-feed for sale roles (CV4): compute commission from approved receipts
        // and override variablePay so the payslip is fully data-driven for sales staff.
        // centreRetentionRatio defaults to 1 (gate met) until CRM feeds it.
        let resolvedVariablePay = input.variablePay;
        let resolvedVariableNote = input.variableNote;
        if (block === 'sales') {
          const { start: pStart, end: pEnd } = periodRange(input.periodKey);
          const rateRow = await tx.salaryRate.findFirst({
            where: { userId: input.userId, archivedAt: null, effectiveFrom: { lte: periodEnd(input.periodKey) } },
            orderBy: { effectiveFrom: 'desc' },
            select: { monthlyQuota: true },
          });
          const quota = rateRow?.monthlyQuota ?? 0;
          const grouped = await tx.receipt.groupBy({
            by: ['kind'],
            where: {
              soldById: input.userId,
              facilityId: input.facilityId,
              status: { in: ['approved', 'sent', 'reconciled'] },
              approvedAt: { gte: pStart, lt: pEnd },
            },
            _sum: { netAmount: true },
          });
          const newRevenue = grouped.find((g) => g.kind === 'new')?._sum.netAmount ?? 0;
          const renewalRevenue = grouped.find((g) => g.kind === 'renewal')?._sum.netAmount ?? 0;
          const attainment = quota > 0 ? newRevenue / quota : 0;
          // Renewal uses the policy's pre-CRM retention assumption (conservative, tunable) rather
          // than a hardcoded 100%; a tree-manager can override the final commission afterwards.
          const retentionAssumption = params.commission.renewalRetentionDefault;
          const commission =
            commissionAmount(newRevenue, cvtvNewCustomerRate(attainment, params)) +
            commissionAmount(renewalRevenue, renewalRate('cvtv', retentionAssumption, params));
          resolvedVariablePay = Math.round(commission);
          resolvedVariableNote = `Hoa hồng ${input.periodKey}: ${resolvedVariablePay.toLocaleString('vi-VN')}đ`;
        }

        const r = assemblePayslip(
          {
            baseSalary: rate.baseSalary,
            mealAllowance: rate.mealAllowance,
            otherAllowance: rate.otherAllowance,
            kpiMax: rate.kpiMax,
            kpiScore,
            block,
            workdays: input.workdays,
            standardDays: input.standardDays,
            variablePay: resolvedVariablePay,
            insuranceDeduction: input.insuranceDeduction,
            dependents,
          },
          params,
        );
        const data = {
          facilityId: input.facilityId,
          userId: input.userId,
          periodKey: input.periodKey,
          standardDays: input.standardDays,
          workdays: input.workdays,
          kpiScore,
          kpiGrade: r.kpiGrade,
          baseEarned: r.baseEarned,
          allowanceEarned: r.allowanceEarned,
          kpiBonus: r.kpiBonus,
          variablePay: r.variablePay,
          variableNote: resolvedVariableNote,
          insuranceDeduction: r.insuranceDeduction,
          dependents,
          grossIncome: r.grossIncome,
          taxableIncome: r.taxableIncome,
          pitAmount: r.pitAmount,
          netIncome: r.netIncome,
          computedById: ctx.session.userId,
        };
        const slip = await tx.payslip.upsert({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          update: data,
          create: data,
        });
        await logEvent(tx, { facilityId: slip.facilityId, entityType: 'payslip', entityId: slip.id, type: existing ? 'updated' : 'created', body: `Tính lương ${input.periodKey}: thực lĩnh ${r.netIncome.toLocaleString('vi-VN')}đ (${r.kpiGrade})`, actorId: ctx.session.userId });
        return slip;
      }),
    ),

  payslipList: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.payslip.findMany({
          where: { facilityId: input.facilityId, ...(input.periodKey ? { periodKey: input.periodKey } : {}) },
          orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }],
          take: 300,
        }),
      ),
    ),

  payslipFinalize: requireRole(...HR_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.payslip.findUniqueOrThrow({ where: { id: input.id } });
        if (before.status !== 'draft') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ chốt được phiếu nháp' });
        const slip = await tx.payslip.update({ where: { id: input.id }, data: { status: 'finalized', finalizedById: ctx.session.userId, finalizedAt: new Date() } });
        await logEvent(tx, { facilityId: slip.facilityId, entityType: 'payslip', entityId: slip.id, type: 'status_changed', body: `Chốt phiếu lương ${slip.periodKey}`, changes: [{ field: 'status', old: 'draft', new: 'finalized' }], actorId: ctx.session.userId });
        return slip;
      }),
    ),

  payslipMarkPaid: requireRole(...HR_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.payslip.findUniqueOrThrow({ where: { id: input.id } });
        if (before.status !== 'finalized') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ đánh dấu trả cho phiếu đã chốt' });
        const slip = await tx.payslip.update({ where: { id: input.id }, data: { status: 'paid', paidAt: new Date() } });
        await logEvent(tx, { facilityId: slip.facilityId, entityType: 'payslip', entityId: slip.id, type: 'status_changed', body: `Đã trả lương ${slip.periodKey}`, changes: [{ field: 'status', old: 'finalized', new: 'paid' }], actorId: ctx.session.userId });
        return slip;
      }),
    ),

  // Period payroll sheet: fund totals + per-status breakdown for one (facility, period).
  // Powers the "bảng lương kỳ" view — how much is drafted vs frozen vs already paid.
  payslipPeriodSummary: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const where = { facilityId: input.facilityId, periodKey: input.periodKey };
        const [totals, byStatus] = await Promise.all([
          tx.payslip.aggregate({
            where,
            _count: { _all: true },
            _sum: { grossIncome: true, netIncome: true, pitAmount: true, insuranceDeduction: true },
          }),
          tx.payslip.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { netIncome: true } }),
        ]);
        const status = (s: string) => byStatus.find((g) => g.status === s);
        return {
          periodKey: input.periodKey,
          count: totals._count._all,
          totalGross: totals._sum.grossIncome ?? 0,
          totalNet: totals._sum.netIncome ?? 0,
          totalPit: totals._sum.pitAmount ?? 0,
          totalInsurance: totals._sum.insuranceDeduction ?? 0,
          draftCount: status('draft')?._count._all ?? 0,
          finalizedCount: status('finalized')?._count._all ?? 0,
          paidCount: status('paid')?._count._all ?? 0,
          finalizedNet: status('finalized')?._sum.netIncome ?? 0,
        };
      }),
    ),

  // Pay out a whole period at once: flip every finalized (not draft, not already-paid) slip
  // to paid. Audited per slip so the trail stays complete. Returns how many were paid.
  payslipBulkMarkPaid: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const due = await tx.payslip.findMany({
          where: { facilityId: input.facilityId, periodKey: input.periodKey, status: 'finalized' },
          select: { id: true },
        });
        if (due.length === 0) return { paidCount: 0 };
        const paidAt = new Date();
        await tx.payslip.updateMany({ where: { id: { in: due.map((s) => s.id) } }, data: { status: 'paid', paidAt } });
        await Promise.all(
          due.map((s) =>
            logEvent(tx, { facilityId: input.facilityId, entityType: 'payslip', entityId: s.id, type: 'status_changed', body: `Trả lương hàng loạt kỳ ${input.periodKey}`, changes: [{ field: 'status', old: 'finalized', new: 'paid' }], actorId: ctx.session.userId }),
          ),
        );
        return { paidCount: due.length };
      }),
    ),

  // HR staff-scoped payslip list: all payslips for a given employee, newest first, last 12.
  // Used by the HR panel drawer to show per-staff payslip history and enable bulk-pay selection.
  listByStaff: requireRole(...HR_ROLES)
    .input(z.object({ staffId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.payslip.findMany({
          where: { userId: input.staffId },
          orderBy: { periodKey: 'desc' },
          take: 12,
          select: {
            id: true,
            periodKey: true,
            status: true,
            netIncome: true,
            grossIncome: true,
            kpiGrade: true,
          },
        }),
      ),
    ),

  // Bulk-pay by explicit slip IDs: marks each finalized slip as paid. IDs that are not in
  // 'finalized' state are skipped (not errored) and returned in `failed`. Audited per slip.
  payslipBulkPay: requireRole(...HR_ROLES)
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const due = await tx.payslip.findMany({
          where: { id: { in: input.ids }, status: 'finalized' },
          select: { id: true, facilityId: true, periodKey: true },
        });
        if (due.length === 0) return { succeeded: [] as string[], failed: input.ids };
        const paidAt = new Date();
        await tx.payslip.updateMany({
          where: { id: { in: due.map((s) => s.id) } },
          data: { status: 'paid', paidAt },
        });
        await Promise.all(
          due.map((s) =>
            logEvent(tx, {
              facilityId: s.facilityId,
              entityType: 'payslip',
              entityId: s.id,
              type: 'status_changed',
              body: `Trả lương ${s.periodKey}`,
              changes: [{ field: 'status', old: 'finalized', new: 'paid' }],
              actorId: ctx.session.userId,
            }),
          ),
        );
        const succeededSet = new Set(due.map((s) => s.id));
        return {
          succeeded: due.map((s) => s.id),
          failed: input.ids.filter((id) => !succeededSet.has(id)),
        };
      }),
    ),

  // Reopen a finalized (not yet paid) slip back to draft for correction — audited.
  payslipReopen: requireRole(...HR_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.payslip.findUniqueOrThrow({ where: { id: input.id } });
        if (before.status !== 'finalized') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ mở lại phiếu đã chốt (chưa trả)' });
        const slip = await tx.payslip.update({ where: { id: input.id }, data: { status: 'draft', finalizedById: null, finalizedAt: null } });
        await logEvent(tx, { facilityId: slip.facilityId, entityType: 'payslip', entityId: slip.id, type: 'status_changed', body: `Mở lại phiếu lương ${slip.periodKey}`, changes: [{ field: 'status', old: 'finalized', new: 'draft' }], actorId: ctx.session.userId });
        return slip;
      }),
    ),

  // Staff self-service: any authenticated staff may view their own finalized/paid payslips.
  // CRITICAL: userId is taken exclusively from ctx.session — no userId input accepted (prevents IDOR).
  // Draft slips are hidden (staff must not see un-finalized numbers).
  myPayslips: protectedProcedure.query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.payslip.findMany({
        where: {
          userId: ctx.session.userId,
          status: { in: ['finalized', 'paid'] },
        },
        orderBy: { periodKey: 'desc' },
        select: {
          id: true,
          periodKey: true,
          status: true,
          baseEarned: true,
          allowanceEarned: true,
          kpiBonus: true,
          kpiGrade: true,
          variablePay: true,
          grossIncome: true,
          insuranceDeduction: true,
          pitAmount: true,
          netIncome: true,
          finalizedAt: true,
          paidAt: true,
        },
      }),
    ),
  ),

  // ─── KPI Evaluation Workflow (P05, decision 0011) ────────────────────────────
  // draft → submitted → confirmed → approved
  // HR starts; employee self-submits; manager confirms; BGD approves (≠ confirmer).

  /** HR creates/resets a draft KPI sheet for (employee, period). CONFLICT if already beyond draft. */
  kpiEvalStart: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        block: z.enum(['training', 'sales']),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const existing = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (existing && existing.status !== 'draft') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu KPI đã qua trạng thái nháp — không thể khởi tạo lại' });
        }
        const params = await effectiveParamsAt(tx, input.periodKey);
        const criterionScores = params.kpiCriteria[input.block].map((c) => ({ key: c.key, score: 0 }));
        const sharedData = {
          facilityId: input.facilityId,
          userId: input.userId,
          periodKey: input.periodKey,
          block: input.block,
          autoScore: 0,
          criterionScores,
          status: 'draft' as const,
        };
        const row = await tx.kpiScore.upsert({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          update: { autoScore: 0, criterionScores, block: input.block },
          create: sharedData,
        });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: existing ? 'updated' : 'created',
          body: `Khởi tạo phiếu KPI ${input.periodKey} [${input.block}]`,
          actorId: ctx.session.userId,
        });
        return row;
      }),
    ),

  /** Employee self-submits their KPI scores. Session userId is the target (no IDOR). */
  kpiEvalSubmit: protectedProcedure
    .input(
      z.object({
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        scores: z.array(z.object({ key: z.string(), score: z.number().min(0).max(100) })).min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: ctx.session.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu KPI không ở trạng thái nháp' });

        const params = await effectiveParamsAt(tx, input.periodKey);
        const blockCriteria = params.kpiCriteria[row.block as 'training' | 'sales'];
        // Build the weighted set from the policy criteria (whose weights sum to 1), filling each
        // from the submitted score (missing → 0). This keeps weightedKpi's weight-sum invariant
        // intact even when an employee omits or sends extra/unknown keys — no raw Error → 500.
        const scoreByKey = new Map(input.scores.map((s) => [s.key, s.score]));
        const criteria = blockCriteria.map((c) => ({ criterion: c.key, weight: c.weight, score: scoreByKey.get(c.key) ?? 0 }));
        const { score: autoScore } = weightedKpi(criteria);

        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: {
            criterionScores: input.scores,
            autoScore,
            status: 'submitted',
            submittedById: ctx.session.userId,
            submittedAt: new Date(),
          },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Nộp phiếu KPI ${input.periodKey}: điểm ${autoScore}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  /** Quan_ly / BGD confirms a submitted KPI sheet. Moves to confirmed status. */
  kpiEvalConfirm: requireRole(Role.quan_ly, Role.bgd)
    .input(
      z.object({
        userId: z.string().uuid(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        if (row.status !== 'submitted') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu KPI chưa được nộp' });

        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: { status: 'confirmed', confirmedById: ctx.session.userId, confirmedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Xác nhận phiếu KPI ${input.periodKey}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  /** BGD approves a confirmed KPI sheet. Separation of duties: approver ≠ confirmer. */
  kpiEvalApprove: requireRole(Role.bgd)
    .input(
      z.object({
        userId: z.string().uuid(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        if (row.status !== 'confirmed') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu KPI chưa được xác nhận' });
        if (row.confirmedById && row.confirmedById === ctx.session.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Không thể duyệt phiếu do chính mình xác nhận (tách trách nhiệm)' });
        }

        // Recompute autoScore from stored criterionScores + current policy weights.
        const params = await effectiveParamsAt(tx, input.periodKey);
        const blockCriteria = params.kpiCriteria[row.block as 'training' | 'sales'];
        const criterionScores = (row.criterionScores as { key: string; score: number }[] | null) ?? [];
        let autoScore = 0;
        if (criterionScores.length > 0) {
          // Same policy-anchored build as submit: weights come from blockCriteria (sum=1), scores
          // from the stored sheet — so recompute is stable regardless of which keys were stored.
          const scoreByKey = new Map(criterionScores.map((s) => [s.key, s.score]));
          const criteria = blockCriteria.map((c) => ({ criterion: c.key, weight: c.weight, score: scoreByKey.get(c.key) ?? 0 }));
          autoScore = weightedKpi(criteria).score;
        }

        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: { status: 'approved', autoScore, approvedById: ctx.session.userId, approvedAt: new Date() },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Phê duyệt phiếu KPI ${input.periodKey}: điểm ${autoScore}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  /** HR reads a single KPI sheet + its criteriaConfig for display. */
  kpiEvalGet: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        const params = await effectiveParamsAt(tx, input.periodKey);
        return { row, criteriaConfig: params.kpiCriteria[row.block as 'training' | 'sales'] };
      }),
    ),

  /** HR lists all KPI sheets for a facility in a period (for the admin panel). */
  kpiList: requireRole(...HR_ROLES)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.kpiScore.findMany({
          where: { facilityId: input.facilityId, periodKey: input.periodKey },
          orderBy: { createdAt: 'desc' },
        }),
      ),
    ),

  /** Auto-fill quantitative KPI criteria from real operational data (P06, decision 0011).
   *  Sales block: doanh_so = ratioToScore(approvedRevenue/quota).
   *  Training block: chuyen_mon (avg grade ratio) + tuan_thu (attendance-marked sessions ratio).
   *  Non-draft status → CONFLICT. Non-existent sheet → NOT_FOUND. Audit written. */
  kpiAutoPrefill: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu KPI không ở trạng thái nháp' });

        const { start, end } = periodRange(input.periodKey);
        const block = row.block as 'training' | 'sales';

        type ComputedItem = { key: string; score: number; dataAvailable: boolean };
        let computed: ComputedItem[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- context shape varies by block
        let context: Record<string, any> = {};

        if (block === 'sales') {
          // doanh_so: total approved revenue in period / monthly quota
          const rate = await tx.salaryRate.findFirst({
            where: { userId: input.userId, archivedAt: null, effectiveFrom: { lte: periodEnd(input.periodKey) } },
            orderBy: { effectiveFrom: 'desc' },
            select: { monthlyQuota: true },
          });
          const quota = rate?.monthlyQuota ?? 0;

          const revenueAgg = await tx.receipt.aggregate({
            where: {
              soldById: input.userId,
              facilityId: input.facilityId,
              status: 'approved',
              approvedAt: { gte: start, lt: end },
            },
            _sum: { netAmount: true },
          });
          const approvedRevenue = revenueAgg._sum.netAmount ?? 0;

          const score = quota > 0 ? ratioToScore(approvedRevenue / quota) : 0;
          computed = [{ key: 'doanh_so', score, dataAvailable: quota > 0 }];
          context = { approvedRevenue, quota };
        } else {
          // training block: chuyen_mon + tuan_thu

          // chuyen_mon: avg(score/maxScore) × 100 for published grades gradedById=userId in period
          const grades = await tx.grade.findMany({
            where: {
              gradedById: input.userId,
              isPublished: true,
              gradedAt: { gte: start, lt: end },
            },
            select: { score: true, maxScore: true },
          });
          // Only grades with a positive maxScore yield a meaningful ratio (guard against /0 → Infinity).
          const scorable = grades.filter((g) => g.maxScore > 0);
          let chuyenMonScore = 0;
          const hasGrades = scorable.length > 0;
          if (hasGrades) {
            const avgRatio = scorable.reduce((sum, g) => sum + g.score / g.maxScore, 0) / scorable.length;
            chuyenMonScore = Math.round(avgRatio * 100 * 100) / 100; // same precision as ratioToScore
          }

          // tuan_thu: sessions with >=1 attendance markedAt / total confirmed sessions
          const [totalSessions, sessionsWith] = await Promise.all([
            tx.classSession.count({
              where: {
                teacherId: input.userId,
                status: 'confirmed',
                sessionDate: { gte: start, lt: end },
              },
            }),
            tx.classSession.count({
              where: {
                teacherId: input.userId,
                status: 'confirmed',
                sessionDate: { gte: start, lt: end },
                attendances: { some: { markedAt: { not: null } } },
              },
            }),
          ]);
          const tuanThuScore = totalSessions > 0 ? (sessionsWith / totalSessions) * 100 : 0;

          computed = [
            { key: 'chuyen_mon', score: chuyenMonScore, dataAvailable: hasGrades },
            { key: 'tuan_thu', score: tuanThuScore, dataAvailable: totalSessions > 0 },
          ];
          context = { gradeCount: grades.length, totalSessions, sessionsWithAttendance: sessionsWith };
        }

        // Merge computed scores into existing criterionScores, preserving uncomputed keys.
        const existingScores = (row.criterionScores as { key: string; score: number }[] | null) ?? [];
        const computedMap = new Map(computed.map((c) => [c.key, c.score]));
        const mergedScores = existingScores.map((cs) => {
          const newScore = computedMap.get(cs.key);
          return newScore !== undefined ? { key: cs.key, score: newScore } : cs;
        });

        await tx.kpiScore.update({
          where: { id: row.id },
          data: { criterionScores: mergedScores },
        });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Tự điền KPI định lượng ${input.periodKey}`,
          actorId: ctx.session.userId,
        });
        return { computed, context };
      }),
    ),

  /** Override a subordinate's KPI score (decision 0011). Requires tree authority via canOverrideKpi.
   *  Audit logs old→new + reason. Self-override is blocked. */
  kpiOverride: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        overrideScore: z.number().min(0).max(100),
        reason: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Load target user roles for authority check.
        const target = await tx.appUser.findUnique({
          where: { id: input.userId },
          select: { roles: true },
        });
        const targetRoles = (target?.roles ?? []) as Role[];

        const actor = {
          userId: ctx.session.userId,
          roles: ctx.session.roles as Role[],
          isSuperAdmin: ctx.session.isSuperAdmin,
        };
        if (!canOverrideKpi(actor, input.userId, targetRoles)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Không có quyền chỉnh điểm KPI cho nhân sự này' });
        }

        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });

        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: {
            overrideScore: input.overrideScore,
            overrideReason: input.reason,
            overriddenById: ctx.session.userId,
            overriddenAt: new Date(),
          },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Override KPI ${input.periodKey}: ${row.autoScore}→${input.overrideScore}. Lý do: ${input.reason}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  /** HR test-helper / backfill: upsert a KpiScore row with a given autoScore (used for wiring). */
  kpiSetAuto: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        block: z.enum(['training', 'sales']),
        autoScore: z.number().min(0).max(100),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const params = await effectiveParamsAt(tx, input.periodKey);
        const criterionScores = params.kpiCriteria[input.block].map((c) => ({ key: c.key, score: 0 }));
        const row = await tx.kpiScore.upsert({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          update: { autoScore: input.autoScore },
          create: {
            facilityId: input.facilityId,
            userId: input.userId,
            periodKey: input.periodKey,
            block: input.block,
            autoScore: input.autoScore,
            criterionScores,
          },
        });
        await logEvent(tx, {
          facilityId: input.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Cập nhật điểm KPI tự động ${input.periodKey}: ${input.autoScore}`,
          actorId: ctx.session.userId,
        });
        return row;
      }),
    ),

  // ─── Callio call-metrics sync (decision 0010) ────────────────────────────────
  // Polls Callio CDRs for a period, aggregates outbound >5s per extension, and snapshots
  // the tallies in CallMetric (idempotent per user+period). Token unset → no-op.

  syncCallMetrics: requireRole(...HR_ROLES)
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const cfg = callioConfigFromEnv();
        if (!cfg) return { synced: 0, skipped: 'callio-not-configured' as const };

        const { start, end } = periodRange(input.periodKey);

        // Fetch all CDRs for the period from Callio.
        const cdrs = await fetchPeriodCdrs(cfg, start.getTime(), end.getTime());

        // Aggregate valid calls per extension.
        const talliesByExt = aggregateValidCalls(cdrs);
        if (talliesByExt.size === 0) return { synced: 0 };

        // Map extensions → staff via EmploymentProfile.callioExt.
        const profiles = await tx.employmentProfile.findMany({
          where: { facilityId: input.facilityId, callioExt: { not: null } },
          select: { userId: true, callioExt: true },
        });

        let synced = 0;
        const syncedAt = new Date();

        for (const profile of profiles) {
          if (!profile.callioExt) continue;
          const tally = talliesByExt.get(profile.callioExt);
          if (!tally) continue;

          await tx.callMetric.upsert({
            where: { userId_periodKey: { userId: profile.userId, periodKey: input.periodKey } },
            update: {
              validCalls: tally.validCalls,
              totalCalls: tally.totalCalls,
              totalTalkSec: tally.totalTalkSec,
              syncedAt,
            },
            create: {
              facilityId: input.facilityId,
              userId: profile.userId,
              periodKey: input.periodKey,
              validCalls: tally.validCalls,
              totalCalls: tally.totalCalls,
              totalTalkSec: tally.totalTalkSec,
              syncedAt,
            },
          });
          synced++;
        }

        return { synced };
      }),
    ),
});
