/**
 * Integration test — LMS-authorized transcript (học bạ) + certificate download routes.
 *
 * Invariants under test:
 *   - A parent can fetch their OWN child's transcript and certificate (200, real HTML).
 *   - A parent CANNOT fetch another family's child's transcript/certificate (403 — IDOR guard;
 *     ownership is checked against the LMS session's studentIds, never the path param alone).
 *   - The existing staff-only certificate path keeps working unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GuardianRelation, hashPassword } from '@cmc/db';
import { Role, login, mintParentSession } from '@cmc/auth';
import { prisma, withRls, SUPER, uniq } from './helpers.js';
import { COOKIE_NAME, LMS_COOKIE_NAME } from '../src/context.js';

process.env.DISABLE_CRON = '1';

let app: (typeof import('../src/index.js'))['app'];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  ({ app } = await import('../src/index.js'));
});

const FACILITY = 1;
const PASSWORD = 'correct-horse-battery';

let childId: string;
let otherChildId: string;
let parentId: string;
let otherParentId: string;
let certId: string;
let staffEmail: string;

let completedChildId: string;
let completedParentId: string;
let completedCertId: string;

beforeAll(async () => {
  await withRls(SUPER, async (tx) => {
    const student = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('TCA'), fullName: 'Transcript-Cert-Student', program: 'UCREA', level: 'L1' },
    });
    childId = student.id;

    const otherStudent = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('TCO'), fullName: 'Transcript-Cert-Other', program: 'UCREA', level: 'L1' },
    });
    otherChildId = otherStudent.id;

    const parent = await tx.parentAccount.create({
      data: { displayName: 'Transcript-Cert-Parent', email: `${uniq('tcp')}@test.local` },
    });
    parentId = parent.id;

    const otherParent = await tx.parentAccount.create({
      data: { displayName: 'Transcript-Cert-Other-Parent', email: `${uniq('tcop')}@test.local` },
    });
    otherParentId = otherParent.id;

    await tx.guardian.create({ data: { facilityId: FACILITY, parentAccountId: parentId, studentId: childId, relation: GuardianRelation.guardian } });
    await tx.guardian.create({ data: { facilityId: FACILITY, parentAccountId: otherParentId, studentId: otherChildId, relation: GuardianRelation.guardian } });

    await tx.finalGrade.create({
      data: {
        facilityId: FACILITY,
        studentId: childId,
        program: 'UCREA',
        periodKey: uniq('P'),
        homeworkAvg: 8,
        testScore: 7.5,
        attendanceRate: 0.9,
        qualitativeScore: 8.5,
        finalScore: 8,
        passed: true,
        complete: true,
        computedAt: new Date(),
      },
    });
    await tx.qualitativeAssessment.create({
      data: {
        facilityId: FACILITY,
        studentId: childId,
        period: 'MONTHLY',
        periodKey: uniq('QP'),
        criteria: { creativity: 8 },
        narrative: 'Tốt',
      },
    });

    const cert = await tx.certificate.create({
      data: {
        facilityId: FACILITY,
        studentId: childId,
        program: 'UCREA',
        title: 'Chứng chỉ hoàn thành',
      },
    });
    certId = cert.id;

    staffEmail = `${uniq('tcastaff')}@cmc.test`;
    await tx.appUser.create({
      data: {
        email: staffEmail,
        displayName: 'Transcript-Cert Staff',
        passwordHash: await hashPassword(PASSWORD),
        roles: [Role.super_admin],
        primaryRole: Role.super_admin,
        isActive: true,
      },
    });

    // C3 fixture: lifecycle='completed' is intentionally excluded from BLOCKED_LMS_LIFECYCLE
    // (packages/auth/src/lms.ts) specifically so completed students keep transcript/cert access.
    const completedStudent = await tx.student.create({
      data: { facilityId: FACILITY, studentCode: uniq('TCC'), fullName: 'Transcript-Cert-Completed', program: 'UCREA', level: 'L1', lifecycle: 'completed' },
    });
    completedChildId = completedStudent.id;

    const completedParent = await tx.parentAccount.create({
      data: { displayName: 'Transcript-Cert-Completed-Parent', email: `${uniq('tccp')}@test.local` },
    });
    completedParentId = completedParent.id;

    await tx.guardian.create({ data: { facilityId: FACILITY, parentAccountId: completedParentId, studentId: completedChildId, relation: GuardianRelation.guardian } });

    await tx.finalGrade.create({
      data: {
        facilityId: FACILITY,
        studentId: completedChildId,
        program: 'UCREA',
        periodKey: uniq('CP'),
        homeworkAvg: 9,
        testScore: 9,
        attendanceRate: 1,
        qualitativeScore: 9,
        finalScore: 9,
        passed: true,
        complete: true,
        computedAt: new Date(),
      },
    });

    const completedCert = await tx.certificate.create({
      data: {
        facilityId: FACILITY,
        studentId: completedChildId,
        program: 'UCREA',
        title: 'Chứng chỉ hoàn thành',
      },
    });
    completedCertId = completedCert.id;
  });
});

afterAll(async () => {
  await withRls(SUPER, async (tx) => {
    await tx.certificate.deleteMany({ where: { studentId: { in: [childId, otherChildId, completedChildId] } } });
    await tx.finalGrade.deleteMany({ where: { studentId: { in: [childId, otherChildId, completedChildId] } } });
    await tx.qualitativeAssessment.deleteMany({ where: { studentId: { in: [childId, otherChildId, completedChildId] } } });
    await tx.guardian.deleteMany({ where: { parentAccountId: { in: [parentId, otherParentId, completedParentId] } } });
    await tx.parentAccount.deleteMany({ where: { id: { in: [parentId, otherParentId, completedParentId] } } });
    await tx.student.deleteMany({ where: { id: { in: [childId, otherChildId, completedChildId] } } });
    const staffUser = await tx.appUser.findUnique({ where: { email: staffEmail }, select: { id: true } });
    if (staffUser) {
      await tx.staffNotification.deleteMany({ where: { recipientId: staffUser.id } });
    }
    await tx.appUser.deleteMany({ where: { email: staffEmail } });
  });
});

async function parentToken(accountId: string): Promise<string> {
  const result = await mintParentSession(accountId);
  if (!result) throw new Error('mintParentSession failed in test fixture');
  return result.token;
}

describe('GET /files/transcript/:studentId (LMS parent/student)', () => {
  it('(a) parent fetches own child transcript → 200 HTML with student name', async () => {
    const token = await parentToken(parentId);
    const res = await app.request(`/files/transcript/${childId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Transcript-Cert-Student');
    expect(html).toContain('HỌC BẠ');
  });

  it('(b) parent cannot fetch another family child transcript → 403 (IDOR)', async () => {
    const token = await parentToken(parentId);
    const res = await app.request(`/files/transcript/${otherChildId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('unauthenticated request → 401', async () => {
    const res = await app.request(`/files/transcript/${childId}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /files/certificate/:id (staff unchanged + LMS parent/student)', () => {
  it('(a) parent fetches own child certificate → 200 HTML with student name', async () => {
    const token = await parentToken(parentId);
    const res = await app.request(`/files/certificate/${certId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Transcript-Cert-Student');
  });

  it('(b) another family parent cannot fetch this certificate → 403 (IDOR)', async () => {
    const token = await parentToken(otherParentId);
    const res = await app.request(`/files/certificate/${certId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('(c) the existing staff-only path still serves the certificate unchanged', async () => {
    const result = await login(staffEmail, PASSWORD);
    if (!result) throw new Error('staff login failed in test fixture');
    const res = await app.request(`/files/certificate/${certId}`, {
      headers: { Cookie: `${COOKIE_NAME}=${result.token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Transcript-Cert-Student');
  });

  it('unauthenticated request → 401', async () => {
    const res = await app.request(`/files/certificate/${certId}`);
    expect(res.status).toBe(401);
  });
});

describe('C3 — lifecycle=completed student keeps transcript/certificate access', () => {
  it('parent of a completed-lifecycle child can still download transcript', async () => {
    const token = await parentToken(completedParentId);
    const res = await app.request(`/files/transcript/${completedChildId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Transcript-Cert-Completed');
  });

  it('parent of a completed-lifecycle child can still download certificate', async () => {
    const token = await parentToken(completedParentId);
    const res = await app.request(`/files/certificate/${completedCertId}`, {
      headers: { Cookie: `${LMS_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Transcript-Cert-Completed');
  });
});
