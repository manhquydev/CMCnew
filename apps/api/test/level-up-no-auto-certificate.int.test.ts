import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (decision 0008): Approving a level-up proposal only updates Student.level and
// creates a level_up Notification. It does NOT create a Certificate row.
// Certificates are issued manually via certificate.issue (head_teacher/quan_ly only).
// Mutation-proof: certificate count must stay 0 across the approve call.
describe('level-up approve: updates level, does NOT auto-issue certificate (decision 0008)', () => {
  const FACILITY = 1;
  let studentId: string;
  let levelProgressId: string;
  const certIdsToClean: string[] = [];

  const headTeacher = () =>
    staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.head_teacher],
      primaryRole: Role.head_teacher,
    });

  beforeAll(async () => {
    await withRls(SUPER, async (tx) => {
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('HSNOACERT'),
          fullName: 'No-Auto-Cert Test Student',
          program: 'UCREA',
          level: 'L1',
        },
      });
      studentId = student.id;

      const proposedBy = await tx.appUser.findFirst({ where: { isActive: true }, select: { id: true } });
      const lp = await tx.levelProgress.create({
        data: {
          facilityId: FACILITY,
          studentId,
          fromLevel: 'L1',
          toLevel: 'L2',
          reason: 'Test: approve must not create cert',
          proposedById: proposedBy!.id,
        },
      });
      levelProgressId = lp.id;
    });
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      await tx.notification.deleteMany({ where: { recipientType: 'student', recipientId: studentId } });
      // Remove any certificates created by the manual-issue case
      if (certIdsToClean.length > 0) {
        await tx.certificate.deleteMany({ where: { id: { in: certIdsToClean } } });
      }
      await tx.levelProgress.deleteMany({ where: { studentId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('before approval: zero certificates for this student', async () => {
    const certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({ where: { studentId, archivedAt: null } }),
    );
    expect(certs).toHaveLength(0);
  });

  it('head_teacher approves level-up → Student.level updated to L2, certificate count stays 0', async () => {
    await (await headTeacher()).levelProgress.decide({
      id: levelProgressId,
      decision: 'approve',
    });

    // Level must be updated
    const student = await withRls(SUPER, (tx) =>
      tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { level: true } }),
    );
    expect(student.level).toBe('L2');

    // Certificate must NOT be created — this is the mutation-proof assertion
    const certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({ where: { studentId, archivedAt: null } }),
    );
    expect(certs).toHaveLength(0);
  });

  it('manual certificate.issue (head_teacher) → creates exactly 1 certificate, cert count 0 → 1', async () => {
    const caller = await headTeacher();
    const cert = await caller.certificate.issue({
      studentId,
      program: 'UCREA' as unknown as Parameters<typeof caller.certificate.issue>[0]['program'],
      level: 'L2',
      title: 'Hoàn thành cấp độ L2 (cấp tay)',
    });

    expect(cert.studentId).toBe(studentId);
    expect(cert.level).toBe('L2');
    expect(cert.title).toBe('Hoàn thành cấp độ L2 (cấp tay)');
    expect(cert.archivedAt).toBeNull();

    // Track for afterAll cleanup
    certIdsToClean.push(cert.id);

    // Read back from DB to confirm
    const dbCerts = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({ where: { studentId, archivedAt: null } }),
    );
    expect(dbCerts).toHaveLength(1);
    expect(dbCerts[0].id).toBe(cert.id);
  });
});
