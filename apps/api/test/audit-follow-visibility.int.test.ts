import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Invariant (security-class tenancy): `audit.follow` must NOT allow a staff member to follow
// an entity outside their facility scope. The entity must be resolved through RLS before
// the follower row is written — same gate as postNote.
describe('audit.follow — facility-scoped visibility gate (tenancy)', () => {
  const A = 1; // HQ
  const B = 2; // CS2
  let batchA: string;
  let batchB: string;
  const courseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code: uniq('CRS'), name: 'Follow Course', program: 'UCREA' } });
      courseIds.push(course.id);
      batchA = (await tx.classBatch.create({ data: { facilityId: A, code: uniq('FA'), courseId: course.id, name: 'A follow batch' } })).id;
      batchB = (await tx.classBatch.create({ data: { facilityId: B, code: uniq('FB'), courseId: course.id, name: 'B follow batch' } })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordFollower.deleteMany({ where: { entityType: 'class_batch', entityId: { in: [batchA, batchB] } } });
      await tx.classBatch.deleteMany({ where: { id: { in: [batchA, batchB] } } });
      await tx.course.deleteMany({ where: { id: { in: courseIds } } });
    });
  });

  const followersOn = (entityId: string) =>
    withRls(SUPER, (tx) =>
      tx.recordFollower.findMany({ where: { entityType: 'class_batch', entityId } }),
    );

  async function bStaff() {
    const userId = await superAdminUserId();
    return staffCaller({ userId, facilityIds: [B], isSuperAdmin: false });
  }

  it('facility-B staff CANNOT follow a facility-A batch → NOT_FOUND, and no follower row leaks in', async () => {
    const caller = await bStaff();
    await expect(
      caller.audit.follow({ entityType: 'class_batch', entityId: batchA }),
    ).rejects.toThrow(/không tìm thấy|NOT_FOUND/i);
    // Assert no follower row was written through the unauthorized path.
    expect(await followersOn(batchA)).toHaveLength(0);
  });

  it('facility-B staff CAN follow its own batch → ok:true, and a follower row exists', async () => {
    const caller = await bStaff();
    const result = await caller.audit.follow({ entityType: 'class_batch', entityId: batchB });
    expect(result).toEqual({ ok: true });
    const rows = await followersOn(batchB);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('unsupported entityType → BAD_REQUEST', async () => {
    const caller = await bStaff();
    await expect(
      caller.audit.follow({ entityType: 'app_user', entityId: batchB }),
    ).rejects.toThrow(/không hỗ trợ|BAD_REQUEST/i);
  });
});
