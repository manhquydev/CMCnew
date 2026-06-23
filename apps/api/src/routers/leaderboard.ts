import { z } from 'zod';
import { withRls, type RlsContext } from '@cmc/db';
import { lmsRlsContextOf } from '@cmc/auth';
import { router, lmsProcedure } from '../trpc.js';

// Ranking needs to read classmates' stars/names, which a parent/student RLS context cannot see.
// So the endpoint is the authorization boundary: we FIRST verify (under the principal's own RLS)
// that the caller owns a student enrolled in the class, THEN compute the board under a system
// context and return it ANONYMIZED — only the caller's own student is shown by name (decision:
// in-class scope, anonymized-except-self). No classmate identity ever leaves the server.
const SYSTEM_RLS: RlsContext = { facilityIds: [], isSuperAdmin: true };

export const leaderboardRouter = router({
  // For one owned student: a per-class star ranking of each class they're enrolled in.
  forStudent: lmsProcedure
    .input(z.object({ studentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Ownership + enrollment scope, enforced by the principal's RLS (empty if not owned).
      const myClasses = await withRls(lmsRlsContextOf(ctx.lms), (tx) =>
        tx.enrollment.findMany({
          where: { studentId: input.studentId, status: 'active', archivedAt: null },
          select: { classBatchId: true, batch: { select: { code: true, name: true } } },
        }),
      );
      if (myClasses.length === 0) return [];

      return withRls(SYSTEM_RLS, async (tx) => {
        const boards = [];
        for (const c of myClasses) {
          const roster = await tx.enrollment.findMany({
            where: { classBatchId: c.classBatchId, status: 'active', archivedAt: null },
            select: { student: { select: { id: true, fullName: true } } },
          });
          const ids = roster.map((r) => r.student.id);
          const sums = await tx.starTransaction.groupBy({
            by: ['studentId'],
            where: { studentId: { in: ids } },
            _sum: { amount: true },
          });
          const balById = new Map(sums.map((s) => [s.studentId, s._sum.amount ?? 0]));

          const entries = roster
            .map((r) => ({ id: r.student.id, name: r.student.fullName, stars: balById.get(r.student.id) ?? 0 }))
            // Stars desc; stable tie-break by id so ranks are deterministic.
            .sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id))
            .map((e, i) => {
              const isMe = e.id === input.studentId;
              return { rank: i + 1, stars: e.stars, isMe, name: isMe ? e.name : `HS ${i + 1}` };
            });

          boards.push({
            classBatchId: c.classBatchId,
            className: c.batch.name,
            classCode: c.batch.code,
            total: entries.length,
            entries,
          });
        }
        return boards;
      });
    }),
});
