import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('schedule.removeSlot', () => {
  const FAC = 1;
  let courseId: string;
  const batchIds: string[] = [];

  beforeAll(async () => {
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('SRS-CRS'), name: 'Remove Slot Course', program: 'UCREA' } }),
    );
    courseId = course.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.classSession.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.scheduleSlot.deleteMany({ where: { classBatchId: { in: batchIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.course.delete({ where: { id: courseId } }).catch(() => {});
    });
  });

  async function makeBatch(code: string) {
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq(code), courseId, name: `Remove slot ${code}`, status: 'running' },
      }),
    );
    batchIds.push(batch.id);
    return batch;
  }

  it('archives the slot template, keeps generated sessions, and logs a timeline note', async () => {
    const batch = await makeBatch('SRS-ARCHIVE');
    const slot = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 2, startTime: '18:00', endTime: '19:00' },
      }),
    );
    const session = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FAC,
          classBatchId: batch.id,
          sessionDate: new Date('2095-01-04'),
          startTime: '18:00',
          endTime: '19:00',
          status: 'planned',
        },
      }),
    );

    const caller = await staffCaller();
    await caller.schedule.removeSlot({ slotId: slot.id });

    const listed = await caller.schedule.listSlots({ classBatchId: batch.id });
    expect(listed.find((s) => s.id === slot.id)).toBeUndefined();

    const archived = await withRls(SUPER, (tx) => tx.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } }));
    expect(archived.archivedAt).not.toBeNull();

    // The already-generated session is NOT deleted (audit/attendance integrity).
    const sessionAfter = await withRls(SUPER, (tx) => tx.classSession.findUniqueOrThrow({ where: { id: session.id } }));
    expect(sessionAfter.id).toBe(session.id);

    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'class_batch', entityId: batch.id, type: 'updated' } }),
    );
    expect(events.some((e) => e.body?.includes('Xóa khung lịch'))).toBe(true);
  });

  it('rejects giao_vien / sale from calling removeSlot (authz-deny)', async () => {
    const batch = await makeBatch('SRS-AUTHZ');
    const slot = await withRls(SUPER, (tx) =>
      tx.scheduleSlot.create({
        data: { facilityId: FAC, classBatchId: batch.id, dayOfWeek: 3, startTime: '09:00', endTime: '10:00' },
      }),
    );

    const teacher = await staffCaller({ primaryRole: Role.giao_vien, roles: [Role.giao_vien], isSuperAdmin: false, facilityIds: [FAC] });
    await expect(teacher.schedule.removeSlot({ slotId: slot.id })).rejects.toThrow();

    const sale = await staffCaller({ primaryRole: Role.sale, roles: [Role.sale], isSuperAdmin: false, facilityIds: [FAC] });
    await expect(sale.schedule.removeSlot({ slotId: slot.id })).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.scheduleSlot.findUniqueOrThrow({ where: { id: slot.id } }));
    expect(unchanged.archivedAt).toBeNull();
  });
});
