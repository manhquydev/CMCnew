import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withRls, SUPER, uniq } from './helpers.js';

// Invariant (charter, every phase): RLS isolates tenants AND LMS principals.
// - facility staff: see only their facility (positive + negative control), can't WRITE across.
// - parent/student principals: see only their own student(s), not facility siblings.
// Student stands in as a representative facility+principal table (37/37 carry the policy).
describe('RLS isolation — facility + principal (tenancy invariant)', () => {
  const A = 1; // HQ
  const B = 2; // CS2
  let studentA: string;
  let studentA2: string; // another A student (a parent's non-child)
  let studentB: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      studentA = (await tx.student.create({ data: { facilityId: A, studentCode: uniq('HSA'), fullName: 'A-child', program: 'UCREA' } })).id;
      studentA2 = (await tx.student.create({ data: { facilityId: A, studentCode: uniq('HSA2'), fullName: 'A-other', program: 'UCREA' } })).id;
      studentB = (await tx.student.create({ data: { facilityId: B, studentCode: uniq('HSB'), fullName: 'B-own', program: 'UCREA' } })).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, (tx) => tx.student.deleteMany({ where: { id: { in: [studentA, studentA2, studentB] } } }));
  });

  it('facility scope: B sees its own student but NOT A’s; super sees both', async () => {
    const bScope = { facilityIds: [B], isSuperAdmin: false };
    // Negative control: B cannot read an A student.
    expect(await withRls(bScope, (tx) => tx.student.findMany({ where: { id: studentA }, select: { id: true } }))).toHaveLength(0);
    // Positive control: B CAN read its own student (kills an inverted facility clause that
    // would also make "B sees A = 0" pass for the wrong reason).
    expect(await withRls(bScope, (tx) => tx.student.findMany({ where: { id: studentB }, select: { id: true } }))).toHaveLength(1);
    // super bypass.
    expect(await withRls(SUPER, (tx) => tx.student.findMany({ where: { id: studentA }, select: { id: true } }))).toHaveLength(1);
  });

  it('facility-B scope cannot WRITE a row into facility A (RLS WITH CHECK denies, no leak)', async () => {
    await expect(
      withRls({ facilityIds: [B], isSuperAdmin: false }, (tx) =>
        tx.student.create({ data: { facilityId: A, studentCode: uniq('HACK'), fullName: 'x', program: 'UCREA' } }),
      ),
    ).rejects.toThrow(/row-level security|42501/i);
    const leaked = await withRls(SUPER, (tx) => tx.student.findMany({ where: { studentCode: { startsWith: 'HACK' } } }));
    expect(leaked).toHaveLength(0);
  });

  it('parent principal sees only its own child, not a facility sibling', async () => {
    // Parent owns studentA only; studentA2 is in the same facility but not their child.
    const parentScope = { facilityIds: [A], isSuperAdmin: false, principalKind: 'parent' as const, studentIds: [studentA] };
    const seen = await withRls(parentScope, (tx) => tx.student.findMany({ select: { id: true } }));
    const ids = seen.map((s) => s.id);
    expect(ids).toContain(studentA);
    expect(ids).not.toContain(studentA2);
    expect(ids).not.toContain(studentB);
  });
});
