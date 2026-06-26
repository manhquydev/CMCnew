/**
 * Chatter timeline for the 'student' entity type:
 *   1. audit.timeline returns events scoped to the requested student (RLS-safe).
 *   2. audit.postNote appends a 'note' event visible in the next timeline fetch.
 *   3. A different student's timeline returns only its own events (isolation).
 *   4. An entity type not in NOTE_TARGETS (e.g. 'user') is rejected with BAD_REQUEST.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Program } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('audit.timeline / postNote — student entity', () => {
  const FACILITY = 1;
  let studentAId: string;
  let studentBId: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const a = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('CHAT_A'),
          fullName: 'Chatter Student A',
          program: Program.UCREA,
        },
      });
      studentAId = a.id;

      const b = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('CHAT_B'),
          fullName: 'Chatter Student B',
          program: Program.UCREA,
        },
      });
      studentBId = b.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordFollower.deleteMany({
        where: { entityType: 'student', entityId: { in: [studentAId, studentBId] } },
      });
      await tx.recordEvent.deleteMany({
        where: { entityType: 'student', entityId: { in: [studentAId, studentBId] } },
      });
      await tx.student.deleteMany({ where: { id: { in: [studentAId, studentBId] } } });
    });
  });

  it('timeline is empty for a fresh student record', async () => {
    const caller = await staffCaller();
    const events = await caller.audit.timeline({ entityType: 'student', entityId: studentAId });
    expect(events).toHaveLength(0);
  });

  it('postNote appends a note event visible in the timeline', async () => {
    const caller = await staffCaller();
    const body = `Ghi chú test ${uniq('note')}`;

    await caller.audit.postNote({ entityType: 'student', entityId: studentAId, body });

    const events = await caller.audit.timeline({ entityType: 'student', entityId: studentAId });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const note = events.find((e) => e.type === 'note' && e.body === body);
    expect(note).toBeDefined();
  });

  it('timeline for student B is isolated from student A events', async () => {
    const caller = await staffCaller();

    // Student B has no notes yet
    const bEvents = await caller.audit.timeline({ entityType: 'student', entityId: studentBId });
    const aEvents = await caller.audit.timeline({ entityType: 'student', entityId: studentAId });

    // A has at least one note; B should have none
    expect(aEvents.length).toBeGreaterThanOrEqual(1);
    expect(bEvents).toHaveLength(0);
  });

  it('unknown entityType rejected with BAD_REQUEST', async () => {
    const caller = await staffCaller();
    await expect(
      caller.audit.timeline({ entityType: 'user', entityId: studentAId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('non-existent entityId rejected with NOT_FOUND', async () => {
    const caller = await staffCaller();
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(
      caller.audit.timeline({ entityType: 'student', entityId: fakeId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
