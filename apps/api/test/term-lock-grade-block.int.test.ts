/**
 * Term lock: once a term is locked via assessment.termLock, any attempt to
 * computeFinalGrade for that periodKey must be rejected with FORBIDDEN.
 * Unlocking via termUnlock must restore mutability.
 *
 * RLS context: super_admin bypasses requirePermission gate so the test can
 * exercise the lock enforcement path directly without setting up role fixtures.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Program } from '@cmc/db';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

describe('term lock — grade mutation blocked when term.isLocked=true', () => {
  const FACILITY = 1;
  const PERIOD_KEY = uniq('LOCK2099');

  let studentId: string;
  let termId: string;

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('LOCK'),
          fullName: 'Lock Test Student',
          program: Program.UCREA,
        },
      });
      studentId = student.id;

      const term = await tx.academicTerm.create({
        data: {
          facilityId: FACILITY,
          periodKey: PERIOD_KEY,
          name: `Kỳ khóa ${PERIOD_KEY}`,
          startDate: new Date('2099-02-01'),
          endDate: new Date('2099-02-28'),
          isLocked: false,
        },
      });
      termId = term.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.finalGrade.deleteMany({ where: { studentId } });
      await tx.academicTerm.deleteMany({ where: { id: termId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('computeFinalGrade succeeds when term is unlocked', async () => {
    const caller = await staffCaller();
    // Should not throw
    await expect(
      caller.assessment.computeFinalGrade({ studentId, program: Program.UCREA, periodKey: PERIOD_KEY }),
    ).resolves.toBeDefined();
  });

  it('termLock rejects further computeFinalGrade with FORBIDDEN', async () => {
    const caller = await staffCaller();

    // Lock the term
    await caller.assessment.termLock({ id: termId });

    // Verify lock is stored
    const locked = await withRls(SUPER, (tx) =>
      tx.academicTerm.findUnique({ where: { id: termId }, select: { isLocked: true } }),
    );
    expect(locked?.isLocked).toBe(true);

    // Any grade computation on this period is now blocked
    await expect(
      caller.assessment.computeFinalGrade({ studentId, program: Program.UCREA, periodKey: PERIOD_KEY }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('termUnlock restores grade mutability', async () => {
    const caller = await staffCaller();

    await caller.assessment.termUnlock({ id: termId });

    const unlocked = await withRls(SUPER, (tx) =>
      tx.academicTerm.findUnique({ where: { id: termId }, select: { isLocked: true } }),
    );
    expect(unlocked?.isLocked).toBe(false);

    // Compute should succeed again
    await expect(
      caller.assessment.computeFinalGrade({ studentId, program: Program.UCREA, periodKey: PERIOD_KEY }),
    ).resolves.toBeDefined();
  });
});
