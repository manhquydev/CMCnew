import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 2 §2.10): a teacher (giao_vien) PROPOSES a level-up (status pending).
// Only giam_doc_dao_tao (or super_admin) may DECIDE. Approve writes the new level onto Student.level;
// a non-giam_doc_dao_tao attempting to decide → FORBIDDEN; reject leaves Student.level unchanged.
//
// The router exposes ONE decision procedure: levelProgress.decide({ id, decision: 'approve'|'reject' }),
// gated to giam_doc_dao_tao per packages/auth/src/permissions.ts levelProgress.decide (super_admin
// bypasses). propose is gated to giao_vien + giam_doc_dao_tao. Approve side-effects (in the same tx)
// also auto-issue a Certificate and a student Notification — afterAll cleans those FK-children before
// the student.
describe('level-progress propose/decide authz (Phase 2 §2.10 invariant)', () => {
  const FACILITY = 1;
  let studentId: string;

  // A facility-1 giam_doc_dao_tao: allowed to decide, and RLS-scoped to read the facility-1 proposal.
  const headTeacher = () =>
    staffCaller({ isSuperAdmin: false, facilityIds: [FACILITY], roles: [Role.giam_doc_dao_tao], primaryRole: Role.giam_doc_dao_tao });
  // A facility-1 giao_vien: may propose, must NOT be able to decide.
  const teacher = () =>
    staffCaller({ isSuperAdmin: false, facilityIds: [FACILITY], roles: [Role.giao_vien], primaryRole: Role.giao_vien });

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      studentId = (
        await tx.student.create({
          data: { facilityId: FACILITY, studentCode: uniq('HSLP'), fullName: 'LP-child', program: 'UCREA', level: 'L1' },
        })
      ).id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // FK-safe: notifications/certificates/level_progress reference the student, delete them first.
      await tx.notification.deleteMany({ where: { recipientType: 'student', recipientId: studentId } });
      await tx.certificate.deleteMany({ where: { studentId } });
      await tx.levelProgress.deleteMany({ where: { studentId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('teacher proposes L1→L2 → a PENDING LevelProgress row exists', async () => {
    const { id } = await (await teacher()).levelProgress.propose({ studentId, toLevel: 'L2' });
    const lp = await withRls(SUPER, (tx) =>
      tx.levelProgress.findUniqueOrThrow({ where: { id }, select: { status: true, fromLevel: true, toLevel: true } }),
    );
    expect(lp.status).toBe('pending');
    expect(lp.fromLevel).toBe('L1');
    expect(lp.toLevel).toBe('L2');
  });

  it('non-giam_doc_dao_tao (giao_vien) decide → FORBIDDEN, and Student.level stays L1', async () => {
    const lp = await withRls(SUPER, (tx) =>
      tx.levelProgress.findFirstOrThrow({ where: { studentId, status: 'pending' }, select: { id: true } }),
    );
    await expect(
      (await teacher()).levelProgress.decide({ id: lp.id, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Still pending, student unchanged — a leaky guard would have promoted the level here.
    const after = await withRls(SUPER, async (tx) => ({
      status: (await tx.levelProgress.findUniqueOrThrow({ where: { id: lp.id }, select: { status: true } })).status,
      level: (await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { level: true } })).level,
    }));
    expect(after.status).toBe('pending');
    expect(after.level).toBe('L1');
  });

  it('giam_doc_dao_tao approves → LevelProgress APPROVED and Student.level becomes L2', async () => {
    const lp = await withRls(SUPER, (tx) =>
      tx.levelProgress.findFirstOrThrow({ where: { studentId, status: 'pending' }, select: { id: true } }),
    );
    await (await headTeacher()).levelProgress.decide({ id: lp.id, decision: 'approve' });

    const after = await withRls(SUPER, async (tx) => ({
      status: (await tx.levelProgress.findUniqueOrThrow({ where: { id: lp.id }, select: { status: true } })).status,
      level: (await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { level: true } })).level,
    }));
    expect(after.status).toBe('approved');
    expect(after.level).toBe('L2');
  });

  it('reject path: a new proposal rejected by giam_doc_dao_tao leaves Student.level unchanged', async () => {
    // Student is now L2; propose L2→L3 then reject — level must stay L2.
    const { id } = await (await teacher()).levelProgress.propose({ studentId, toLevel: 'L3' });
    await (await headTeacher()).levelProgress.decide({ id, decision: 'reject', reason: 'chưa đạt' });

    const after = await withRls(SUPER, async (tx) => ({
      status: (await tx.levelProgress.findUniqueOrThrow({ where: { id }, select: { status: true } })).status,
      level: (await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { level: true } })).level,
    }));
    expect(after.status).toBe('rejected');
    expect(after.level).toBe('L2');
  });
});
