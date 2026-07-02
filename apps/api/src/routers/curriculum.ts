import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf } from '@cmc/auth';
import { router, protectedProcedure } from '../trpc.js';

// CurriculumUnit is a GLOBAL framework table (no facility, no RLS) — like `course`.
// This round is read-only (seed + read); any future mutation must gate at the app layer.
export const curriculumRouter = router({
  listByCourse: protectedProcedure
    .input(z.object({ courseId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const units = await tx.curriculumUnit.findMany({
          where: { courseId: input.courseId },
          orderBy: { orderGlobal: 'asc' },
          select: {
            id: true,
            unitCode: true,
            seqInLevel: true,
            orderGlobal: true,
            unitType: true,
            assessment: true,
            theme: true,
            content: true,
            thinkingGoal: true,
            sessions: true,
          },
        });
        const totalSessions = units.reduce((sum, u) => sum + u.sessions, 0);
        return { units, unitCount: units.length, totalSessions };
      }),
    ),
});
