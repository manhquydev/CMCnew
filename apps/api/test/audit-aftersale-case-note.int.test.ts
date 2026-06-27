/**
 * Invariant: after_sale_case must be a supported NOTE_TARGET in audit.ts.
 *
 * Bug: `after_sale_case` was missing from NOTE_TARGETS → audit.postNote and
 * audit.timeline rejected it with BAD_REQUEST "Không hỗ trợ ghi chú".
 *
 * Fix: added after_sale_case lookup via tx.afterSaleCase.findUnique, mirroring
 * the pattern for other Chatter-enabled entities. facilityId is resolved from the
 * case record so cross-facility access remains blocked by RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

describe('audit — after_sale_case postNote + timeline', () => {
  const FAC_A = 1;
  const FAC_B = 2;

  let caseA: string; // case in facility A
  let caseB: string; // case in facility B
  let actorId: string;
  const createdCaseIds: string[] = [];

  let dbReachable = false;

  beforeAll(async () => {
    try {
      actorId = await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — integration tests skipped');
      return;
    }

    await withRls(SUPER, async (tx) => {
      const a = await tx.afterSaleCase.create({
        data: {
          facilityId: FAC_A,
          subject: uniq('case_A'),
          status: 'open',
          priority: 'normal',
          createdById: actorId,
        },
      });
      caseA = a.id;
      createdCaseIds.push(caseA);

      const b = await tx.afterSaleCase.create({
        data: {
          facilityId: FAC_B,
          subject: uniq('case_B'),
          status: 'open',
          priority: 'normal',
          createdById: actorId,
        },
      });
      caseB = b.id;
      createdCaseIds.push(caseB);
    });
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({ where: { entityType: 'after_sale_case', entityId: { in: createdCaseIds } } });
      await tx.recordFollower.deleteMany({ where: { entityType: 'after_sale_case', entityId: { in: createdCaseIds } } });
      await tx.afterSaleCase.deleteMany({ where: { id: { in: createdCaseIds } } });
    });
  });

  it('postNote on an after_sale_case succeeds and the note appears in timeline', async () => {
    if (!dbReachable) return;

    // Staff scoped to FAC_A — can access case A.
    const caller = await staffCaller({ userId: actorId, facilityIds: [FAC_A], isSuperAdmin: false });

    await caller.audit.postNote({
      entityType: 'after_sale_case',
      entityId: caseA,
      body: 'Khách hàng đã phản hồi, đang xử lý',
    });

    const timeline = await caller.audit.timeline({
      entityType: 'after_sale_case',
      entityId: caseA,
    });

    const notes = timeline.filter((e) => e.type === 'note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe('Khách hàng đã phản hồi, đang xử lý');

    // Verify the stored record_event carries the correct facilityId (server-resolved from the
    // case, not client-supplied — getTimeline omits it from the public shape so we check DB).
    const dbRow = await withRls(SUPER, (tx) =>
      tx.recordEvent.findFirst({
        where: { entityType: 'after_sale_case', entityId: caseA, type: 'note' },
        select: { facilityId: true },
      }),
    );
    expect(dbRow).not.toBeNull();
    expect(dbRow!.facilityId).toBe(FAC_A);
  });

  it('facility-B staff cannot post a note on a facility-A case (cross-facility denied)', async () => {
    if (!dbReachable) return;

    // Staff scoped ONLY to FAC_B — cannot see case in FAC_A via RLS.
    const callerB = await staffCaller({ userId: actorId, facilityIds: [FAC_B], isSuperAdmin: false });

    await expect(
      callerB.audit.postNote({
        entityType: 'after_sale_case',
        entityId: caseA,
        body: 'ghi chú xuyên cơ sở',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Verify no note was written onto the FAC_A case.
    const leaked = await withRls(SUPER, (tx) =>
      tx.recordEvent.findMany({
        where: { entityType: 'after_sale_case', entityId: caseA, type: 'note' },
      }),
    );
    // Only the note from the previous test should exist (body ≠ the cross-facility attempt).
    const crossFacilityNotes = leaked.filter((e) => e.body === 'ghi chú xuyên cơ sở');
    expect(crossFacilityNotes).toHaveLength(0);
  });

  it('unsupported entity type is still rejected', async () => {
    if (!dbReachable) return;

    const caller = await staffCaller({ userId: actorId, facilityIds: [FAC_A], isSuperAdmin: false });

    await expect(
      caller.audit.postNote({
        entityType: 'app_user',
        entityId: caseA,
        body: 'should be rejected',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
