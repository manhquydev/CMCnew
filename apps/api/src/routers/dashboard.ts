import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, requireRole, Role } from '../trpc.js';

// Read-only executive summary (BGĐ). Every figure is RLS-scoped to the caller's facilities,
// so a facility manager sees only their own numbers; super_admin/BGĐ see all assigned.
export const dashboardRouter = router({
  summary: requireRole(Role.bgd, Role.quan_ly).query(({ ctx }) =>
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
});
