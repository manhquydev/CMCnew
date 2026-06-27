import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant: when a class batch transitions to a terminal state (closed|cancelled),
// future parent meetings (scheduledAt >= now, status=scheduled) must be soft-cancelled.
// Past meetings (scheduledAt < now) must NOT be touched (audit trail).
describe('class terminal state soft-cancels future parent meetings', () => {
  const FAC = 1;

  // Shared fixtures for setStatus test
  let setStatusBatchId = '';
  let futureMeetingId = '';
  let pastMeetingId = '';

  // Shared fixtures for cancel test
  let cancelBatchId = '';
  let cancelMeetingId = '';

  const courseIds: string[] = [];

  beforeAll(async () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    await withRls(SUPER, async (tx) => {
      // Course shared by both test batches
      const course = await tx.course.create({
        data: { code: uniq('CRS'), name: 'Cancel Meeting Test Course', program: 'UCREA' },
      });
      courseIds.push(course.id);

      // Batch for setStatus test (running → closed)
      const batch1 = await tx.classBatch.create({
        data: {
          facilityId: FAC,
          code: uniq('BATCH1'),
          courseId: course.id,
          name: 'Batch SetStatus Test',
          status: 'running',
        },
      });
      setStatusBatchId = batch1.id;

      // Future meeting — must be cancelled when class closes
      const fm = await tx.parentMeeting.create({
        data: {
          facilityId: FAC,
          classBatchId: batch1.id,
          title: 'Future Meeting',
          scheduledAt: future,
          // status defaults to 'scheduled'
        },
      });
      futureMeetingId = fm.id;

      // Past meeting — must stay scheduled (audit trail)
      const pm = await tx.parentMeeting.create({
        data: {
          facilityId: FAC,
          classBatchId: batch1.id,
          title: 'Past Meeting',
          scheduledAt: past,
        },
      });
      pastMeetingId = pm.id;

      // Batch for cancel test
      const batch2 = await tx.classBatch.create({
        data: {
          facilityId: FAC,
          code: uniq('BATCH2'),
          courseId: course.id,
          name: 'Batch Cancel Test',
          status: 'running',
        },
      });
      cancelBatchId = batch2.id;

      const cm = await tx.parentMeeting.create({
        data: {
          facilityId: FAC,
          classBatchId: batch2.id,
          title: 'Future Meeting for Cancel',
          scheduledAt: future,
        },
      });
      cancelMeetingId = cm.id;
    });
  });

  afterAll(async () => {
    const batchIds = [setStatusBatchId, cancelBatchId].filter(Boolean);
    const meetingIds = [futureMeetingId, pastMeetingId, cancelMeetingId].filter(Boolean);

    await withRls(SUPER, async (tx) => {
      if (batchIds.length > 0) {
        await tx.recordEvent.deleteMany({
          where: { entityType: 'class_batch', entityId: { in: batchIds } },
        });
      }
      if (meetingIds.length > 0) {
        await tx.parentMeeting.deleteMany({ where: { id: { in: meetingIds } } });
      }
      if (batchIds.length > 0) {
        await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      }
      if (courseIds.length > 0) {
        await tx.course.deleteMany({ where: { id: { in: courseIds } } });
      }
    });
  });

  it('setStatus(closed): future meeting cancelled, past meeting stays scheduled', async () => {
    const caller = await staffCaller();
    await caller.classBatch.setStatus({ id: setStatusBatchId, status: 'closed' });

    const [future, past] = await withRls(SUPER, (tx) =>
      Promise.all([
        tx.parentMeeting.findUniqueOrThrow({ where: { id: futureMeetingId } }),
        tx.parentMeeting.findUniqueOrThrow({ where: { id: pastMeetingId } }),
      ]),
    );

    expect(future.status).toBe('cancelled');
    expect(past.status).toBe('scheduled');
  });

  it('cancel: future scheduled meeting becomes cancelled', async () => {
    const caller = await staffCaller();
    await caller.classBatch.cancel({ id: cancelBatchId, reason: 'test cancellation' });

    const meeting = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({ where: { id: cancelMeetingId } }),
    );

    expect(meeting.status).toBe('cancelled');
  });
});
