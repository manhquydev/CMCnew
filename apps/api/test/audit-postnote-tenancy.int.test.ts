import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

// Invariant (MED-1, security-class tenancy): `audit.postNote` must NOT trust a client-supplied
// facility. A note's facility is resolved from the target record itself, through RLS — so a staff
// member scoped to facility B cannot attach a note (and especially not a facility_id=NULL "global"
// note, which the record_event RLS WITH CHECK would otherwise wave through) onto a facility-A record.
//
// These assertions kill the OLD behavior: old postNote inserted the note with the client's
// facilityId (defaulting to NULL), so the cross-facility note WOULD have landed — test 1 would see a
// row, test 3 would see facility_id = null.
describe('audit.postNote — facility resolved server-side from the entity (tenancy)', () => {
  const A = 1; // HQ
  const B = 2; // CS2
  let batchA: string;
  let batchB: string;
  const courseIds: string[] = [];

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({ data: { code: uniq('CRS'), name: 'Note Course', program: 'UCREA' } });
      courseIds.push(course.id);
      batchA = (await tx.classBatch.create({ data: { facilityId: A, code: uniq('BA'), courseId: course.id, name: 'A batch' } })).id;
      batchB = (await tx.classBatch.create({ data: { facilityId: B, code: uniq('BB'), courseId: course.id, name: 'B batch' } })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'class_batch', entityId: { in: [batchA, batchB] } } });
      await tx.recordFollower.deleteMany({ where: { entityType: 'class_batch', entityId: { in: [batchA, batchB] } } });
      await tx.classBatch.deleteMany({ where: { id: { in: [batchA, batchB] } } });
      await tx.course.deleteMany({ where: { id: { in: courseIds } } });
    });
  });

  const notesOn = (entityId: string) =>
    withRls(SUPER, (tx) => tx.recordEvent.findMany({ where: { entityType: 'class_batch', entityId, type: 'note' } }));

  async function bStaff() {
    const userId = await superAdminUserId(); // FK-valid actorId; scope is what matters, not the id
    return staffCaller({ userId, facilityIds: [B], isSuperAdmin: false });
  }

  it('facility-B staff CANNOT note a facility-A batch → NOT_FOUND, and no record_event leaks in', async () => {
    const caller = await bStaff();
    await expect(
      caller.audit.postNote({ entityType: 'class_batch', entityId: batchA, body: 'note xuyên cơ sở' }),
    ).rejects.toThrow(/không tìm thấy|NOT_FOUND/i);
    // Mutation-proof: nothing was written onto A's record (old code would have inserted a NULL-facility note).
    expect(await notesOn(batchA)).toHaveLength(0);
  });

  it('facility-B staff CAN note its own batch; the stored note carries the entity facility (B), never NULL', async () => {
    const caller = await bStaff();
    await caller.audit.postNote({ entityType: 'class_batch', entityId: batchB, body: 'note nội bộ B' });
    const rows = await notesOn(batchB);
    expect(rows).toHaveLength(1);
    // The fix's core guarantee: facility is server-resolved from the batch, not the (absent) client value.
    expect(rows[0]!.facilityId).toBe(B);
    expect(rows[0]!.body).toBe('note nội bộ B');
  });

  it('an unsupported entity type is rejected (no silent global note)', async () => {
    const caller = await bStaff();
    await expect(
      caller.audit.postNote({ entityType: 'app_user', entityId: batchB, body: 'x' }),
    ).rejects.toThrow(/không hỗ trợ|BAD_REQUEST/i);
  });
});
