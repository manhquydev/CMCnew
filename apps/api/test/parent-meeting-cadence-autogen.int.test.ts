import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';
import { generateParentMeetings } from '../src/services/parent-meeting-cadence.js';

// Invariant (backlog T13 / charter §4): the system auto-generates per-class parent meetings on a
// per-program cadence (UCREA 5mo) anchored on class start, for RUNNING classes only, idempotently.
// Ad-hoc creation is removed. We drive the real generation service with a FIXED `now` so the horizon
// (now+12mo) and the expected schedule are deterministic regardless of when the suite runs.
describe('parent-meeting auto-cadence generation (T13)', () => {
  const FAC = 1;
  const NOW = new Date('2026-06-24T00:00:00.000Z');
  let runningClassId: string;
  let plannedClassId: string;
  const courseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code: uniq('CRS'), name: 'Cadence Course', program: 'UCREA' } });
      courseIds.push(course.id);
      // UCREA, start 2026-01-10 → meetings at +5/+10/+15 months within the now+12mo horizon (2027-06-24):
      // 2026-06-10, 2026-11-10, 2027-04-10 (2027-09-10 is past the horizon).
      runningClassId = (await tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('RUN'), courseId: course.id, name: 'Running', status: 'running', startDate: new Date('2026-01-10T00:00:00.000Z') },
      })).id;
      // A class not yet running must get NO meetings.
      plannedClassId = (await tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('PLAN'), courseId: course.id, name: 'Planned', status: 'planned', startDate: new Date('2026-01-10T00:00:00.000Z') },
      })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'class_batch', entityId: { in: [runningClassId, plannedClassId] } } });
      await tx.parentMeeting.deleteMany({ where: { classBatchId: { in: [runningClassId, plannedClassId] } } });
      await tx.classBatch.deleteMany({ where: { id: { in: [runningClassId, plannedClassId] } } });
      await tx.course.deleteMany({ where: { id: { in: courseIds } } });
    });
  });

  const meetingsOf = (classBatchId: string) =>
    withRls(SUPER, (tx) => tx.parentMeeting.findMany({ where: { classBatchId }, orderBy: { scheduledAt: 'asc' } }));

  it('generates the per-program schedule for a running class; none for a planned class', async () => {
    await generateParentMeetings(NOW);
    const running = await meetingsOf(runningClassId);
    expect(running.map((m) => m.scheduledAt.toISOString().slice(0, 10))).toEqual(['2026-06-10', '2026-11-10', '2027-04-10']);
    expect(running.every((m) => m.title === 'Họp phụ huynh định kỳ')).toBe(true);
    expect(await meetingsOf(plannedClassId)).toHaveLength(0);
  });

  it('is idempotent: a second run adds no duplicate meetings', async () => {
    const before = await meetingsOf(runningClassId);
    await generateParentMeetings(NOW);
    const after = await meetingsOf(runningClassId);
    expect(after).toHaveLength(before.length); // (classBatchId, scheduledAt) unique + skipDuplicates
  });

  it('ad-hoc creation is removed from the router (calling create is NOT_FOUND)', async () => {
    const caller = await staffCaller();
    const adHoc = (caller.parentMeeting as Record<string, (i: unknown) => Promise<unknown>>).create;
    await expect(
      adHoc({ facilityId: FAC, classBatchId: runningClassId, title: 'đột xuất', scheduledAt: NOW.toISOString() }),
    ).rejects.toThrow(/No procedure found|NOT_FOUND/i);
  });
});
