import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * Invariants for Bug A fix — schedule.generateSessions date-bounded conflict detection:
 *
 * 1. Room conflict is still detected when two batches share the same room/time on the same day.
 * 2. Teacher conflict is still detected when two batches share the same teacher/time on the same day.
 * 3. Conflict check does NOT load sessions outside the candidate date window:
 *    - An existing session on a different date (outside the candidate range) does NOT trigger a
 *      spurious conflict even if room/teacher match the incoming slots.
 * 4. Non-conflicting slots generate successfully.
 */
describe('schedule.generateSessions — date-bounded conflict detection (Bug A)', () => {
  const FAC = 1;

  let courseId: string;
  let batchAId: string; // already has sessions
  let batchBId: string; // the one we try to generate into
  let roomId: string;
  let teacherId: string;

  const sessionIdsToClean: string[] = [];
  const batchIds: string[] = [];

  beforeAll(async () => {
    // Shared course
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('CF-CRS'), name: 'Conflict Filter Course', program: 'UCREA' } }),
    );
    courseId = course.id;

    // Room used in conflict scenarios
    const room = await withRls(SUPER, (tx) =>
      tx.room.create({
        data: { facilityId: FAC, code: uniq('CF-R'), name: 'Conflict Filter Room' },
      }),
    );
    roomId = room.id;

    // Teacher (reuse super-admin user as teacher for simplicity)
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.findFirstOrThrow({ where: { isActive: true } }),
    );
    teacherId = user.id;

    // Batch A: exists to hold pre-created sessions that conflict
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('CF-A'), courseId, name: 'Conflict Batch A', status: 'running' },
      }),
    );
    batchAId = batchA.id;
    batchIds.push(batchAId);

    // Batch B: the target we will attempt to generate sessions into
    const batchB = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('CF-B'), courseId, name: 'Conflict Batch B', status: 'running' },
      }),
    );
    batchBId = batchB.id;
    batchIds.push(batchBId);
  });

  afterAll(async () => {
    if (sessionIdsToClean.length > 0) {
      await withRls(SUPER, (tx) =>
        tx.classSession.deleteMany({ where: { id: { in: sessionIdsToClean } } }),
      );
    }
    // Delete slots
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } }),
    );
    // Delete remaining sessions for our batches
    await withRls(SUPER, (tx) =>
      tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } }),
    );
    await withRls(SUPER, (tx) =>
      tx.classBatch.deleteMany({ where: { id: { in: batchIds } } }),
    );
    await withRls(SUPER, (tx) => tx.room.delete({ where: { id: roomId } }));
    await withRls(SUPER, (tx) => tx.course.delete({ where: { id: courseId } }));
  });

  it('detects room conflict: existing session on same date/room/time blocks new session', async () => {
    // Pre-create a session for batch A on 2099-11-10 using our room
    const existing = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batchAId,
          sessionDate: new Date('2099-11-10'),
          startTime: '08:00',
          endTime: '10:00',
          roomId,
          status: 'planned',
        },
      }),
    );
    sessionIdsToClean.push(existing.id);

    // Add a slot to batch B for the same day/time/room
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchBId,
          dayOfWeek: new Date('2099-11-10').getDay(), // day of week for that Monday
          startTime: '08:00',
          endTime: '10:00',
          roomId,
        },
      }),
    );

    const caller = await staffCaller();
    await expect(
      caller.schedule.generateSessions({
        classBatchId: batchBId,
        startDate: '2099-11-10',
        endDate: '2099-11-10',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes('Trùng lịch') || msg.includes('CONFLICT');
    });

    // Clean up slot
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: batchBId } }),
    );
  });

  it('detects teacher conflict: existing session with same teacher/time blocks new session', async () => {
    // Pre-create a session for batch A on 2099-11-12 with our teacher
    const existing = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batchAId,
          sessionDate: new Date('2099-11-12'),
          startTime: '14:00',
          endTime: '16:00',
          teacherId,
          status: 'planned',
        },
      }),
    );
    sessionIdsToClean.push(existing.id);

    // Batch B slot for same time/teacher
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchBId,
          dayOfWeek: new Date('2099-11-12').getDay(),
          startTime: '14:00',
          endTime: '16:00',
          teacherId,
        },
      }),
    );

    const caller = await staffCaller();
    await expect(
      caller.schedule.generateSessions({
        classBatchId: batchBId,
        startDate: '2099-11-12',
        endDate: '2099-11-12',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes('Trùng lịch') || msg.includes('CONFLICT');
    });

    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: batchBId } }),
    );
  });

  it('no spurious conflict: existing session outside candidate date window is ignored', async () => {
    // Pre-create a batch A session on 2099-12-01 (FAR outside the window we will generate)
    // with the same room as our slot — the date-bounded filter must NOT consider this.
    const farSession = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batchAId,
          sessionDate: new Date('2099-12-01'),
          startTime: '09:00',
          endTime: '11:00',
          roomId,
          status: 'planned',
        },
      }),
    );
    sessionIdsToClean.push(farSession.id);

    // Batch B gets a slot on 2099-11-20 — completely different date
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchBId,
          dayOfWeek: new Date('2099-11-20').getDay(),
          startTime: '09:00',
          endTime: '11:00',
          roomId, // same room — but date 2099-11-20 !== 2099-12-01 → no conflict
        },
      }),
    );

    const caller = await staffCaller();
    // Must succeed — the out-of-window session must NOT trigger a conflict
    const result = await caller.schedule.generateSessions({
      classBatchId: batchBId,
      startDate: '2099-11-20',
      endDate: '2099-11-20',
    });
    expect(result.created).toBe(1);

    // Clean up the generated session
    const gen = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchBId, sessionDate: new Date('2099-11-20') },
      }),
    );
    sessionIdsToClean.push(...gen.map((s) => s.id));

    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: batchBId } }),
    );
  });

  it('non-conflicting slot generates successfully', async () => {
    // No pre-existing sessions on 2099-11-25; slot uses no room or teacher overlap
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchBId,
          dayOfWeek: new Date('2099-11-25').getDay(),
          startTime: '07:00',
          endTime: '08:30',
          // no roomId, no teacherId
        },
      }),
    );

    const caller = await staffCaller();
    const result = await caller.schedule.generateSessions({
      classBatchId: batchBId,
      startDate: '2099-11-25',
      endDate: '2099-11-25',
    });
    expect(result.created).toBe(1);

    const gen = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchBId, sessionDate: new Date('2099-11-25') },
      }),
    );
    sessionIdsToClean.push(...gen.map((s) => s.id));

    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: batchBId } }),
    );
  });

  it('idempotent re-run with no new sessions returns created:0 and does not crash', async () => {
    // Regression for Bug A: an empty candidate set must early-return, not throw on reduce().
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchBId,
          dayOfWeek: new Date('2099-11-26').getDay(),
          startTime: '07:00',
          endTime: '08:30',
        },
      }),
    );

    const caller = await staffCaller();
    const first = await caller.schedule.generateSessions({
      classBatchId: batchBId,
      startDate: '2099-11-26',
      endDate: '2099-11-26',
    });
    expect(first.created).toBe(1);

    // Second identical run: nothing fresh → must NOT throw, returns created:0.
    const second = await caller.schedule.generateSessions({
      classBatchId: batchBId,
      startDate: '2099-11-26',
      endDate: '2099-11-26',
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);

    const gen = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchBId, sessionDate: new Date('2099-11-26') },
      }),
    );
    sessionIdsToClean.push(...gen.map((s) => s.id));
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: batchBId } }),
    );
  });
});
