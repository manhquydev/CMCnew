import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('classBatch.create — multi-slot', () => {
  const FAC = 1; // HQ — seeded
  const FAC2 = 2; // CS2 — seeded
  let courseId: string;
  let roomId: string;
  let room2Id: string;
  let teacherId: string;
  const batchIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const [course, room1, room2, teacher1] = await withRls(SUPER, async (tx) =>
      Promise.all([
        tx.course.create({ data: { code: uniq('CBM-CRS'), name: 'Multi Slot Course', program: 'UCREA' } }),
        tx.room.create({ data: { facilityId: FAC, code: uniq('CBM-R'), name: 'Multi Slot Room FAC1' } }),
        tx.room.create({ data: { facilityId: FAC2, code: uniq('CBM-R2'), name: 'Multi Slot Room FAC2' } }),
        tx.appUser.create({
          data: {
            email: uniq('cbm-t1@cmc.test'),
            displayName: 'CBM Teacher 1',
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
    teacherId = teacher1.id;
    userIds.push(teacher1.id);
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

  it('creates a class with 2 weekly slots (T2 + T5) atomically', async () => {
    const caller = await staffCaller();
    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Class with 2 slots',
      startDate: '2099-10-01',
      slots: [
        { dayOfWeek: 2, startTime: '08:00', endTime: '10:00', roomId, teacherId },
        { dayOfWeek: 5, startTime: '18:00', endTime: '19:30', roomId, teacherId },
      ],
    });
    batchIds.push(batch.id);

    const slots = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.findMany({ where: { classBatchId: batch.id }, orderBy: { dayOfWeek: 'asc' } }),
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ dayOfWeek: 2, startTime: '08:00' });
    expect(slots[1]).toMatchObject({ dayOfWeek: 5, startTime: '18:00' });
  });

  it('still accepts the legacy singular initialSlot (backward compatible)', async () => {
    const caller = await staffCaller();
    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Class with legacy initialSlot',
      startDate: '2099-10-01',
      initialSlot: { dayOfWeek: 3, startTime: '09:00', endTime: '10:00', roomId, teacherId },
    });
    batchIds.push(batch.id);

    const slots = await withRls(SUPER, (tx) => tx.scheduleSlot.findMany({ where: { classBatchId: batch.id } }));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ dayOfWeek: 3, startTime: '09:00' });
  });

  it('rejects a cross-facility room ref in any slot before creating the class', async () => {
    const caller = await staffCaller();
    await expect(
      caller.classBatch.create({
        facilityId: FAC,
        courseId,
        name: 'Cross-facility slot class',
        startDate: '2099-10-01',
        slots: [
          { dayOfWeek: 2, startTime: '08:00', endTime: '10:00', roomId, teacherId },
          { dayOfWeek: 5, startTime: '18:00', endTime: '19:30', roomId: room2Id, teacherId },
        ],
      }),
    ).rejects.toThrow();

    const leaked = await withRls(SUPER, (tx) =>
      tx.classBatch.findFirst({ where: { name: 'Cross-facility slot class' }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });

  it('rejects two slots with the same (dayOfWeek, startTime) instead of silently dropping one', async () => {
    const caller = await staffCaller();
    await expect(
      caller.classBatch.create({
        facilityId: FAC,
        courseId,
        name: 'Duplicate slot class',
        startDate: '2099-10-01',
        slots: [
          { dayOfWeek: 2, startTime: '18:00', endTime: '19:00' },
          { dayOfWeek: 2, startTime: '18:00', endTime: '20:00' },
        ],
      }),
    ).rejects.toThrow();

    const leaked = await withRls(SUPER, (tx) =>
      tx.classBatch.findFirst({ where: { name: 'Duplicate slot class' }, select: { id: true } }),
    );
    expect(leaked).toBeNull();
  });

  it('creates a class with zero slots (backward compatible)', async () => {
    const caller = await staffCaller();
    const batch = await caller.classBatch.create({
      facilityId: FAC,
      courseId,
      name: 'Class with no slots',
      startDate: '2099-10-01',
    });
    batchIds.push(batch.id);

    const slots = await withRls(SUPER, (tx) => tx.scheduleSlot.findMany({ where: { classBatchId: batch.id } }));
    expect(slots).toHaveLength(0);
  });
});
