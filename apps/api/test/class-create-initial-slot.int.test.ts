import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('classBatch.create initialSlot', () => {
  const FAC = 1;
  let courseId: string;
  let roomId: string;
  let teacherId: string;
  const batchIds: string[] = [];

  beforeAll(async () => {
    const [course, room, teacher] = await withRls(SUPER, async (tx) => Promise.all([
      tx.course.create({ data: { code: uniq('CLS-SLOT'), name: 'Initial Slot Course', program: 'UCREA' } }),
      tx.room.create({ data: { facilityId: FAC, code: uniq('CLS-R'), name: 'Initial Slot Room' } }),
      tx.appUser.findFirstOrThrow({ where: { isActive: true }, select: { id: true } }),
    ]));
    courseId = course.id;
    roomId = room.id;
    teacherId = teacher.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.room.delete({ where: { id: roomId } }).catch(() => {});
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
});
