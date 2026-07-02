import { z } from 'zod';
import { withRls, type Prisma } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, requirePermission } from '../trpc.js';
import { kpiPendingConfirmItems, kpiPendingApproveItems } from './payroll.js';
import { receiptPendingItems } from './finance.js';

/** Item shape for the approval-inbox aggregate (dashboard.myApprovals). */
type ApprovalInboxItem = {
  domain: string;
  id: string;
  title: string;
  submittedAt: Date;
  actionKey: string;
};

function hasRole(roles: readonly string[], role: string): boolean {
  return roles.includes(role);
}

async function displayNamesFor(tx: Prisma.TransactionClient, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await tx.appUser.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

/** Mirrors levelProgress.listPending (level-progress.ts:52-68) — giam_doc_dao_tao only,
 *  RLS-scoped (no explicit facility filter, same as the original query). */
async function levelProgressPendingItems(tx: Prisma.TransactionClient): Promise<ApprovalInboxItem[]> {
  const rows = await tx.levelProgress.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fromLevel: true,
      toLevel: true,
      createdAt: true,
      student: { select: { fullName: true } },
    },
  });
  return rows.map((r) => ({
    domain: 'levelProgress',
    id: r.id,
    title: `Lên cấp độ ${r.fromLevel ?? '—'} → ${r.toLevel} — ${r.student.fullName}`,
    submittedAt: r.createdAt,
    actionKey: 'levelProgress.decide',
  }));
}

/** Mirrors rewards.pendingList (rewards.ts:111-130) — giam_doc_kinh_doanh only, RLS-scoped
 *  (no explicit facility filter, same as the original query). */
async function rewardsPendingItems(tx: Prisma.TransactionClient): Promise<ApprovalInboxItem[]> {
  const rewards = await tx.reward.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: {
      gift: { select: { name: true } },
      student: { select: { fullName: true } },
    },
  });
  return rewards.map((r) => ({
    domain: 'rewards',
    id: r.id,
    title: `Đổi quà: ${r.gift.name} — ${r.student.fullName} (${r.starsSpent} sao)`,
    submittedAt: r.createdAt,
    actionKey: 'rewards.review',
  }));
}

/** Mirrors shiftRegistration.list({status:'submitted'}) (shift-registration.ts:106-131),
 *  including its visibility scoping (visibleRegistrationWhere, :65-74) so the inbox never lists
 *  a registration the caller isn't the assigned (next-)manager for. Group-filtered by the
 *  caller's director domain (KINH_DOANH for giam_doc_kinh_doanh, GIAO_VIEN for giam_doc_dao_tao). */
async function shiftRegistrationPendingItems(
  tx: Prisma.TransactionClient,
  facilityId: number,
  groupCodes: string[],
  session: { userId: string; roles: readonly string[]; isSuperAdmin: boolean },
): Promise<ApprovalInboxItem[]> {
  if (groupCodes.length === 0) return [];
  const directorBypass = session.roles.some((r) => r === 'giam_doc_kinh_doanh' || r === 'giam_doc_dao_tao');
  const rows = await tx.shiftRegistration.findMany({
    where: {
      facilityId,
      status: 'submitted',
      archivedAt: null,
      shiftGroup: { code: { in: groupCodes } },
      ...(session.isSuperAdmin || directorBypass
        ? {}
        : { OR: [{ managerId: session.userId }, { nextManagerId: session.userId }] }),
    },
    orderBy: { submittedAt: 'asc' },
    select: { id: true, code: true, userId: true, submittedAt: true },
  });
  if (rows.length === 0) return [];
  const nameById = await displayNamesFor(tx, rows.map((r) => r.userId));
  return rows.map((r) => {
    const name = nameById.get(r.userId) ?? r.userId;
    return {
      domain: 'shiftRegistration',
      id: r.id,
      title: r.code ? `Đăng ký ca ${r.code} — ${name}` : `Đăng ký ca — ${name}`,
      submittedAt: r.submittedAt ?? new Date(0),
      actionKey: 'shiftRegistration.approve',
    };
  });
}

/** Mirrors checkInOut.pendingManual (check-in-out.ts:195-220), including its post-fetch
 *  manager-scoping filter (super_admin sees all; everyone else only their direct reports). */
