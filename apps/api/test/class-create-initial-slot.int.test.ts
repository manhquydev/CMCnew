import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('classBatch.create initialSlot', () => {
  const FAC = 1; // HQ — seeded
  const FAC2 = 2; // CS2 — seeded
  let courseId: string;
  let roomId: string; // FAC1 room
  let room2Id: string; // FAC2 room (cross-facility rejection fixture)
  let teacherId: string; // active giao_vien in FAC1
  let teacher2Id: string; // active giao_vien in FAC2 only
  const batchIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const [course, room1, room2, teacher1, teacher2] = await withRls(SUPER, async (tx) =>
      Promise.all([
        tx.course.create({ data: { code: uniq('CLS-SLOT'), name: 'Initial Slot Course', program: 'UCREA' } }),
        tx.room.create({ data: { facilityId: FAC, code: uniq('CLS-R'), name: 'Initial Slot Room FAC1' } }),
        tx.room.create({ data: { facilityId: FAC2, code: uniq('CLS-R'), name: 'Initial Slot Room FAC2' } }),
        tx.appUser.create({
          data: {
            email: uniq('cls-t1@cmc.test'),
            displayName: 'CLS Teacher 1',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC }] },
          },
        }),
        tx.appUser.create({
          data: {
            email: uniq('cls-t2@cmc.test'),
            displayName: 'CLS Teacher 2',
            passwordHash: 'dummy',
            primaryRole: 'giao_vien',
            roles: ['giao_vien'],
            isActive: true,
            facilities: { create: [{ facilityId: FAC2 }] },
          },
        }),
      ]),
    );
    courseId = course.id;
    roomId = room1.id;
    room2Id = room2.id;
    teacherId = teacher1.id;
    teacher2Id = teacher2.id;
    userIds.push(teacher1.id, teacher2.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.room.deleteMany({ where: { id: { in: [roomId, room2Id] } } }).catch(() => {});
      await tx.appUser.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
      await tx.course.delete({ where: { id: courseId } }).catch(() => {});
    });
  });

  it('creates a class and first weekly schedule slot atomically', async () => {
    const caller = await staffCaller();

    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Class with initial weekly slot',
      startDate: '2099-10-01',
      endDate: '2099-12-31',
      capacity: 16,
      initialSlot: {
        dayOfWeek: 2,
        startTime: '08:00',
        endTime: '10:00',
        roomId,
        teacherId,
      },
    });
    batchIds.push(batch.id);

    const slots = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.findMany({ where: { classBatchId: batch.id } }),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      facilityId: FAC,
      classBatchId: batch.id,
      dayOfWeek: 2,
      startTime: '08:00',
      endTime: '10:00',
      roomId,
      teacherId,
    });
  });

  it('rejects invalid initial slot time range before creating the class', async () => {
    const caller = await staffCaller();

    await expect(caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Invalid initial slot class',
      startDate: '2099-11-01',
      initialSlot: {
        dayOfWeek: 3,
        startTime: '10:00',
        endTime: '08:00',
      },
    })).rejects.toThrow();

    const leaked = await withRls(SUPER, (tx) =>
      tx.classBatch.findFirst({ where: { name: 'Invalid initial slot class' }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });

  it('creates a class without an initial slot (backward compatible)', async () => {
    const caller = await staffCaller();

    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Class without initial slot',
      startDate: '2099-10-01',
    });
    batchIds.push(batch.id);

    const slots = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.findMany({ where: { classBatchId: batch.id } }),
    );
    expect(slots).toHaveLength(0);
  });

  it('rejects a cross-facility room ref before creating the class', async () => {
    const caller = await staffCaller();

    // room2Id belongs to FAC2 but the class is created in FAC1.
    await expect(caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Cross-facility room class',
      startDate: '2099-10-01',
      initialSlot: {
        dayOfWeek: 2,
        startTime: '08:00',
        endTime: '10:00',
        roomId: room2Id,
        teacherId,
      },
    })).rejects.toThrow();

    const leaked = await withRls(SUPER, (tx) =>
      tx.classBatch.findFirst({ where: { name: 'Cross-facility room class' }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });

  it('rejects a teacher not belonging to the facility', async () => {
    const caller = await staffCaller();

    // teacher2Id is an active giao_vien but only in FAC2.
    await expect(caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Foreign teacher class',
      startDate: '2099-10-01',
      initialSlot: {
        dayOfWeek: 2,
        startTime: '08:00',
        endTime: '10:00',
        roomId,
        teacherId: teacher2Id,
      },
    })).rejects.toThrow();

    const leaked = await withRls(SUPER, (tx) =>
      tx.classBatch.findFirst({ where: { name: 'Foreign teacher class' }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });

});
