import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, superAdminProcedure, lmsProcedure } from '../trpc.js';
import { runParentMeetingReminders } from '../services/parent-meeting-reminder.js';
import { generateParentMeetings } from '../services/parent-meeting-cadence.js';

// Parent meetings are per-class and AUTO-GENERATED on a per-program cadence (docs/specs/parent-meeting.md,
// charter §4). There is no ad-hoc create: staff only list + transition status (done/cancelled); the schedule
// comes from the cadence generator (embedded cron / super-only tick). Parents read their own via RLS.
export const parentMeetingRouter = router({
  list: protectedProcedure
    .input(z.object({ facilityId: z.number().int().positive(), classBatchId: z.string().uuid().optional() }))
    .query(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), (tx) =>
        tx.parentMeeting.findMany({
          where: { facilityId: input.facilityId, archivedAt: null, ...(input.classBatchId ? { classBatchId: input.classBatchId } : {}) },
          orderBy: { scheduledAt: 'desc' },
          take: 200,
        }),
      ),
    ),

  setStatus: protectedProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(['scheduled', 'done', 'cancelled']) }))
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const before = await tx.parentMeeting.findUniqueOrThrow({ where: { id: input.id } });
        const m = await tx.parentMeeting.update({ where: { id: input.id }, data: { status: input.status } });
        await logEvent(tx, { facilityId: m.facilityId, entityType: 'parent_meeting', entityId: m.id, type: 'status_changed', body: `Lịch họp PH → ${input.status}`, changes: [{ field: 'status', old: before.status, new: input.status }], actorId: ctx.session.userId });
        return m;
      }),
    ),

  // Parent/student self-view: upcoming scheduled meetings for their enrolled classes (RLS pins).
  myMeetings: lmsProcedure.query(({ ctx }) =>
    withRls(lmsRlsContextOf(ctx.lms), (tx) =>
      tx.parentMeeting.findMany({
        where: { status: 'scheduled', archivedAt: null },
        orderBy: { scheduledAt: 'asc' },
        take: 50,
        select: { id: true, classBatchId: true, title: true, scheduledAt: true, location: true, note: true },
      }),
    ),
  ),

  // Manual reminder tick (ops/dev) — same idempotent logic the embedded cron runs. Super-only.
  runReminders: superAdminProcedure
    .input(z.object({ windowHours: z.number().int().positive().max(168).default(24) }).optional())
    .mutation(({ input }) => runParentMeetingReminders(input?.windowHours ?? 24)),

  // Manual cadence tick (ops/dev) — same idempotent generation the embedded cron runs. Super-only.
  runCadence: superAdminProcedure.mutation(() => generateParentMeetings()),
});
