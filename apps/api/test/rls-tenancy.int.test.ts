import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (charter, every phase): facility RLS isolates tenants. A staff session scoped to
// facility B cannot READ facility A's rows, and cannot WRITE into facility A (WITH CHECK →
// 42501 → mapped FORBIDDEN). super_admin bypasses. 37/37 facility tables carry this policy;
// Student + Receipt stand in as representative tenant tables here.
describe('facility RLS isolation (tenancy invariant)', () => {
  const A = 1; // HQ
  const B = 2; // CS2
  let studentA: string;
  let courseId: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const s = await tx.student.create({
        data: { facilityId: A, studentCode: uniq('HSA'), fullName: 'A-only', program: 'UCREA' },
      });
      studentA = s.id;
      const c = await tx.course.create({ data: { code: uniq('CRS'), name: 'c', program: 'UCREA' } });
      courseId = c.id;
      await tx.coursePrice.create({ data: { facilityId: A, courseId: c.id, amount: 1_000_000, effectiveFrom: new Date('2020-01-01') } });
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.receipt.deleteMany({ where: { studentId: studentA } });
      await tx.coursePrice.deleteMany({ where: { courseId } });
      await tx.student.deleteMany({ where: { id: studentA } });
      await tx.course.deleteMany({ where: { id: courseId } });
    });
  });

  it('facility-B scope cannot READ a facility-A student; super_admin can', async () => {
    const seenByB = await withRls({ facilityIds: [B], isSuperAdmin: false }, (tx) =>
      tx.student.findMany({ where: { id: studentA }, select: { id: true } }),
    );
    expect(seenByB).toHaveLength(0);

    const seenBySuper = await withRls(SUPER, (tx) =>
      tx.student.findMany({ where: { id: studentA }, select: { id: true } }),
    );
    expect(seenBySuper).toHaveLength(1);
  });

  it('facility-B scope cannot WRITE a row into facility A (RLS WITH CHECK denies)', async () => {
    // Direct WITH CHECK probe: a B-scoped tx inserting a facility-A student must be denied
    // by Postgres RLS (SQLSTATE 42501), never silently written.
    await expect(
      withRls({ facilityIds: [B], isSuperAdmin: false }, (tx) =>
        tx.student.create({ data: { facilityId: A, studentCode: uniq('HACK'), fullName: 'x', program: 'UCREA' } }),
      ),
    ).rejects.toThrow(/row-level security|42501/i);

    // And nothing leaked in: still exactly one A-student (the seeded one), visible only to super.
    const rows = await withRls(SUPER, (tx) => tx.student.findMany({ where: { studentCode: { startsWith: 'HACK' } } }));
    expect(rows).toHaveLength(0);
  });

  it('facility-B ke_toan cannot operate on facility-A data through the router', async () => {
    // Cross-facility receipt is impossible end-to-end: B can't even see A's price → never approves.
    const bCaller = await staffCaller({ isSuperAdmin: false, facilityIds: [B], roles: [Role.ke_toan], primaryRole: Role.ke_toan });
    await expect(
      bCaller.finance.receiptCreate({ facilityId: A, studentId: studentA, courseId, yearsPrepaid: 1 }),
    ).rejects.toBeDefined();
  });
});
