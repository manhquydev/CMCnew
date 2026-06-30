import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Facility-scoping guard for schedule-slot room/teacher refs (review fix for
// commit b28af8c). schedule.addSlot must reject cross-facility / fabricated
// refs before persisting — parity with classBatch.create.initialSlot.
describe('schedule.addSlot facility-scoping guard', () => {
  const FAC = 1; // HQ — seeded
  const FAC2 = 2; // CS2 — seeded
  let courseId: string;
  let batchId: string;
  let roomId: string; // FAC1 room
  let room2Id: string; // FAC2 room (cross-facility rejection fixture)
  let teacherId: string; // active giao_vien in FAC1
  const userIds: string[] = [];

  beforeAll(async () => {
    const [course, room1, room2, teacher] = await withRls(SUPER, async (tx) =>
      Promise.all([
        tx.course.create({ data: { code: uniq('ADD-SLOT'), name: 'Add Slot Course', program: 'UCREA' } }),
        tx.room.create({ data: { facilityId: FAC, code: uniq('AS-R'), name: 'Add Slot Room FAC1' } }),
        tx.room.create({ data: { facilityId: FAC2, code: uniq('AS-R'), name: 'Add Slot Room FAC2' } }),
        tx.appUser.create({
          data: {
            email: uniq('as-t1@cmc.test'),
            displayName: 'Add Slot Teacher',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC }] },
          },
        }),
      ]),
    );
    courseId = course.id;
    roomId = room1.id;
    room2Id = room2.id;
    teacherId = teacher.id;
    userIds.push(teacher.id);

    // Create the batch via the tRPC caller (auto-generates the batch code).
    const caller = await staffCaller();
    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Add Slot Batch',
      startDate: '2099-10-01',
    });
    batchId = batch.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.scheduleSlot.deleteMany({ where: { classBatchId: batchId } }).catch(() => {});
      await tx.classBatch.deleteMany({ where: { id: batchId } }).catch(() => {});
      await tx.room.deleteMany({ where: { id: { in: [roomId, room2Id] } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
      await tx.course.delete({ where: { id: courseId } }).catch(() => {});
    });
  });

  it('adds a slot with a same-facility room and teacher', async () => {
    const caller = await staffCaller();
    const slot = await caller.schedule.addSlot({
      facilityId: FAC,
      classBatchId: batchId,
      dayOfWeek: 2,
      startTime: '08:00',
      endTime: '10:00',
      roomId,
      teacherId,
    });
    expect(slot).toMatchObject({
      classBatchId: batchId,
      dayOfWeek: 2,
      startTime: '08:00',
      endTime: '10:00',
      roomId,
      teacherId,
    });
  });

  it('rejects a cross-facility room ref before creating the slot', async () => {
    const caller = await staffCaller();

    // room2Id belongs to FAC2; the batch (and thus the slot) is in FAC1.
    await expect(caller.schedule.addSlot({
      facilityId: FAC,
      classBatchId: batchId,
      dayOfWeek: 3,
      startTime: '14:00',
      endTime: '16:00',
      roomId: room2Id,
    })).rejects.toThrow();

    // No slot with this day/time should have been created.
    const leaked = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.findFirst({
        where: { classBatchId: batchId, dayOfWeek: 3, startTime: '14:00' },
        select: { id: true },
      }),
    );
    expect(leaked).toBeNull();
  });
});
