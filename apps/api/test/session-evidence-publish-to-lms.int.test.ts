import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, type LmsSession } from '@cmc/auth';
import { putSessionPhoto } from '../src/services/photo-store.js';
import { lmsCaller, staffCaller, superAdminUserId, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;
const OTHER_FACILITY = 2;
// upsertDraft verifies the ref is actually on disk (sessionPhotoExists) — refs must
// come from a real putSessionPhoto call, not fabricated hex strings.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let PHOTO_REF: string;
let DRAFT_PHOTO_REF: string;

let actorId: string;
let courseId: string;
let batchId: string;
let studentAId: string;
let studentBId: string;
let sessionId: string;
let draftSessionId: string;
let validationSessionId: string;
let guardSessionId: string;
let publishedEvidenceId: string;
let draftEvidenceId: string;
let validationEvidenceId: string;
let guardEvidenceId: string;
let otherTeacherId: string;
let dbReachable = false;

function parentSession(studentId: string, fullName: string): LmsSession {
  return {
    kind: 'parent',
    accountId: randomUUID(),
    displayName: `Parent ${fullName}`,
    students: [{ id: studentId, fullName }],
    studentIds: [studentId],
    facilityIds: [FACILITY],
  };
}

describe('sessionEvidence publish-to-LMS', () => {
  beforeAll(async () => {
    try {
      actorId = await superAdminUserId();
      PHOTO_REF = await putSessionPhoto(Buffer.concat([PNG_MAGIC, Buffer.from('published-fixture')]));
      DRAFT_PHOTO_REF = await putSessionPhoto(Buffer.concat([PNG_MAGIC, Buffer.from('draft-fixture')]));
      await withRls(SUPER, async (tx) => {
      const otherTeacher = await tx.appUser.create({
        data: {
          email: uniq('sev-other-teacher@cmc.test'),
          displayName: 'Session Evidence Other Teacher',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      otherTeacherId = otherTeacher.id;

      const course = await tx.course.create({
        data: { code: uniq('SEV'), name: 'Session Evidence Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, courseId, code: uniq('SEVB'), name: 'Session Evidence Batch', status: 'running' },
      });
      batchId = batch.id;

      const studentA = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('SEA'), fullName: 'Evidence Student A', program: 'UCREA', level: 'L1' },
      });
      studentAId = studentA.id;

      const studentB = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('SEB'), fullName: 'Evidence Student B', program: 'UCREA', level: 'L1' },
      });
      studentBId = studentB.id;

      await tx.enrollment.createMany({
        data: [
          { facilityId: FACILITY, classBatchId: batchId, studentId: studentAId, status: 'active' },
          { facilityId: FACILITY, classBatchId: batchId, studentId: studentBId, status: 'active' },
        ],
      });

      const session = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: new Date('2026-06-20'),
          startTime: '18:00',
          endTime: '19:30',
          status: 'confirmed',
          teacherId: actorId,
        },
      });
      sessionId = session.id;

      const draftSession = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: new Date('2026-06-21'),
          startTime: '18:00',
          endTime: '19:30',
          status: 'confirmed',
          teacherId: actorId,
        },
      });
      draftSessionId = draftSession.id;

      const validationSession = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: new Date('2026-06-22'),
          startTime: '18:00',
          endTime: '19:30',
          status: 'confirmed',
          teacherId: actorId,
        },
      });
      validationSessionId = validationSession.id;

      const guardSession = await tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: new Date('2026-06-23'),
          startTime: '18:00',
          endTime: '19:30',
          status: 'confirmed',
          teacherId: actorId,
        },
      });
      guardSessionId = guardSession.id;
      });
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — session evidence tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      await tx.recordEvent.deleteMany({
        where: {
          entityType: 'session_evidence',
          entityId: { in: [publishedEvidenceId, draftEvidenceId, validationEvidenceId, guardEvidenceId].filter(Boolean) },
        },
      });
      await tx.sessionStudentComment.deleteMany({
        where: { sessionEvidenceId: { in: [publishedEvidenceId, draftEvidenceId, validationEvidenceId, guardEvidenceId].filter(Boolean) } },
      });
      await tx.sessionEvidencePhoto.deleteMany({
        where: { sessionEvidenceId: { in: [publishedEvidenceId, draftEvidenceId, validationEvidenceId, guardEvidenceId].filter(Boolean) } },
      });
      await tx.sessionEvidence.deleteMany({ where: { id: { in: [publishedEvidenceId, draftEvidenceId, validationEvidenceId, guardEvidenceId].filter(Boolean) } } });
      await tx.classSession.deleteMany({ where: { id: { in: [sessionId, draftSessionId, validationSessionId, guardSessionId].filter(Boolean) } } });
      await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
      await tx.student.deleteMany({ where: { id: { in: [studentAId, studentBId].filter(Boolean) } } });
      await tx.classBatch.deleteMany({ where: { id: batchId } });
      if (otherTeacherId) await tx.appUser.delete({ where: { id: otherTeacherId } }).catch(() => undefined);
      await tx.course.deleteMany({ where: { id: courseId } });
    });
  });

  it('publishes photos and official comments to only the owning LMS principal', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller({
      userId: actorId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const draft = await staff.sessionEvidence.upsertDraft({
      classSessionId: sessionId,
      summary: 'Lớp hoàn thành thử thách nhóm và trình bày sản phẩm.',
      photos: [{ ref: PHOTO_REF }],
      comments: [
        {
          studentId: studentAId,
          participation: 'Tích cực',
          strength: 'Tư duy logic',
          needsImprovement: 'Luyện trình bày',
          teacherNote: 'Con chủ động chia nhiệm vụ trong nhóm.',
        },
        {
          studentId: studentBId,
          participation: 'Ổn định',
          strength: 'Hợp tác',
          needsImprovement: 'Tăng tập trung',
          teacherNote: 'Con phối hợp tốt khi được giao vai trò rõ.',
        },
      ],
    });
    publishedEvidenceId = draft.id;

    await staff.sessionEvidence.upsertDraft({
      classSessionId: draftSessionId,
      summary: 'Buổi nháp chưa publish.',
      photos: [{ ref: DRAFT_PHOTO_REF }],
      comments: [{ studentId: studentAId, participation: 'Ổn định' }],
    }).then((row) => {
      draftEvidenceId = row.id;
    });

    const published = await staff.sessionEvidence.publish({ classSessionId: sessionId });
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBeTruthy();

    const parentA = lmsCaller(parentSession(studentAId, 'Evidence Student A'));
    const rowsA = await parentA.sessionEvidence.listForPrincipal({ studentId: studentAId });
    expect(rowsA.map((r) => r.id)).toContain(publishedEvidenceId);
    expect(rowsA.map((r) => r.id)).not.toContain(draftEvidenceId);

    const visible = rowsA.find((r) => r.id === publishedEvidenceId)!;
    expect(visible.photos.map((p) => p.photoRef)).toEqual([PHOTO_REF]);
    expect(visible.comments).toHaveLength(1);
    expect(visible.comments[0].studentId).toBe(studentAId);
    expect(visible.comments[0].teacherNote).toContain('chủ động');

    const detailA = await parentA.sessionEvidence.detailForPrincipal({
      sessionEvidenceId: publishedEvidenceId,
      studentId: studentAId,
    });
    expect(detailA.comments).toHaveLength(1);
    expect(detailA.comments[0].studentId).toBe(studentAId);

    await expect(
      parentA.sessionEvidence.detailForPrincipal({
        sessionEvidenceId: publishedEvidenceId,
        studentId: studentBId,
      }),
    ).rejects.toThrow();

    const parentB = lmsCaller(parentSession(studentBId, 'Evidence Student B'));
    const detailB = await parentB.sessionEvidence.detailForPrincipal({
      sessionEvidenceId: publishedEvidenceId,
      studentId: studentBId,
    });
    expect(detailB.comments).toHaveLength(1);
    expect(detailB.comments[0].studentId).toBe(studentBId);
    expect(detailB.comments[0].teacherNote).toContain('phối hợp');
  });

  it('blocks staff outside the session facility before writing evidence', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller({
      userId: actorId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [OTHER_FACILITY],
    });

    await expect(
      staff.sessionEvidence.upsertDraft({
        classSessionId: sessionId,
        summary: 'Cross facility write must fail',
        photos: [{ ref: PHOTO_REF }],
        comments: [{ studentId: studentAId, participation: 'Tích cực' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects draft/save and publish from a teacher who is not assigned to the session', async () => {
    if (!dbReachable) return;
    const owner = await staffCaller({
      userId: actorId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });
    const otherTeacher = await staffCaller({
      userId: otherTeacherId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const draft = await owner.sessionEvidence.upsertDraft({
      classSessionId: guardSessionId,
      summary: 'Guard fixture summary.',
      photos: [{ ref: PHOTO_REF }],
      comments: [{ studentId: studentAId, participation: 'Tích cực' }],
    });
    guardEvidenceId = draft.id;

    await expect(
      otherTeacher.sessionEvidence.upsertDraft({
        classSessionId: guardSessionId,
        summary: 'Should not save.',
        photos: [{ ref: PHOTO_REF }],
        comments: [{ studentId: studentAId, participation: 'Ổn định' }],
      }),
    ).rejects.toThrow(/Giáo viên/);
    await expect(otherTeacher.sessionEvidence.publish({ classSessionId: guardSessionId })).rejects.toThrow(/Giáo viên/);
  });

  it('rejects publish until summary, at least one photo, and at least one comment are all present', async () => {
    if (!dbReachable) return;
    const staff = await staffCaller({
      userId: actorId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    // No draft at all yet.
    await expect(staff.sessionEvidence.publish({ classSessionId: validationSessionId })).rejects.toThrow();

    // Photo + comment, but no summary.
    const draft = await staff.sessionEvidence.upsertDraft({
      classSessionId: validationSessionId,
      photos: [{ ref: PHOTO_REF }],
      comments: [{ studentId: studentAId, participation: 'Tích cực' }],
    });
    validationEvidenceId = draft.id;
    await expect(staff.sessionEvidence.publish({ classSessionId: validationSessionId })).rejects.toThrow();

    // Summary + comment, but no photo (upsertDraft replaces the photo set wholesale).
    await staff.sessionEvidence.upsertDraft({
      classSessionId: validationSessionId,
      summary: 'Có tóm tắt nhưng chưa có ảnh',
      photos: [],
      comments: [{ studentId: studentAId, participation: 'Tích cực' }],
    });
    await expect(staff.sessionEvidence.publish({ classSessionId: validationSessionId })).rejects.toThrow();

    // Summary + photo, but no comment.
    await staff.sessionEvidence.upsertDraft({
      classSessionId: validationSessionId,
      summary: 'Có tóm tắt và ảnh nhưng chưa có nhận xét',
      photos: [{ ref: PHOTO_REF }],
      comments: [],
    });
    await expect(staff.sessionEvidence.publish({ classSessionId: validationSessionId })).rejects.toThrow();

    // All three present — publish succeeds.
    await staff.sessionEvidence.upsertDraft({
      classSessionId: validationSessionId,
      summary: 'Đầy đủ tóm tắt, ảnh và nhận xét',
      photos: [{ ref: PHOTO_REF }],
      comments: [{ studentId: studentAId, participation: 'Tích cực' }],
    });
    const published = await staff.sessionEvidence.publish({ classSessionId: validationSessionId });
    expect(published.status).toBe('published');
  });
});
