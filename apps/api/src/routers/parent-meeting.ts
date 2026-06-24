import { z } from 'zod';
import { withRls } from '@cmc/db';
import { rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
import { logEvent } from '@cmc/audit';
import { router, protectedProcedure, superAdminProcedure, lmsProcedure } from '../trpc.js';
import { runParentMeetingReminders } from '../services/parent-meeting-reminder.js';

// Parent meetings are per-class (docs/specs/parent-meeting.md). Staff create/list/transition;
// parents/students read their own classes' upcoming meetings (RLS via enrollment). Reminders are
// sent by the embedded cron (or the manual super-only tick) — never by these write paths.
export const parentMeetingRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        facilityId: z.number().int().positive(),
        classBatchId: z.string().uuid(),
        title: z.string().min(1),
        scheduledAt: z.string().datetime(),
        location: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withRls(rlsContextOf(ctx.session), async (tx) => {
        const m = await tx.parentMeeting.create({
          data: {
            facilityId: input.facilityId,
            classBatchId: input.classBatchId,
            title: input.title,
            scheduledAt: new Date(input.scheduledAt),
            location: input.location,
            note: input.note,
            createdById: ctx.session.userId,
          },
        });
        await logEvent(tx, { facilityId: m.facilityId, entityType: 'parent_meeting', entityId: m.id, type: 'created', body: `Tạo lịch họp PH "${m.title}"`, actorId: ctx.session.userId });
        return m;
      }),
    ),

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
});
