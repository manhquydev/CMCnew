import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { assemblePayslip, cvtvNewCustomerRate, renewalRate, commissionAmount } from '@cmc/domain-payroll';
import { effectiveParamsAt } from './compensation.js';
import { router, requireRole, protectedProcedure, Role } from '../trpc.js';

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
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const profile = await tx.employmentProfile.upsert({
          where: { userId: input.userId },
          update: { position: input.position, grade: input.grade, dependents: input.dependents, startedAt: input.startedAt ? new Date(input.startedAt) : undefined },
          create: {
            facilityId: input.facilityId,
            userId: input.userId,
            position: input.position,
            grade: input.grade,
            dependents: input.dependents,
            startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
          },
        });
        await logEvent(tx, { facilityId: profile.facilityId, entityType: 'employment_profile', entityId: profile.id, type: 'updated', body: `Hồ sơ NS: ${input.position}${input.grade ? ' ' + input.grade : ''}`, actorId: ctx.session.userId });
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
  payslipCompute: requireRole(...HR_ROLES)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        standardDays: z.number().int().positive(),
        workdays: z.number().int().min(0),
        kpiScore: z.number().min(0).max(100),
        variablePay: z.number().int().nonnegative().default(0),
        variableNote: z.string().optional(),
        insuranceDeduction: z.number().int().nonnegative().default(0),
        dependents: z.number().int().min(0).optional(),
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

        const r = assemblePayslip({
          baseSalary: rate.baseSalary,
          mealAllowance: rate.mealAllowance,
          otherAllowance: rate.otherAllowance,
          kpiMax: rate.kpiMax,
          kpiScore: input.kpiScore,
          workdays: input.workdays,
          standardDays: input.standardDays,
          variablePay: input.variablePay,
          insuranceDeduction: input.insuranceDeduction,
          dependents,
        });
        const data = {
          facilityId: input.facilityId,
          userId: input.userId,
          periodKey: input.periodKey,
          standardDays: input.standardDays,
          workdays: input.workdays,
          kpiScore: input.kpiScore,
          kpiGrade: r.kpiGrade,
          baseEarned: r.baseEarned,
          allowanceEarned: r.allowanceEarned,
          kpiBonus: r.kpiBonus,
          variablePay: r.variablePay,
          variableNote: input.variableNote,
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
});