async function manualPunchPendingItems(
  tx: Prisma.TransactionClient,
  facilityId: number,
  session: { userId: string; isSuperAdmin: boolean },
): Promise<ApprovalInboxItem[]> {
  const punches = await tx.timePunch.findMany({
    where: { facilityId, method: 'manual', approvedAt: null },
    orderBy: { timestamp: 'desc' },
    take: 50,
    select: { id: true, userId: true, timestamp: true },
  });
  let scoped = punches;
  if (!session.isSuperAdmin) {
    const userIds = [...new Set(punches.map((p) => p.userId))];
    const profiles = await tx.employmentProfile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, managerId: true },
    });
    const managerByUser = new Map(profiles.map((p) => [p.userId, p.managerId]));
    scoped = punches.filter((p) => managerByUser.get(p.userId) === session.userId);
  }
  if (scoped.length === 0) return [];
  const nameById = await displayNamesFor(tx, scoped.map((p) => p.userId));
  return scoped.map((p) => ({
    domain: 'manualPunch',
    id: p.id,
    title: `Chấm công thủ công — ${nameById.get(p.userId) ?? p.userId}`,
    submittedAt: p.timestamp,
    actionKey: 'checkInOut.approveManual',
  }));
}

// Read-only executive summary (BGĐ). Every figure is RLS-scoped to the caller's facilities,
// so a facility manager sees only their own numbers; super_admin/BGĐ see all assigned.
export const dashboardRouter = router({
  summary: requirePermission('dashboard', 'summary').query(({ ctx }) =>
    withRls(rlsContextOf(ctx.session), async (tx) => {
      const [revenue, studentsActive, classesOpen, oppOpen, oppByStage, oppWon] = await Promise.all([
        tx.receipt.aggregate({
          _sum: { netAmount: true },
          _count: { _all: true },
          where: { status: { in: ['approved', 'sent', 'reconciled'] } },
        }),
        tx.student.count({ where: { lifecycle: 'active', archivedAt: null } }),
        tx.classBatch.count({ where: { status: { in: ['open', 'running'] }, archivedAt: null } }),
        tx.opportunity.count({ where: { archivedAt: null, closedAt: null } }),
        tx.opportunity.groupBy({
          by: ['stage'],
          _count: { _all: true },
          where: { archivedAt: null, closedAt: null },
        }),
        tx.opportunity.count({ where: { stage: 'O5_ENROLLED', closedAt: { not: null } } }),
      ]);
      return {
        revenueTotal: revenue._sum.netAmount ?? 0,
        receiptsCount: revenue._count._all,
        studentsActive,
        classesOpen,
        opportunitiesOpen: oppOpen,
        opportunitiesWon: oppWon,
        pipeline: oppByStage
          .map((g) => ({ stage: g.stage, count: g._count._all }))
          .sort((a, b) => a.stage.localeCompare(b.stage)),
      };
    }),
  ),

  // Role-aware "pending my approval" inbox for the two director roles. Aggregates the 4 existing
  // pending-list queries (levelProgress.listPending, shiftRegistration.list, checkInOut.pendingManual,
  // rewards.pendingList) plus 3 new sources (KPI confirm/approve in payroll.ts, receipt approval in
  // finance.ts) into one normalized list. See plans/260701-2344-nav-restructuring-operator-executive.
  myApprovals: requirePermission('dashboard', 'myApprovals')
    .input(z.object({ facilityId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const { roles, userId, isSuperAdmin } = ctx.session;
        const isBiz = hasRole(roles, 'giam_doc_kinh_doanh');
        const isEdu = hasRole(roles, 'giam_doc_dao_tao');
        const session = { userId, roles, isSuperAdmin };

        const groupCodes: string[] = [];
        if (isBiz) groupCodes.push('KINH_DOANH');
        if (isEdu) groupCodes.push('GIAO_VIEN');

        const tasks: Promise<ApprovalInboxItem[]>[] = [];
        if (isBiz || isEdu) {
          tasks.push(kpiPendingConfirmItems(tx, input.facilityId));
          tasks.push(kpiPendingApproveItems(tx, input.facilityId, userId));
          tasks.push(shiftRegistrationPendingItems(tx, input.facilityId, groupCodes, session));
          tasks.push(manualPunchPendingItems(tx, input.facilityId, session));
        }
        if (isBiz) {
          tasks.push(receiptPendingItems(tx, input.facilityId));
          tasks.push(rewardsPendingItems(tx));
        }
        if (isEdu) {
          tasks.push(levelProgressPendingItems(tx));
        }

        const results = await Promise.all(tasks);
        return results.flat().sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
      }),
    ),
});
