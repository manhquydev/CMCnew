import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

// Invariant (spec Phase 2 §2.10): Approving a level-up proposal automatically creates
// a Certificate row for the student at the new level. The certificate is created in the
// same transaction as the level-up approval and student level update.
// Mutation-proof: certificate count must go 0 → 1 across the approve call.
describe('level-up approve creates Certificate (Phase 2 §2.10 invariant)', () => {
  const FACILITY = 1;
  let studentId: string;
  let levelProgressId: string;

  const headTeacher = () =>
    staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.head_teacher],
      primaryRole: Role.head_teacher,
    });

  const teacher = () =>
    staffCaller({
      isSuperAdmin: false,
      facilityIds: [FACILITY],
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
    });

  beforeAll(async () => {
    // Create a student in facility 1, starting at level L1
    await withRls(SUPER, async (tx) => {
      const student = await tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: uniq('HSCERT'),
          fullName: 'Certificate Test Student',
          program: 'UCREA',
          level: 'L1',
        },
      });
      studentId = student.id;

      // Teacher proposes level-up from L1 to L2
      const lp = await tx.levelProgress.create({
        data: {
          facilityId: FACILITY,
          studentId,
          fromLevel: 'L1',
          toLevel: 'L2',
          reason: 'Hoàn thành khóa L1',
          proposedById: await (async () => {
            const u = await tx.appUser.findFirst({ where: { isActive: true }, select: { id: true } });
            return u!.id;
          })(),
        },
      });
      levelProgressId = lp.id;
    });
  });

  afterAll(async () => {
    // Clean up in correct FK order: notifications → certificates → level_progress → student
    await withRls(SUPER, async (tx) => {
      await tx.notification.deleteMany({
        where: { recipientType: 'student', recipientId: studentId },
      });
      await tx.certificate.deleteMany({ where: { studentId } });
      await tx.levelProgress.deleteMany({ where: { studentId } });
      await tx.student.deleteMany({ where: { id: studentId } });
    });
  });

  it('before approval: zero certificates for this student/level', async () => {
    const certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({
        where: { studentId, level: 'L2', archivedAt: null },
      }),
    );
    expect(certs).toHaveLength(0);
  });

  it('head_teacher approves level-up → Certificate row created with correct fields', async () => {
    // Approve the level-up
    await (await headTeacher()).levelProgress.decide({
      id: levelProgressId,
      decision: 'approve',
    });

    // Read back the certificate created by the approve mutation
    const certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({
        where: { studentId, level: 'L2', archivedAt: null },
      }),
    );

    // Mutation-proof: exactly one certificate created
    expect(certs).toHaveLength(1);

    const cert = certs[0];
    expect(cert.facilityId).toBe(FACILITY);
    expect(cert.studentId).toBe(studentId);
    expect(cert.program).toBe('UCREA');
    expect(cert.level).toBe('L2');
    expect(cert.title).toBe('Hoàn thành cấp độ L2');
    expect(cert.issuedAt).toBeDefined();
    expect(cert.createdAt).toBeDefined();
    expect(cert.archivedAt).toBeNull();
  });

  it('idempotent: approving again does NOT create duplicate certificate', async () => {
    // Create a new level-up proposal for L2→L3
    let lp3Id: string;
    await withRls(SUPER, async (tx) => {
      const lp = await tx.levelProgress.create({
        data: {
          facilityId: FACILITY,
          studentId,
          fromLevel: 'L2',
          toLevel: 'L3',
          proposedById: await (async () => {
            const u = await tx.appUser.findFirst({ where: { isActive: true }, select: { id: true } });
            return u!.id;
          })(),
        },
      });
      lp3Id = lp.id;
    });

    // Approve L2→L3
    await (await headTeacher()).levelProgress.decide({
      id: lp3Id,
      decision: 'approve',
    });

    // Read all certificates for L3
    const l3Certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({
        where: { studentId, level: 'L3', archivedAt: null },
      }),
    );
    expect(l3Certs).toHaveLength(1);

    // Student should still have only ONE cert for L2 (unchanged)
    const l2Certs = await withRls(SUPER, (tx) =>
      tx.certificate.findMany({
        where: { studentId, level: 'L2', archivedAt: null },
      }),
    );
    expect(l2Certs).toHaveLength(1);

    // Clean up the L2→L3 cert for afterAll
    await withRls(SUPER, async (tx) => {
      await tx.certificate.deleteMany({ where: { studentId, level: 'L3' } });
      await tx.levelProgress.deleteMany({ where: { id: lp3Id } });
    });
  });
});
