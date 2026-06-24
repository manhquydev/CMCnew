import { withRls } from '@cmc/db';
import { logEvent } from '@cmc/audit';
import { parentMeetingSchedule } from '@cmc/domain-academic';

// System context: cadence generation runs across all facilities (cron has no session). super bypass.
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };
const HORIZON_MONTHS = 12;
const AUTO_MEETING_TITLE = 'Họp phụ huynh định kỳ';

export interface CadenceResult {
  classesScanned: number;
  meetingsCreated: number;
}

/**
 * Idempotent auto-cadence (docs/specs/parent-meeting.md, charter §4). For every RUNNING class with a
 * start date, generate the per-program meeting schedule (UCREA 5mo, Bright I.G / Black Hole 3mo)
 * anchored on the class start, up to the class end or `now + 12 months`. Dates are deterministic and
 * the (classBatchId, scheduledAt) unique constraint + `skipDuplicates` make repeated runs a no-op —
 * each tick only adds meetings newly inside the horizon or for newly-running classes.
 */
export async function generateParentMeetings(now = new Date()): Promise<CadenceResult> {
  const horizonEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + HORIZON_MONTHS, now.getUTCDate()));
  return withRls(SYSTEM_CTX, async (tx) => {
    const classes = await tx.classBatch.findMany({
      where: { status: 'running', startDate: { not: null }, archivedAt: null },
      select: { id: true, facilityId: true, startDate: true, endDate: true, course: { select: { program: true } } },
    });
    let meetingsCreated = 0;
    for (const c of classes) {
      if (!c.startDate) continue;
      const dates = parentMeetingSchedule({
        program: c.course.program,
        startDate: c.startDate,
        endDate: c.endDate,
        horizonEnd,
      });
      if (!dates.length) continue;
      const res = await tx.parentMeeting.createMany({
        data: dates.map((scheduledAt) => ({
          facilityId: c.facilityId,
          classBatchId: c.id,
          title: AUTO_MEETING_TITLE,
          scheduledAt,
        })),
        skipDuplicates: true,
      });
      if (res.count > 0) {
        meetingsCreated += res.count;
        await logEvent(tx, {
          facilityId: c.facilityId,
          entityType: 'class_batch',
          entityId: c.id,
          type: 'created',
          body: `Auto-sinh ${res.count} lịch họp phụ huynh định kỳ`,
          actorId: null,
        });
      }
    }
    return { classesScanned: classes.length, meetingsCreated };
  });
}
