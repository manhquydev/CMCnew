import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, staffSession, withRls, SUPER, uniq } from './helpers.js';

describe('audit.timeline — resolved actorName', () => {
  const FAC = 1;
  let courseId: string;
  let batchId: string;
  let actorUserId: string;
  let actorDisplayName: string;

  beforeAll(async () => {
    const course = await withRls(SUPER, (tx) =>
      tx.course.create({ data: { code: uniq('ATA-CRS'), name: 'Actor Name Course', program: 'UCREA' } }),
    );
    courseId = course.id;
    const batch = await withRls(SUPER, (tx) =>
      tx.classBatch.create({
        data: { facilityId: FAC, code: uniq('ATA'), courseId, name: 'Actor name batch', status: 'planned' },
      }),
    );
    batchId = batch.id;

    const session = await staffSession();
    actorUserId = session.userId;
    const actor = await withRls(SUPER, (tx) => tx.appUser.findUniqueOrThrow({ where: { id: actorUserId } }));
    actorDisplayName = actor.displayName;
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'class_batch', entityId: batchId } });
      await tx.classBatch.delete({ where: { id: batchId } }).catch(() => {});
      await tx.course.delete({ where: { id: courseId } }).catch(() => {});
    });
  });

  it('resolves actorId to a human display name instead of leaving it raw', async () => {
    const caller = await staffCaller({ userId: actorUserId });
    // name is no longer part of the update input (always tracks the auto-generated code) —
    // capacity exercises the same actor-resolution path just as well.
    await caller.classBatch.update({ id: batchId, capacity: 15 });

    const timeline = await caller.audit.timeline({ entityType: 'class_batch', entityId: batchId });
    const entry = timeline.find((e) => e.type === 'updated');
    expect(entry).toBeTruthy();
    expect(entry!.actorName).toBe(actorDisplayName);
    expect(entry!.actorName).not.toBe('Hệ thống');
  });
});
