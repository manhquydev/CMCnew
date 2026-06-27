import { describe, it, expect, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 5 / docs/specs/parent-meeting.md, PM2): parent meetings are scheduled
// per-class, and the reminder tick is IDEMPOTENT via the `remindedAt` flag on the meeting itself.
// A meeting due in the T-1 window is reminded exactly once; a repeated tick must NOT re-send and
// must NOT overwrite the original `remindedAt`. We drive the real super-only `runReminders`
// mutation (same code path the embedded cron runs) twice against a seeded class + meeting.
describe('parent-meeting reminder idempotency (remindedAt dedup)', () => {
  const FACILITY = 1;
  const made = { meetingIds: [] as string[], batchIds: [] as string[], courseIds: [] as string[] };

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.parentMeeting.deleteMany({ where: { id: { in: made.meetingIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: made.batchIds } } });
      await tx.course.deleteMany({ where: { id: { in: made.courseIds } } });
    });
  });

  // A minimal class batch in facility 1 (Course -> ClassBatch). No enrollments needed: the dedup
  // invariant lives on the meeting's `remindedAt`, independent of how many notifications fan out.
  async function seedClassBatch(): Promise<string> {
    return withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('CRS'), name: 'Test Course', program: 'UCREA' },
      });
      made.courseIds.push(course.id);
      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('BATCH'), courseId: course.id, name: 'Test Batch' },
      });
      made.batchIds.push(batch.id);
      return batch.id;
    });
  }

  const remindedAtOf = (id: string) =>
    withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({ where: { id } }).then((m) => m.remindedAt),
    );

  it('reminds a due meeting once; a second tick is a no-op and does not overwrite remindedAt', async () => {
    const caller = await staffCaller();
    const classBatchId = await seedClassBatch();

    // Meeting due ~12h out → inside the default [now, now+24h] reminder window. Seeded directly
    // (ad-hoc create was removed by the auto-cadence change; cadence-gen owns meeting creation).
    const scheduledAt = new Date(Date.now() + 12 * 3_600_000);
    const meeting = await withRls(SUPER, (tx) =>
      tx.parentMeeting.create({ data: { facilityId: FACILITY, classBatchId, title: 'Họp phụ huynh định kỳ', scheduledAt, timeConfirmed: true } }),
    );
    made.meetingIds.push(meeting.id);
    expect(meeting.remindedAt).toBeNull();

    // First tick: this meeting is due → reminded exactly once, remindedAt stamped.
    const first = await caller.parentMeeting.runReminders({ windowHours: 24 });
    expect(first.meetingsReminded).toBeGreaterThanOrEqual(1);
    const stampedAt = await remindedAtOf(meeting.id);
    expect(stampedAt).not.toBeNull();

    // Second tick: the same meeting is now `remindedAt != null` → excluded from the due set.
    // The dedup must hold even if other unrelated due meetings exist, so assert on THIS meeting.
    const second = await caller.parentMeeting.runReminders({ windowHours: 24 });
    const stampedAtAfter = await remindedAtOf(meeting.id);

    // remindedAt set once, never overwritten to a new effect by the repeat tick.
    expect(stampedAtAfter).toEqual(stampedAt);
    // And the second tick reminded strictly fewer meetings than the first (our meeting dropped out).
    expect(second.meetingsReminded).toBeLessThan(first.meetingsReminded);
  });

  // A time-TBD meeting (timeConfirmed=false, sitting at placeholder midnight) must NOT be reminded:
  // reminding it would notify a fake hour AND stamp remindedAt, permanently suppressing the real
  // reminder once staff confirm the time. It stays remindedAt=null through a tick that covers its window.
  it('does not remind a time-TBD meeting; it stays eligible for a reminder after the time is confirmed', async () => {
    const caller = await staffCaller();
    const classBatchId = await seedClassBatch();
    const scheduledAt = new Date(Date.now() + 12 * 3_600_000);
    const tbd = await withRls(SUPER, (tx) =>
      tx.parentMeeting.create({ data: { facilityId: FACILITY, classBatchId, title: 'Họp phụ huynh định kỳ', scheduledAt } }),
    );
    made.meetingIds.push(tbd.id);
    expect(tbd.timeConfirmed).toBe(false);

    // Tick over its window → TBD meeting is excluded, remindedAt untouched.
    await caller.parentMeeting.runReminders({ windowHours: 24 });
    expect(await remindedAtOf(tbd.id)).toBeNull();

    // Staff confirm the real time → now eligible; the next tick reminds it once.
    await caller.parentMeeting.setSchedule({ id: tbd.id, scheduledAt });
    await caller.parentMeeting.runReminders({ windowHours: 24 });
    expect(await remindedAtOf(tbd.id)).not.toBeNull();
  });
});
