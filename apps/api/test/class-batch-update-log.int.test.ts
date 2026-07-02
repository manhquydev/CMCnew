import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('classBatch.update — diff log + courseId immutable', () => {
  const FAC = 1;
  let courseId: string;
  let otherCourseId: string;
  const batchIds: string[] = [];

  beforeAll(async () => {
    const [course, otherCourse] = await withRls(SUPER, async (tx) =>
      Promise.all([
        tx.course.create({ data: { code: uniq('CBU-CRS'), name: 'Update Log Course', program: 'UCREA' } }),
        tx.course.create({ data: { code: uniq('CBU-CRS2'), name: 'Other Course', program: 'UCREA' } }),
      ]),
    );
    courseId = course.id;
    otherCourseId = otherCourse.id;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'class_batch', entityId: { in: batchIds } } });
      await tx.classBatch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.course.deleteMany({ where: { id: { in: [courseId, otherCourseId] } } }).catch(() => {});
    });
  });

  async function makeBatch() {
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('CBU'), courseId, name: 'Original name', capacity: 20, status: 'planned' },
      }),
    );
    batchIds.push(batch.id);
    return batch;
  }

  it('updates name + capacity and logs a diff with old→new for each changed field', async () => {
    const batch = await makeBatch();
    const caller = await staffCaller();

    await caller.classBatch.update({ id: batch.id, name: 'Renamed class', capacity: 25 });

    const updated = await withRls(SUPER, (tx) => tx.classBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(updated.name).toBe('Renamed class');
    expect(updated.capacity).toBe(25);

    const events = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({ where: { entityType: 'class_batch', entityId: batch.id, type: 'updated' } }),
    );
    expect(events.length).toBeGreaterThan(0);
    const changes = events[0]!.changes as { field: string; old: unknown; new: unknown }[];
    const byField = new Map(changes.map((c) => [c.field, c]));
    expect(byField.get('name')).toMatchObject({ old: 'Original name', new: 'Renamed class' });
    expect(byField.get('capacity')).toMatchObject({ old: 20, new: 25 });
  });

  it('courseId in the input is silently stripped — the course never changes', async () => {
    const batch = await makeBatch();
    const caller = await staffCaller();

    // courseId isn't part of the update schema — zod strips it, no throw expected.
    await caller.classBatch.update({
      id: batch.id,
      name: 'Still same course',
      // @ts-expect-error courseId is intentionally not part of the update input
      courseId: otherCourseId,
    });

    const after = await withRls(SUPER, (tx) => tx.classBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(after.courseId).toBe(courseId); // unchanged, despite the attempted override
  });

  it('rejects giao_vien / sale from calling update (authz-deny)', async () => {
    const batch = await makeBatch();
    const teacher = await staffCaller({
      primaryRole: Role.giao_vien,
      roles: [Role.giao_vien],
      isSuperAdmin: false,
      facilityIds: [FAC],
    });
    await expect(teacher.classBatch.update({ id: batch.id, name: 'Should not apply' })).rejects.toThrow();

    const sale = await staffCaller({
      primaryRole: Role.sale,
      roles: [Role.sale],
      isSuperAdmin: false,
      facilityIds: [FAC],
    });
    await expect(sale.classBatch.update({ id: batch.id, name: 'Should not apply' })).rejects.toThrow();

    const unchanged = await withRls(SUPER, (tx) => tx.classBatch.findUniqueOrThrow({ where: { id: batch.id } }));
    expect(unchanged.name).toBe('Original name');
  });
});
