import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant: when a cancelled class is reopened, future soft-cancelled parent meetings
// (scheduledAt >= now, status=cancelled) must be restored to 'scheduled'.
// Past cancelled meetings must NOT be touched (audit trail).
describe('class reopen restores future soft-cancelled parent meetings', () => {
  const FAC = 1;

  let batchId = '';
  let futureMeetingId = '';
  let pastMeetingId = '';
  const courseIds: string[] = [];

  beforeAll(async () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('CRS'), name: 'Reopen Restore Test Course', program: 'UCREA' },
      });
      courseIds.push(course.id);

      const batch = await tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('REOPEN'), courseId: course.id, name: 'Reopen Test Batch', status: 'running' },
      });
      batchId = batch.id;

      const fm = await tx.parentMeeting.create({
        data: { facilityId: FAC, classBatchId: batch.id, title: 'Future Meeting', scheduledAt: future },
      });
      futureMeetingId = fm.id;

      const pm = await tx.parentMeeting.create({
        data: { facilityId: FAC, classBatchId: batch.id, title: 'Past Meeting', scheduledAt: past, status: 'cancelled' },
      });
      pastMeetingId = pm.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'class_batch', entityId: batchId } });
      await tx.parentMeeting.deleteMany({ where: { id: { in: [futureMeetingId, pastMeetingId] } } });
      await tx.classBatch.deleteMany({ where: { id: batchId } });
      await tx.course.deleteMany({ where: { id: { in: courseIds } } });
    });
  });

  it('reopen restores future soft-cancelled meeting; past cancelled meeting stays cancelled', async () => {
    const caller = await staffCaller();

    // Cancel the class (soft-cancels the future meeting)
    await caller.classBatch.cancel({ id: batchId, reason: 'test cancel' });

    const afterCancel = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({ where: { id: futureMeetingId } }),
    );
    expect(afterCancel.status).toBe('cancelled');

    // Reopen to running
    await caller.classBatch.reopen({ id: batchId, toStatus: 'running', reason: 'test reopen' });

    const [afterReopen, pastAfterReopen] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.parentMeeting.findUniqueOrThrow({ where: { id: futureMeetingId } }),
        tx.parentMeeting.findUniqueOrThrow({ where: { id: pastMeetingId } }),
      ]),
    );

    expect(afterReopen.status).toBe('scheduled');
    // Past meeting was already cancelled before reopen; must not be affected.
    expect(pastAfterReopen.status).toBe('cancelled');
  });
});
