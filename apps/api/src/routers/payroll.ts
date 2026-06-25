import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { assemblePayslip, cvtvNewCustomerRate, renewalRate, commissionAmount, weightedKpi, ratioToScore } from '@cmc/domain-payroll';
import { effectiveParamsAt } from './compensation.js';
import { callioConfigFromEnv, fetchPeriodCdrs, aggregateValidCalls } from '../lib/callio-client.js';
import { canOverrideKpi } from '../lib/kpi-authz.js';
import { router, requireRole, protectedProcedure, Role } from '../trpc.js';
import { emitStaffNotif } from '../lib/emit-staff-notif.js';

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

/** [start, end) of a YYYY-MM period as epoch ms (UTC) — the from/to window for Callio CDR queries. */
function periodRangeMs(periodKey: string): { fromMs: number; toMs: number } {
  const [y, m] = periodKey.split('-').map(Number);
  return {
    fromMs: Date.UTC(y!, m! - 1, 1),
    toMs: Date.UTC(y!, m!, 1), // exclusive next-month start
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
        callioExt: z.string().optional(), // Callio extension for KPI call metrics (decision 0010)
        startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        // Lý do — BẮT BUỘC khi đổi bậc (grade) của hồ sơ đã tồn tại (decision 0011: minh bạch).
        reason: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const existing = await tx.employmentProfile.findUnique({ where: { userId: input.userId }, select: { grade: true } });
        // Only an explicitly-provided, different grade counts as a change (omitting grade leaves it
        // untouched — Prisma ignores undefined — so callers that don't manage grade aren't forced
        // to supply a reason).
        const gradeChanged = existing != null && input.grade !== undefined && existing.grade !== input.grade;
        // Đổi bậc phải kèm lý do — bậc lương là thông tin nhạy cảm, cần vết minh bạch.
        if (gradeChanged && !input.reason) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Đổi bậc lương phải kèm lý do (reason).' });
        }
        const profile = await tx.employmentProfile.upsert({
          where: { userId: input.userId },
          update: { position: input.position, grade: input.grade, dependents: input.dependents, callioExt: input.callioExt, startedAt: input.startedAt ? new Date(input.startedAt) : undefined },
          create: {
            facilityId: input.facilityId,
            userId: input.userId,
            position: input.position,
            grade: input.grade,
            dependents: input.dependents,
            callioExt: input.callioExt,
            startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
          },
        });
        // Đổi bậc → log cũ→mới + lý do; còn lại → log cập nhật hồ sơ thường.
        const body = gradeChanged
          ? `Đổi bậc ${existing!.grade ?? '—'}→${input.grade ?? '—'}: ${input.reason}`
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
        const quotaNote = input.monthlyQuota > 0 ? `, quota ${input.monthlyQuota.toLocaleString('vi-VN')}đ` : '';
        await logEvent(tx, { facilityId: rate.facilityId, entityType: 'salary_rate', entityId: rate.id, type: 'created', body: `Mức lương từ ${input.effectiveFrom}: LCB ${input.baseSalary.toLocaleString('vi-VN')}đ${quotaNote}`, actorId: ctx.session.userId });
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

  // Sync Callio (Phonenet) call metrics for a facility/period into frozen CallMetric snapshots
  // (decision 0010). Pulls the period's CDRs once, tallies valid outbound calls (>5s talk) per
  // extension, maps each extension to a staff member via EmploymentProfile.callioExt, and upserts
  // one row per (user, period). Token unset → no-op (returns synced: 0). Snapshot lets payslip
  // re-compute without re-hitting Callio (and survives later CDR edits).
  syncCallMetrics: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const cfg = callioConfigFromEnv();
        if (!cfg) return { synced: 0, skipped: 'callio-not-configured' as const };

        // Map extension → staff in this facility (only those with a Callio extension set).
        const profiles = await tx.employmentProfile.findMany({
          where: { facilityId: input.facilityId, callioExt: { not: null }, archivedAt: null },
          select: { userId: true, callioExt: true },
        });
        if (profiles.length === 0) return { synced: 0, skipped: 'no-mapped-extensions' as const };

        const { fromMs, toMs } = periodRangeMs(input.periodKey);
        const records = await fetchPeriodCdrs(cfg, fromMs, toMs);
        const byExt = aggregateValidCalls(records);

        let synced = 0;
        for (const p of profiles) {
          const tally = byExt.get(p.callioExt!) ?? { validCalls: 0, totalCalls: 0, totalTalkSec: 0 };
          await tx.callMetric.upsert({
            where: { userId_periodKey: { userId: p.userId, periodKey: input.periodKey } },
            update: { validCalls: tally.validCalls, totalCalls: tally.totalCalls, totalTalkSec: tally.totalTalkSec, syncedAt: new Date(), facilityId: input.facilityId },
            create: { facilityId: input.facilityId, userId: p.userId, periodKey: input.periodKey, validCalls: tally.validCalls, totalCalls: tally.totalCalls, totalTalkSec: tally.totalTalkSec },
          });
          synced += 1;
        }
        return { synced, skipped: null };
      }),
    ),

  // Read snapshotted call metrics for a facility/period (HR view).
  callMetricList: requireRole(...HR_ROLES)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.callMetric.findMany({ where: { facilityId: input.facilityId, periodKey: input.periodKey }, orderBy: { validCalls: 'desc' } }),
      ),
    ),

  // ─── KPI score: auto-compute snapshot + tree-based override + audit (decision 0011) ───
  // HR computes/auto-sets; managers (tree) override; HR + managers read.

  // Persist an auto-computed KPI score + breakdown for (user, period). HR/super (compute pipeline
  // P05/P06 calls this). Does NOT touch override fields — re-running auto keeps any manager override.
  kpiSetAuto: requireRole(Role.hr, Role.ke_toan)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        block: z.enum(['training', 'sales']),
        autoScore: z.number().min(0).max(100),
        autoBreakdown: z.array(z.object({ criterion: z.string(), weight: z.number(), score: z.number() })).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.kpiScore.upsert({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          update: { block: input.block, autoScore: input.autoScore, autoBreakdown: input.autoBreakdown ?? undefined, facilityId: input.facilityId },
          create: { facilityId: input.facilityId, userId: input.userId, periodKey: input.periodKey, block: input.block, autoScore: input.autoScore, autoBreakdown: input.autoBreakdown ?? undefined },
        }),
      ),
    ),

  // Manager override of a KPI score (tree authority — decision 0011). Sets overrideScore + reason
  // and logs the old→new change to the record_event timeline. The actor must rank above the target
  // (canOverrideKpi); nobody overrides their own KPI. Reason is mandatory.
  kpiOverride: requireRole(Role.quan_ly, Role.bgd, Role.head_teacher)
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
        const target = await tx.appUser.findUnique({ where: { id: input.userId }, select: { roles: true } });
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy nhân sự' });
        const actor = { userId: ctx.session.userId, roles: ctx.session.roles, isSuperAdmin: ctx.session.isSuperAdmin };
        if (!canOverrideKpi(actor, input.userId, target.roles)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Bạn không có quyền sửa KPI của nhân sự này' });
        }
        const row = await tx.kpiScore.findUnique({ where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } } });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có KPI auto cho kỳ này' });

        const prev = row.overrideScore ?? row.autoScore;
        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: { overrideScore: input.overrideScore, overrideReason: input.reason, overriddenById: ctx.session.userId, overriddenAt: new Date() },
        });
        // Minh bạch: ghi cũ→mới + lý do vào timeline (record_event.changes + body).
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          changes: [{ field: 'kpiScore', old: prev, new: input.overrideScore }],
          body: `Sửa KPI ${input.periodKey}: ${prev}→${input.overrideScore} — ${input.reason}`,
          actorId: ctx.session.userId,
        });
        return updated;
      }),
    ),

  // Read KPI scores for a facility/period (HR + managers). finalScore = override ?? auto.
  kpiList: requireRole(Role.hr, Role.ke_toan, Role.quan_ly, Role.bgd, Role.head_teacher)
    .input(z.object({ facilityId: z.number().int().positive(), periodKey: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.kpiScore.findMany({ where: { facilityId: input.facilityId, periodKey: input.periodKey }, orderBy: { createdAt: 'desc' } }),
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

        // CVTV new-customer commission rate = by QUOTA ATTAINMENT % (Excel PHỤ LỤC 02, nguồn chuẩn).
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
        // KPI score: optional. If a KpiScore row exists for the period, the auto/override score
        // there wins (decision 0011 — KPI is computed + tree-overridable). Manual input is a
        // fallback for employees without an auto KPI yet.
        kpiScore: z.number().min(0).max(100).optional(),
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

        // Compute with the CompensationPolicy effective at the period (CV6 — close the config loop):
        // PIT brackets/reliefs + KPI band come from the live policy, not hardcoded constants. KPI band
        // is block-specific — a 'sale' is graded on the sales band, everyone else on training.
        const params = await effectiveParamsAt(tx, input.periodKey);
        const emp = await tx.appUser.findUnique({ where: { id: input.userId }, select: { roles: true } });
        const block: 'training' | 'sales' = emp?.roles.includes(Role.sale) ? 'sales' : 'training';

        // KPI score precedence: KpiScore row (override ?? auto) → manual input → 0. So the auto/
        // overridden KPI drives the payslip; HR no longer has to retype it.
        const kpiRow = await tx.kpiScore.findUnique({ where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } } });
        const effectiveKpiScore = kpiRow ? (kpiRow.overrideScore ?? kpiRow.autoScore) : (input.kpiScore ?? 0);

        // S3 — Commission auto-feed: for sale staff, derive variablePay from the period's
        // approved receipts attributed to them (same logic as commissionForSale query).
        // Only applies to draft payslips (existing guard already rejects non-draft above).
        let effectiveVariablePay = input.variablePay;
        let effectiveVariableNote = input.variableNote;
        if (block === 'sales') {
          const quota = rate.monthlyQuota ?? 0;
          const [y, mo] = input.periodKey.split('-').map(Number);
          const periodStart = new Date(Date.UTC(y!, mo! - 1, 1));
          const periodEndDate = new Date(Date.UTC(y!, mo!, 1));
          const grouped = await tx.receipt.groupBy({
            by: ['kind'],
            where: {
              soldById: input.userId,
              facilityId: input.facilityId,
              status: { in: ['approved', 'sent', 'reconciled'] },
              approvedAt: { gte: periodStart, lt: periodEndDate },
            },
            _sum: { netAmount: true },
          });
          const newRevenue = grouped.find((g) => g.kind === 'new')?._sum.netAmount ?? 0;
          const renewalRevenue = grouped.find((g) => g.kind === 'renewal')?._sum.netAmount ?? 0;
          const attainment = quota > 0 ? newRevenue / quota : 0;
          const rateNew = cvtvNewCustomerRate(attainment, params);
          const rateRenew = renewalRate('cvtv', 1, params); // centreRetentionRatio default 1
          const commissionNew = commissionAmount(newRevenue, rateNew);
          const commissionRenewal = commissionAmount(renewalRevenue, rateRenew);
          const total = commissionNew + commissionRenewal;
          effectiveVariablePay = total;
          effectiveVariableNote =
            `Hoa hồng tự động kỳ ${input.periodKey}: mới ${commissionNew.toLocaleString('vi-VN')}đ + tái tục ${commissionRenewal.toLocaleString('vi-VN')}đ`;
        }

        const r = assemblePayslip(
          {
            baseSalary: rate.baseSalary,
            mealAllowance: rate.mealAllowance,
            otherAllowance: rate.otherAllowance,
            kpiMax: rate.kpiMax,
            kpiScore: effectiveKpiScore,
            block,
            workdays: input.workdays,
            standardDays: input.standardDays,
            variablePay: effectiveVariablePay,
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
          kpiScore: effectiveKpiScore,
          kpiGrade: r.kpiGrade,
          baseEarned: r.baseEarned,
          allowanceEarned: r.allowanceEarned,
          kpiBonus: r.kpiBonus,
          variablePay: r.variablePay,
          variableNote: effectiveVariableNote,
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
        for (const s of due) {
          await logEvent(tx, { facilityId: input.facilityId, entityType: 'payslip', entityId: s.id, type: 'status_changed', body: `Trả lương hàng loạt kỳ ${input.periodKey}`, changes: [{ field: 'status', old: 'finalized', new: 'paid' }], actorId: ctx.session.userId });
        }
        return { paidCount: due.length };
      }),
    ),

  // Bulk-pay specific finalized payslips by ID (max 100 at a time). Only finalized slips
  // belonging to ctx.facilityId are updated; slips already paid or from another facility
  // are silently placed in `failed`. Returns { succeeded, failed }.
  payslipBulkPay: requireRole(Role.hr, Role.ke_toan)
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Resolve which of the provided IDs are finalized slips in the caller's facility set.
        const slips = await tx.payslip.findMany({
          where: { id: { in: input.ids }, status: 'finalized' },
          select: { id: true, facilityId: true, periodKey: true },
        });
        // Only accept slips from facilities this user has access to (RLS already enforces this,
        // but we also want to surface failures explicitly rather than silently ignoring).
        const accessibleFacilityIds = new Set(ctx.session.facilityIds);
        const eligible = slips.filter((s) => accessibleFacilityIds.has(s.facilityId));
        const eligibleIds = new Set(eligible.map((s) => s.id));
        const failed = input.ids.filter((id) => !eligibleIds.has(id));

        if (eligible.length > 0) {
          const paidAt = new Date();
          await tx.payslip.updateMany({
            where: { id: { in: eligible.map((s) => s.id) } },
            data: { status: 'paid', paidAt },
          });
          for (const s of eligible) {
            await logEvent(tx, {
              facilityId: s.facilityId,
              entityType: 'payslip',
              entityId: s.id,
              type: 'status_changed',
              body: `Trả lương theo ID kỳ ${s.periodKey}`,
              changes: [{ field: 'status', old: 'finalized', new: 'paid' }],
              actorId: ctx.session.userId,
            });
          }
        }

        return { succeeded: eligible.map((s) => s.id), failed };
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

  // ─── Phiếu đánh giá KPI (P05, decision 0011) — workflow draft→submitted→confirmed→approved ───

  // Tạo/khởi tạo phiếu KPI cho (nhân sự, kỳ). HR/ke_toan hoặc super được phép.
  // Upsert với status=draft và điểm từng tiêu chí = 0. Không ghi đè nếu đã submitted+.
  kpiEvalStart: requireRole(Role.hr, Role.ke_toan)
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
        // Kiểm tra nếu đã có phiếu và status > draft → không đụng vào
        const existing = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (existing && existing.status !== 'draft') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu đã qua bước tự đánh giá — không thể khởi tạo lại' });
        }
        // Lấy tiêu chí từ policy hiệu lực (kpiCriteria[block])
        const params = await effectiveParamsAt(tx, input.periodKey);
        const criteria = params.kpiCriteria[input.block];
        const criterionScores = criteria.map((c) => ({ key: c.key, score: 0 }));
        const row = await tx.kpiScore.upsert({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          update: { block: input.block, criterionScores, autoScore: 0, facilityId: input.facilityId, status: 'draft' },
          create: {
            facilityId: input.facilityId,
            userId: input.userId,
            periodKey: input.periodKey,
            block: input.block,
            autoScore: 0,
            criterionScores,
            status: 'draft',
          },
        });
        await logEvent(tx, { facilityId: row.facilityId, entityType: 'kpi_score', entityId: row.id, type: 'created', body: `Khởi tạo phiếu KPI ${input.periodKey} (${input.block})`, actorId: ctx.session.userId });
        return row;
      }),
    ),

  // Nhân sự tự nộp phiếu KPI (tự đánh giá). Actor phải là chính chủ. Chỉ khi status=draft.
  kpiEvalSubmit: protectedProcedure
    .input(
      z.object({
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        scores: z.array(z.object({ key: z.string().min(1), score: z.number().min(0).max(100) })).min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Actor = chính chủ (userId từ session)
        const userId = ctx.session.userId;
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có phiếu KPI cho kỳ này — HR cần khởi tạo trước' });
        if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu đã nộp hoặc đã được xác nhận' });
        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: {
            criterionScores: input.scores,
            status: 'submitted',
            submittedById: userId,
            submittedAt: new Date(),
          },
        });
        await logEvent(tx, { facilityId: row.facilityId, entityType: 'kpi_score', entityId: row.id, type: 'status_changed', body: `Nộp phiếu KPI ${input.periodKey} (tự đánh giá)`, actorId: userId });
        // Notify managers (bgd + quan_ly) of this facility that a KPI evaluation is pending review.
        const facilityUsers = await tx.userFacility.findMany({
          where: { facilityId: row.facilityId },
          select: { userId: true, user: { select: { roles: true, displayName: true } } },
        });
        const managerIds = facilityUsers
          .filter((uf) => uf.user.roles.includes('bgd') || uf.user.roles.includes('quan_ly'))
          .map((uf) => uf.userId);
        const submitter = await tx.appUser.findUnique({ where: { id: userId }, select: { displayName: true } });
        const pushNotifs = await emitStaffNotif(tx, {
          recipientIds: managerIds,
          event: 'kpi_pending_review',
          title: 'Phiếu KPI chờ xác nhận',
          body: `${submitter?.displayName ?? userId} vừa nộp phiếu KPI kỳ ${input.periodKey}`,
          data: { kpiScoreId: row.id, periodKey: input.periodKey, submittedBy: userId },
          facilityId: row.facilityId,
        });
        return { updated, pushNotifs };
      }).then(({ pushNotifs, updated }) => { pushNotifs(); return updated; }),
    ),

  // Quản lý xác nhận phiếu KPI (N+1). Có thể sửa điểm trước khi confirm. Chỉ khi status=submitted.
  // Authz: canOverrideKpi(actor, target, targetRoles) — tức là manager phải rank trên nhân sự.
  kpiEvalConfirm: requireRole(Role.quan_ly, Role.head_teacher, Role.bgd)
    .input(
      z.object({
        userId: z.string().uuid(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        scores: z.array(z.object({ key: z.string().min(1), score: z.number().min(0).max(100) })).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const target = await tx.appUser.findUnique({ where: { id: input.userId }, select: { roles: true } });
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy nhân sự' });
        const actor = { userId: ctx.session.userId, roles: ctx.session.roles, isSuperAdmin: ctx.session.isSuperAdmin };
        if (!canOverrideKpi(actor, input.userId, target.roles)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Bạn không có quyền xác nhận KPI của nhân sự này' });
        }
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy phiếu KPI' });
        if (row.status !== 'submitted') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu chưa được nộp hoặc đã được phê duyệt' });

        const newScores = input.scores ?? (row.criterionScores as { key: string; score: number }[] | null) ?? [];
        const scoresChanged = input.scores !== undefined;
        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: {
            criterionScores: newScores,
            status: 'confirmed',
            confirmedById: ctx.session.userId,
            confirmedAt: new Date(),
          },
        });
        const body = scoresChanged
          ? `Xác nhận phiếu KPI ${input.periodKey} (có điều chỉnh điểm)`
          : `Xác nhận phiếu KPI ${input.periodKey}`;
        if (scoresChanged) {
          await logEvent(tx, { facilityId: row.facilityId, entityType: 'kpi_score', entityId: row.id, type: 'updated', changes: [{ field: 'criterionScores', old: row.criterionScores, new: newScores }], body, actorId: ctx.session.userId });
        } else {
          await logEvent(tx, { facilityId: row.facilityId, entityType: 'kpi_score', entityId: row.id, type: 'status_changed', body, actorId: ctx.session.userId });
        }
        return updated;
      }),
    ),

  // BGD phê duyệt phiếu KPI (N+2). Chỉ khi status=confirmed. Actor ≠ confirmedById (tách trách nhiệm).
  // Khi approve: tính autoScore = weightedKpi(criterionScores × policy weights).
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
        if (row.status !== 'confirmed') throw new TRPCError({ code: 'CONFLICT', message: 'Phiếu chưa được xác nhận (cần confirmed trước)' });
        // Tách trách nhiệm: người approve ≠ người confirm (N+1 ≠ N+2)
        if (row.confirmedById === ctx.session.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Người phê duyệt không thể đồng thời là người xác nhận' });
        }
        // Tính autoScore từ criterionScores + policy weights
        const params = await effectiveParamsAt(tx, input.periodKey);
        const block = row.block as 'training' | 'sales';
        const policyCriteria = params.kpiCriteria[block];
        const criterionScores = (row.criterionScores as { key: string; score: number }[] | null) ?? [];
        // Map từng key sang {criterion, weight, score} theo thứ tự policy
        const kpiInput = policyCriteria.map((pc) => {
          const cs = criterionScores.find((s) => s.key === pc.key);
          return { criterion: pc.key, weight: pc.weight, score: cs?.score ?? 0 };
        });
        const { score: autoScore, breakdown } = weightedKpi(kpiInput);
        const updated = await tx.kpiScore.update({
          where: { id: row.id },
          data: {
            autoScore,
            autoBreakdown: breakdown as unknown as object[],
            status: 'approved',
            approvedById: ctx.session.userId,
            approvedAt: new Date(),
          },
        });
        await logEvent(tx, { facilityId: row.facilityId, entityType: 'kpi_score', entityId: row.id, type: 'status_changed', body: `Phê duyệt phiếu KPI ${input.periodKey}: điểm ${autoScore}`, changes: [{ field: 'status', old: 'confirmed', new: 'approved' }], actorId: ctx.session.userId });
        return updated;
      }),
    ),

  // Auto-prefill quantitative KPI criteria from real data (P06, decision 0011).
  // HR/ke_toan triggers after kpiEvalStart; fills only the auto-computable keys and merges
  // them into criterionScores — preserving any manually-set keys unchanged.
  // Requires an existing KpiScore with status=draft (NOT_FOUND if missing, CONFLICT if non-draft).
  kpiAutoPrefill: requireRole(Role.hr, Role.ke_toan)
    .input(
      z.object({
        userId: z.string().uuid(),
        facilityId: z.number().int().positive(),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        // Guard: phiếu phải tồn tại và đang ở draft
        const row = await tx.kpiScore.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
        });
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chưa có phiếu KPI cho kỳ này — HR cần khởi tạo trước (kpiEvalStart)' });
        if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'Chỉ tự điền được phiếu đang ở trạng thái draft' });

        // Determine block from user roles
        const user = await tx.appUser.findUnique({ where: { id: input.userId }, select: { roles: true } });
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy nhân sự' });
        const block: 'sales' | 'training' = user.roles.includes(Role.sale) ? 'sales' : 'training';

        const { fromMs, toMs } = periodRangeMs(input.periodKey);
        const periodStart = new Date(fromMs);
        const periodEndDate = new Date(toMs); // exclusive

        // Collect validCalls from CallMetric snapshot (display only, not scored)
        const callMetric = await tx.callMetric.findUnique({
          where: { userId_periodKey: { userId: input.userId, periodKey: input.periodKey } },
          select: { validCalls: true },
        });
        const validCalls = callMetric?.validCalls ?? 0;

        // Computed result accumulator
        const computed: { key: string; score: number; dataAvailable: boolean }[] = [];
        let approvedRevenue = 0;
        let quota = 0;

        if (block === 'sales') {
          // SALES: doanh_so = ratioToScore(approvedRevenue / quota)
          const rate = await tx.salaryRate.findFirst({
            where: { userId: input.userId, archivedAt: null, effectiveFrom: { lte: periodEnd(input.periodKey) } },
            orderBy: { effectiveFrom: 'desc' },
            select: { monthlyQuota: true },
          });
          quota = rate?.monthlyQuota ?? 0;

          // Sum all approved/sent/reconciled receipts credited to this sale in this period
          const revenueAgg = await tx.receipt.aggregate({
            where: {
              soldById: input.userId,
              facilityId: input.facilityId,
              status: { in: ['approved', 'sent', 'reconciled'] },
              approvedAt: { gte: periodStart, lt: periodEndDate },
            },
            _sum: { netAmount: true },
          });
          approvedRevenue = revenueAgg._sum.netAmount ?? 0;

          const attainment = quota > 0 ? approvedRevenue / quota : 0;
          const doanhSoScore = ratioToScore(attainment);
          computed.push({ key: 'doanh_so', score: doanhSoScore, dataAvailable: quota > 0 });
        } else {
          // TRAINING: chuyen_mon + tuan_thu

          // chuyen_mon = avg(Grade.score / Grade.maxScore) × 100
          // where gradedById=user, facilityId, isPublished=true, gradedAt in period
          const grades = await tx.grade.findMany({
            where: {
              facilityId: input.facilityId,
              gradedById: input.userId,
              isPublished: true,
              gradedAt: { gte: periodStart, lt: periodEndDate },
            },
            select: { score: true, maxScore: true },
          });
          let chuyenMonScore = 0;
          const chuyenMonAvailable = grades.length > 0;
          if (chuyenMonAvailable) {
            const ratioSum = grades.reduce((acc, g) => acc + (g.maxScore > 0 ? g.score / g.maxScore : 0), 0);
            chuyenMonScore = Math.round((ratioSum / grades.length) * 100 * 100) / 100;
          }
          computed.push({ key: 'chuyen_mon', score: chuyenMonScore, dataAvailable: chuyenMonAvailable });

          // tuan_thu = (confirmed sessions with ≥1 Attendance.markedAt) / (all confirmed sessions) × 100
          // where teacherId=user, facilityId, sessionDate in period
          const allSessions = await tx.classSession.findMany({
            where: {
              facilityId: input.facilityId,
              teacherId: input.userId,
              status: 'confirmed',
              sessionDate: { gte: periodStart, lt: periodEndDate },
            },
            select: { id: true },
          });
          const totalSessions = allSessions.length;
          let tuanThuScore = 0;
          const tuanThuAvailable = totalSessions > 0;
          if (tuanThuAvailable) {
            // Count sessions that have at least one attendance with markedAt not null
            const sessionIds = allSessions.map((s) => s.id);
            const markedSessions = await tx.attendance.groupBy({
              by: ['classSessionId'],
              where: {
                classSessionId: { in: sessionIds },
                markedAt: { not: null },
              },
            });
            const markedCount = markedSessions.length;
            tuanThuScore = Math.round((markedCount / totalSessions) * 100 * 100) / 100;
          }
          computed.push({ key: 'tuan_thu', score: tuanThuScore, dataAvailable: tuanThuAvailable });
        }

        // Merge auto-computed keys into existing criterionScores (preserve manual keys)
        const existing = (row.criterionScores as { key: string; score: number }[] | null) ?? [];
        const autoKeySet = new Set(computed.map((c) => c.key));
        const merged = [
          ...existing.filter((e) => !autoKeySet.has(e.key)),
          ...computed.map((c) => ({ key: c.key, score: c.score })),
        ];

        await tx.kpiScore.update({
          where: { id: row.id },
          data: { criterionScores: merged },
        });

        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'kpi_score',
          entityId: row.id,
          type: 'updated',
          body: `Tự điền KPI định lượng ${input.periodKey}`,
          actorId: ctx.session.userId,
        });

        return {
          computed,
          context: { validCalls, approvedRevenue, quota },
        };
      }),
    ),

  // Đọc phiếu KPI + config tiêu chí (HR/quản lý/bgd/head_teacher đọc được).
  kpiEvalGet: requireRole(Role.hr, Role.ke_toan, Role.quan_ly, Role.bgd, Role.head_teacher)
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
        const block = row.block as 'training' | 'sales';
        return { row, criteriaConfig: params.kpiCriteria[block] };
      }),
    ),
});
