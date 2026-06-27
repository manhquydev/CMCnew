/**
 * studentCode uniqueness is per-facility (@@unique([facilityId, studentCode])):
 * - Two facilities MAY both have the same studentCode (e.g. HS-2026-0001), because codes are
 *   derived from independent per-facility receipt counters.
 * - The same facility CANNOT have two students with the same studentCode.
 *
 * Requires a running Postgres (DATABASE_URL). Skips gracefully when no DB is reachable.
 */
import { describe, it, expect } from 'vitest';
import { withRls, SUPER, uniq } from './helpers.js';

const FAC_A = 1; // HQ — always present after seed
const FAC_B = 2; // CS2 — always present after seed

describe('studentCode — facility-scoped uniqueness invariant', () => {
  it('two facilities can each hold the same studentCode without conflict', async () => {
    // Use a shared code that would collide under the old global unique constraint.
    const code = uniq('HS-2026-0001');

    const [a, b] = await withRls(SUPER, async (tx) => {
      const sA = await tx.student.create({
        data: { facilityId: FAC_A, studentCode: code, fullName: 'Student-A', program: 'UCREA' },
      });
      const sB = await tx.student.create({
        data: { facilityId: FAC_B, studentCode: code, fullName: 'Student-B', program: 'UCREA' },
      });
      return [sA, sB] as const;
    });

    expect(a.id).not.toBe(b.id);
    expect(a.studentCode).toBe(b.studentCode); // same code, different facilities

    // cleanup
    await withRls(SUPER, (tx) =>
      tx.student.deleteMany({ where: { id: { in: [a.id, b.id] } } }),
    );
  });

  it('same facility rejects a duplicate studentCode', async () => {
    const code = uniq('HS-DUP');

    const first = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FAC_A, studentCode: code, fullName: 'First', program: 'UCREA' },
      }),
    );

    await expect(
      withRls(SUPER, (tx) =>
        tx.student.create({
          data: { facilityId: FAC_A, studentCode: code, fullName: 'Duplicate', program: 'UCREA' },
        }),
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    await withRls(SUPER, (tx) => tx.student.delete({ where: { id: first.id } }));
  });

  it('composite unique lookup works via facilityId_studentCode key', async () => {
    const code = uniq('HS-LOOKUP');

    const created = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FAC_A, studentCode: code, fullName: 'Lookup Test', program: 'UCREA' },
      }),
    );

    const found = await withRls(SUPER, (tx) =>
      tx.student.findUnique({
        where: { facilityId_studentCode: { facilityId: FAC_A, studentCode: code } },
        select: { id: true, studentCode: true },
      }),
    );

    expect(found?.id).toBe(created.id);
    expect(found?.studentCode).toBe(code);

    await withRls(SUPER, (tx) => tx.student.delete({ where: { id: created.id } }));
  });
});
