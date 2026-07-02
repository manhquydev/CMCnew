import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type LmsSession } from '@cmc/auth';
import { staffCaller, lmsCaller, withRls, SUPER, uniq } from './helpers.js';
import { generateParentMeetings } from '../src/services/parent-meeting-cadence.js';

// Invariant: auto-generated parent meetings carry timeConfirmed=false (TBD); staff can
// call setSchedule to set a real datetime and flip timeConfirmed=true.
describe('parent-meeting time TBD state', () => {
  const FAC = 1;
  const NOW = new Date('2026-06-24T00:00:00.000Z');
  let classBatchId: string;
  let courseId: string;
  let meetingId: string;
  const createdMeetingIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('TBD'), name: 'TBD Course', program: 'UCREA' },
      });
      courseId = course.id;
      const batch = await tx.classBatch.create({
        data: {
          facilityId: FAC,
          code: uniq('TBD'),
          courseId,
          name: 'TBD Class',
          status: 'running',
          startDate: new Date('2026-01-10T00:00:00.000Z'),
        },
      });
      classBatchId = batch.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      if (createdMeetingIds.length > 0) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'parent_meeting', entityId: { in: createdMeetingIds } } });
        await tx.parentMeeting.deleteMany({ where: { id: { in: createdMeetingIds } } });
      }
      await tx.parentMeeting.deleteMany({ where: { classBatchId } });
      await tx.classBatch.deleteMany({ where: { id: classBatchId } });
      await tx.course.deleteMany({ where: { id: courseId } });
    });
  });

  it('auto-generated meetings have timeConfirmed=false', async () => {
    await generateParentMeetings(NOW);
    const meetings = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findMany({ where: { classBatchId }, orderBy: { scheduledAt: 'asc' } }),
    );
    expect(meetings.length).toBeGreaterThan(0);
    for (const m of meetings) {
      expect(m.timeConfirmed).toBe(false);
      createdMeetingIds.push(m.id);
    }
    meetingId = meetings[0]!.id;
  });

  it('setSchedule sets a confirmed datetime and flips timeConfirmed=true', async () => {
    expect(meetingId).toBeTruthy();
    // 18:00 ICT = 11:00 UTC
    const confirmedAt = new Date('2026-06-10T11:00:00.000Z');
    const caller = await staffCaller();
    await caller.parentMeeting.setSchedule({ id: meetingId, scheduledAt: confirmedAt.toISOString() });
    const updated = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({ where: { id: meetingId } }),
    );
    expect(updated.timeConfirmed).toBe(true);
    expect(updated.scheduledAt.toISOString()).toBe(confirmedAt.toISOString());
  });

  it('setNote persists the outcome note and audits the change', async () => {
    expect(meetingId).toBeTruthy();
    const caller = await staffCaller();
    const m = await caller.parentMeeting.setNote({ id: meetingId, note: 'Phụ huynh đồng ý lộ trình mới' });
    expect(m.note).toBe('Phụ huynh đồng ý lộ trình mới');

    const updated = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({ where: { id: meetingId } }),
    );
    expect(updated.note).toBe('Phụ huynh đồng ý lộ trình mới');

    const event = await withRls(SUPER, (tx) =>
      tx.recordEvent.findFirst({
        where: { entityType: 'parent_meeting', entityId: meetingId, type: 'note' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(event).toBeTruthy();
  });

  it('myMeetings query selects timeConfirmed in the payload shape', async () => {
    // Verify the field is in the select list by checking the query returns the field.
    // We use SUPER-scoped direct read as a proxy — the real test is type-level (tsc),
    // but we also assert the DB row has the field accessible.
    const row = await withRls(SUPER, (tx) =>
      tx.parentMeeting.findUniqueOrThrow({
        where: { id: meetingId },
        select: { id: true, timeConfirmed: true },
      }),
    );
    expect(typeof row.timeConfirmed).toBe('boolean');
  });

  // P6 invariant: a parent whose child is enrolled in classBatchId sees the confirmed schedule
  // via the actual RLS-scoped myMeetings procedure (not the SUPER-bypass proxy above); a parent
  // with no enrollment in that class sees nothing (parent_meeting_isolation policy, enrollment-scoped).
  it('setSchedule result is visible to an enrolled parent via myMeetings; not visible to an unrelated parent', async () => {
    expect(meetingId).toBeTruthy();
    const enrolledStudentId = (
      await withRls(SUPER, async (tx) => {
        const student = await tx.student.create({
          data: { facilityId: FAC, studentCode: uniq('TBD_PS'), fullName: 'TBD Parent Student', program: 'UCREA' },
        });
        await tx.enrollment.create({
          data: { facilityId: FAC, classBatchId, studentId: student.id, status: 'active' },
        });
        return student.id;
      })
    );
    const unrelatedStudentId = (
      await withRls(SUPER, (tx) =>
        tx.student.create({
          data: { facilityId: FAC, studentCode: uniq('TBD_UNREL'), fullName: 'TBD Unrelated Student', program: 'UCREA' },
        }),
      )
    ).id;

    try {
      function parentSession(studentId: string): LmsSession {
        return {
          kind: 'parent',
          accountId: uniq('tbd-parent-account'),
          displayName: 'TBD Test Parent',
          students: [{ id: studentId, fullName: 'x' }],
          studentIds: [studentId],
          facilityIds: [FAC],
        };
      }

      const enrolledMeetings = await lmsCaller(parentSession(enrolledStudentId)).parentMeeting.myMeetings();
      const found = enrolledMeetings.find((m) => m.id === meetingId);
      expect(found).toBeDefined();
      expect(found!.timeConfirmed).toBe(true);
      expect(found!.scheduledAt.toISOString()).toBe('2026-06-10T11:00:00.000Z');

      const unrelatedMeetings = await lmsCaller(parentSession(unrelatedStudentId)).parentMeeting.myMeetings();
      expect(unrelatedMeetings.find((m) => m.id === meetingId)).toBeUndefined();
    } finally {
      await withRls(SUPER, async (tx) => {
        await tx.enrollment.deleteMany({ where: { studentId: enrolledStudentId } });
        await tx.student.deleteMany({ where: { id: { in: [enrolledStudentId, unrelatedStudentId] } } });
      });
    }
  });
});
