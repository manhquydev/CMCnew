import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

/**
 * Deep test suite for schedule session lifecycle:
 * - Session status transitions via batch cancellation
 * - Cancelled sessions excluded from conflict detection
 * - Attendance cascade on session cancellation
 * - Edge cases: zero slots, date boundaries
 */
describe('schedule session lifecycle — status transitions and attendance', () => {
  const FAC = 1;

  let courseId: string;
  let roomId: string;
  let teacherId: string;
  let studentId: string;

  const sessionIdsToClean: string[] = [];
  const batchIds: string[] = [];

  beforeAll(async () => {
    // Shared course
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('SLC-CRS'), name: 'Session Lifecycle Course', program: 'UCREA' } }),
    );
    courseId = course.id;

    // Shared room
    const room = await withRls(SUPER, (tx) =>
      tx.room.create({
        data: { facilityId: FAC, code: uniq('SLC-R'), name: 'Session Lifecycle Room' },
      }),
    );
    roomId = room.id;

    // Shared teacher
    const user = await withRls(SUPER, (tx) =>
      tx.appUser.findFirstOrThrow({ where: { isActive: true } }),
    );
    teacherId = user.id;

    // Student for attendance testing
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: {
          facilityId: FAC,
          studentCode: uniq('SLC-STU'),
          fullName: 'SLC Student',
          program: 'UCREA',
        },
      }),
    );
    studentId = student.id;
  });

  afterAll(async () => {
    // Delete attendance records
    await withRls(SUPER, (tx) =>
      tx.attendance.deleteMany({ where: { classSessionId: { in: sessionIdsToClean } } }),
    );
    // Delete sessions
    if (sessionIdsToClean.length > 0) {
      await withRls(SUPER, (tx) =>
        tx.classSession.deleteMany({ where: { id: { in: sessionIdsToClean } } }),
      );
    }
    // Delete slots
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } }),
    );
    // Delete remaining sessions
    await withRls(SUPER, (tx) =>
      tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } }),
    );
    // Delete enrollments
    await withRls(SUPER, (tx) =>
      tx.enrollment.deleteMany({ where: { classBatchId: { in: batchIds } } }),
    );
    // Delete student
    if (studentId) {
      await withRls(SUPER, (tx) =>
        tx.student.delete({ where: { id: studentId } }),
      );
    }
    // Delete batches
    await withRls(SUPER, (tx) =>
      tx.classBatch.deleteMany({ where: { id: { in: batchIds } } }),
    );
    // Delete room
    await withRls(SUPER, (tx) => tx.room.delete({ where: { id: roomId } }));
    // Delete course
    await withRls(SUPER, (tx) => tx.course.delete({ where: { id: courseId } }));
  });

  it('cancelled batch cascades session status: future sessions transition planned→cancelled', async () => {
    // Create fresh batch for this test
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-A1'), courseId, name: 'Lifecycle Batch A1', status: 'running' },
      }),
    );
    batchIds.push(batchA.id);

    // Add slot to batch A
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          dayOfWeek: new Date('2099-08-01').getDay(),
          startTime: '10:00',
          endTime: '11:30',
          roomId,
        },
      }),
    );

    // Generate sessions for batch A (Aug 1)
    const caller = await staffCaller();
    const genA = await caller.schedule.generateSessions({
      classBatchId: batchA.id,
      startDate: '2099-08-01',
      endDate: '2099-08-01',
    });
    expect(genA.created).toBe(1);

    // Retrieve the generated session
    const sessionsBefore = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchA.id, sessionDate: new Date('2099-08-01') },
      }),
    );
    const sessionA = sessionsBefore[0];
    sessionIdsToClean.push(sessionA.id);
    expect(sessionA.status).toBe('planned');

    // Cancel the batch
    const cancelResult = await caller.classBatch.cancel({
      id: batchA.id,
      reason: 'Testing cascade on future sessions',
    });
    expect(cancelResult.cancelledSessions).toBe(1);

    // Verify session status changed to cancelled
    const sessionAfter = await withRls(SUPER, (tx) =>
      tx.classSession.findUniqueOrThrow({ where: { id: sessionA.id } }),
    );
    expect(sessionAfter.status).toBe('cancelled');
  });

  it('conflict detection excludes cancelled sessions: batch B can use same room/time after batch A cancelled', async () => {
    // Create fresh batches for this test
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-A2'), courseId, name: 'Lifecycle Batch A2', status: 'running' },
      }),
    );
    batchIds.push(batchA.id);

    const batchB = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-B2'), courseId, name: 'Lifecycle Batch B2', status: 'running' },
      }),
    );
    batchIds.push(batchB.id);

    // Add slot to batch A on 2099-08-10
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          dayOfWeek: new Date('2099-08-10').getDay(),
          startTime: '14:00',
          endTime: '15:30',
          roomId, // same room
        },
      }),
    );

    // Generate session for batch A
    const caller = await staffCaller();
    const genA = await caller.schedule.generateSessions({
      classBatchId: batchA.id,
      startDate: '2099-08-10',
      endDate: '2099-08-10',
    });
    expect(genA.created).toBe(1);

    // Get and record the session
    const sessionARows = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchA.id, sessionDate: new Date('2099-08-10') },
      }),
    );
    const sessionA = sessionARows[0];
    sessionIdsToClean.push(sessionA.id);

    // Cancel batch A (cascades session to cancelled)
    await caller.classBatch.cancel({
      id: batchA.id,
      reason: 'Testing conflict exclusion of cancelled sessions',
    });

    // Now add identical slot to batch B
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchB.id,
          dayOfWeek: new Date('2099-08-10').getDay(),
          startTime: '14:00',
          endTime: '15:30',
          roomId, // same room as batch A's cancelled session
        },
      }),
    );

    // Batch B should succeed — cancelled session must not trigger conflict
    const genB = await caller.schedule.generateSessions({
      classBatchId: batchB.id,
      startDate: '2099-08-10',
      endDate: '2099-08-10',
    });
    expect(genB.created).toBe(1);

    // Record session for cleanup
    const sessionBRows = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchB.id, sessionDate: new Date('2099-08-10') },
      }),
    );
    sessionIdsToClean.push(sessionBRows[0].id);
  });

  it('attendance.mark persists after session cancellation (no cascade delete)', async () => {
    // Create fresh batch for this test
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-A3'), courseId, name: 'Lifecycle Batch A3', status: 'running' },
      }),
    );
    batchIds.push(batchA.id);

    // Enrollment in batch A (for attendance testing)
    const enroll = await withRls(SUPER, (tx) =>
      tx.enrollment.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          studentId,
          status: 'active',
        },
      }),
    );

    // Add slot to batch A
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          dayOfWeek: new Date('2099-08-20').getDay(),
          startTime: '09:00',
          endTime: '10:30',
        },
      }),
    );

    // Generate session
    const caller = await staffCaller();
    const genA = await caller.schedule.generateSessions({
      classBatchId: batchA.id,
      startDate: '2099-08-20',
      endDate: '2099-08-20',
    });
    expect(genA.created).toBe(1);

    // Retrieve the session
    const sessionsForAttend = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchA.id, sessionDate: new Date('2099-08-20') },
      }),
    );
    const session = sessionsForAttend[0];
    sessionIdsToClean.push(session.id);

    // Mark attendance
    const attendBefore = await caller.attendance.mark({
      facilityId: FAC,
      classSessionId: session.id,
      enrollmentId: enroll.id,
      status: 'present',
      excused: false,
    });
    expect(attendBefore.status).toBe('present');
    expect(attendBefore.classSessionId).toBe(session.id);

    // Cancel the batch
    await caller.classBatch.cancel({
      id: batchA.id,
      reason: 'Testing attendance persistence after cancellation',
    });

    // Verify session is now cancelled
    const sessionAfterCancel = await withRls(SUPER, (tx) =>
      tx.classSession.findUniqueOrThrow({ where: { id: session.id } }),
    );
    expect(sessionAfterCancel.status).toBe('cancelled');

    // Verify attendance record still exists (no cascade delete)
    const attendAfter = await withRls(SUPER, (tx) =>
      tx.attendance.findUnique({
        where: {
          classSessionId_enrollmentId: {
            classSessionId: session.id,
            enrollmentId: enroll.id,
          },
        },
      }),
    );
    expect(attendAfter).toBeDefined();
    expect(attendAfter?.status).toBe('present');
  });

  it('generateSessions.created:0 on empty slots raises BAD_REQUEST', async () => {
    // Create fresh batch with no slots
    const batchB = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-B4'), courseId, name: 'Lifecycle Batch B4', status: 'running' },
      }),
    );
    batchIds.push(batchB.id);

    const caller = await staffCaller();
    // This should throw because batch has no slots
    await expect(
      caller.schedule.generateSessions({
        classBatchId: batchB.id,
        startDate: '2099-08-25',
        endDate: '2099-08-25',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return msg.includes('Lớp chưa có khung lịch') || msg.includes('BAD_REQUEST');
    });
  });

  it('idempotent generateSessions on same date range returns 0 created, skipped > 0', async () => {
    // Create fresh batch for this test
    const batchB = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-B5'), courseId, name: 'Lifecycle Batch B5', status: 'running' },
      }),
    );
    batchIds.push(batchB.id);

    // Add a fresh slot to batch B
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchB.id,
          dayOfWeek: new Date('2099-08-30').getDay(),
          startTime: '07:00',
          endTime: '08:00',
        },
      }),
    );

    const caller = await staffCaller();

    // First run: creates session
    const first = await caller.schedule.generateSessions({
      classBatchId: batchB.id,
      startDate: '2099-08-30',
      endDate: '2099-08-30',
    });
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(0);

    // Second identical run: must skip, not crash
    const second = await caller.schedule.generateSessions({
      classBatchId: batchB.id,
      startDate: '2099-08-30',
      endDate: '2099-08-30',
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);

    // Record session for cleanup
    const gen = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchB.id, sessionDate: new Date('2099-08-30') },
      }),
    );
    sessionIdsToClean.push(...gen.map((s) => s.id));
  });

  it('mySessions includes cancelled sessions (status not filtered)', async () => {
    // Create fresh batch for this test
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-A6'), courseId, name: 'Lifecycle Batch A6', status: 'running' },
      }),
    );
    batchIds.push(batchA.id);

    // Add slot to batch A
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          dayOfWeek: new Date('2099-09-15').getDay(),
          startTime: '11:00',
          endTime: '12:00',
          teacherId,
        },
      }),
    );

    const caller = await staffCaller();

    // Generate session
    const genA = await caller.schedule.generateSessions({
      classBatchId: batchA.id,
      startDate: '2099-09-15',
      endDate: '2099-09-15',
    });
    expect(genA.created).toBe(1);

    // Query mySessions (before cancellation)
    const sessionsBeforeCancel = await caller.schedule.mySessions({
      facilityId: FAC,
      from: '2099-09-15',
      to: '2099-09-15',
      teacherId,
    });
    expect(sessionsBeforeCancel.length).toBe(1);
    expect(sessionsBeforeCancel[0].status).toBe('planned');

    // Record session for cleanup
    sessionIdsToClean.push(sessionsBeforeCancel[0].id);

    // Cancel batch A (cascades future session to cancelled)
    await caller.classBatch.cancel({
      id: batchA.id,
      reason: 'Testing mySessions includes cancelled sessions',
    });

    // Query mySessions (after cancellation)
    const sessionsAfterCancel = await caller.schedule.mySessions({
      facilityId: FAC,
      from: '2099-09-15',
      to: '2099-09-15',
      teacherId,
    });

    // Cancelled sessions are NOT filtered out by mySessions
    // (the router doesn't have a status filter — this may be intentional design)
    expect(sessionsAfterCancel.length).toBe(1);
    expect(sessionsAfterCancel[0].status).toBe('cancelled');
  });

  it('date-range boundary: mySessions respects from/to date even for cancelled sessions', async () => {
    // Create fresh batch for this test
    const batchA = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('SLC-A7'), courseId, name: 'Lifecycle Batch A7', status: 'running' },
      }),
    );
    batchIds.push(batchA.id);

    // Add a single slot that will span multiple dates
    await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: {
          facilityId: FAC,
          classBatchId: batchA.id,
          dayOfWeek: 1, // Monday
          startTime: '13:00',
          endTime: '14:00',
          teacherId,
        },
      }),
    );

    const caller = await staffCaller();

    // Generate sessions across a week
    const genA = await caller.schedule.generateSessions({
      classBatchId: batchA.id,
      startDate: '2099-09-20',
      endDate: '2099-09-26',
    });
    expect(genA.created).toBeGreaterThan(0); // At least one Monday in the range

    // Record all for cleanup
    const sessionsForMondays = await withRls(SUPER, (tx) =>
      tx.classSession.findMany({
        where: { classBatchId: batchA.id, sessionDate: { gte: new Date('2099-09-20'), lte: new Date('2099-09-26') } },
      }),
    );
    sessionIdsToClean.push(...sessionsForMondays.map((s) => s.id));

    // Cancel batch (cascades all future sessions)
    await caller.classBatch.cancel({
      id: batchA.id,
      reason: 'Testing date-range boundary on cancelled sessions',
    });

    // Query narrow date range: only Sept 20
    const narrowRange = await caller.schedule.mySessions({
      facilityId: FAC,
      from: '2099-09-20',
      to: '2099-09-20',
      teacherId,
    });

    // Should return only the session(s) in that range
    const allInRange = narrowRange.every((s) => s.sessionDate >= new Date('2099-09-20') && s.sessionDate <= new Date('2099-09-20'));
    expect(allInRange).toBe(true);

    // Query wide range: all
    const wideRange = await caller.schedule.mySessions({
      facilityId: FAC,
      from: '2099-09-20',
      to: '2099-09-26',
      teacherId,
    });
    expect(wideRange.length).toBe(genA.created);
  });
});
