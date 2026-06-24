import { withRls } from '@cmc/db';
import { logEvent } from '@cmc/audit';

// System context: the reminder runs across all facilities (cron has no session). super bypass.
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

export interface ReminderResult {
  meetingsReminded: number;
  notificationsCreated: number;
}

/**
 * Idempotent reminder tick (docs/specs/parent-meeting.md, PM2). Picks meetings with
 * `remindedAt = null`, `status = scheduled`, `timeConfirmed = true`, `scheduledAt ∈ [now, now+windowHours]`
 * (default T-1 day). Time-TBD meetings sit at UTC-midnight (a placeholder, not a real hour), so reminding
 * them would notify a fake time AND burn the `remindedAt` dedup slot before staff confirm the real time —
 * they are excluded until `setSchedule` flips `timeConfirmed`.
 * For each, creates one notification per ACTIVE enrolled student — recipientId = studentId so the
 * existing principal-aware notification feed surfaces it to that student's parents — then stamps
 * `remindedAt` in the SAME transaction, so a repeated tick never double-sends.
 */
export async function runParentMeetingReminders(windowHours = 24, now = new Date()): Promise<ReminderResult> {
  const horizon = new Date(now.getTime() + windowHours * 3_600_000);
  return withRls(SYSTEM_CTX, async (tx) => {
    const due = await tx.parentMeeting.findMany({
      where: { status: 'scheduled', timeConfirmed: true, remindedAt: null, archivedAt: null, scheduledAt: { gte: now, lte: horizon } },
      select: { id: true, facilityId: true, classBatchId: true, title: true, scheduledAt: true, location: true },
    });
    let notificationsCreated = 0;
    for (const m of due) {
      const enrollments = await tx.enrollment.findMany({
        where: { classBatchId: m.classBatchId, status: 'active', archivedAt: null },
        select: { studentId: true },
      });
      const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
      if (studentIds.length) {
        await tx.notification.createMany({
          data: studentIds.map((studentId) => ({
            facilityId: m.facilityId,
            recipientType: 'student',
            recipientId: studentId,
            type: 'parent_meeting_reminder',
            payload: {
              meetingId: m.id,
              classBatchId: m.classBatchId,
              title: m.title,
              scheduledAt: m.scheduledAt.toISOString(),
              location: m.location ?? null,
            },
          })),
        });
        notificationsCreated += studentIds.length;
      }
      await tx.parentMeeting.update({ where: { id: m.id }, data: { remindedAt: now } });
      await logEvent(tx, {
        facilityId: m.facilityId,
        entityType: 'parent_meeting',
        entityId: m.id,
        type: 'status_changed',
        body: `Đã nhắc họp PH "${m.title}" cho ${studentIds.length} học sinh`,
        actorId: null,
      });
    }
    return { meetingsReminded: due.length, notificationsCreated };
  });
}
