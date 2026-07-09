/**
 * Integration test — sessionEvidence.upsertDraft comment lock: a per-student comment is only
 * persisted for a student marked present/late on that session (phase-02-attendance-gate-and-
 * comment-lock.md, requirement #2). Absent or unmarked students must be silently DROPPED
 * server-side (not rejected — rejecting the whole save bricks it once attendance is corrected
 * after a comment was written, since the UI has no input to clear an orphaned comment for a
 * student no longer present/late). The UI already filters render to present/late; this closes
 * the matching server gap without being able to brick the save.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq } from './helpers.js';

const FACILITY = 1;

let teacherId: string;
let courseId: string;
let batchId: string;
let sessionId: string;

let studentPresentId: string;
let studentLateId: string;
let studentAbsentId: string;
let studentUnmarkedId: string;

let enrollmentPresentId: string;
let enrollmentLateId: string;
let enrollmentAbsentId: string;
let enrollmentUnmarkedId: string;

let dbReachable = false;

beforeAll(async () => {
  try {
    await withRls(SUPER, async (tx) => {
      const teacher = await tx.appUser.create({
        data: {
          email: uniq('p2-comment-teacher@cmc.test'),
          displayName: 'P2 Comment Teacher',
          passwordHash: 'test',
          primaryRole: Role.giao_vien,
          roles: [Role.giao_vien],
          isActive: true,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
      });
      teacherId = teacher.id;

      const course = await tx.course.create({
        data: { code: uniq('P2_CMT_C'), name: 'P2 Comment Course', program: 'UCREA' },
      });
      courseId = course.id;

      const batch = await tx.classBatch.create({
        data: { facilityId: FACILITY, code: uniq('P2_CMT_B'), courseId, name: 'P2 Comment Batch', status: 'open' },
      });
      batchId = batch.id;

      const session = await tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batchId, sessionDate: new Date(Date.UTC(2094, 8, 15)),
          startTime: '18:00', endTime: '19:00', status: 'confirmed', teacherId,
        },
      });
      sessionId = session.id;

      const studentPresent = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P2_CMT_S1'), fullName: 'Comment Present', program: 'UCREA' },
      });
      studentPresentId = studentPresent.id;
      const studentLate = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P2_CMT_S2'), fullName: 'Comment Late', program: 'UCREA' },
      });
      studentLateId = studentLate.id;
      const studentAbsent = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P2_CMT_S3'), fullName: 'Comment Absent', program: 'UCREA' },
      });
      studentAbsentId = studentAbsent.id;
      const studentUnmarked = await tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('P2_CMT_S4'), fullName: 'Comment Unmarked', program: 'UCREA' },
      });
      studentUnmarkedId = studentUnmarked.id;

      const enrollmentPresent = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentPresentId, status: 'active' },
      });
      enrollmentPresentId = enrollmentPresent.id;
      const enrollmentLate = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentLateId, status: 'active' },
      });
      enrollmentLateId = enrollmentLate.id;
      const enrollmentAbsent = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentAbsentId, status: 'active' },
      });
      enrollmentAbsentId = enrollmentAbsent.id;
      const enrollmentUnmarked = await tx.enrollment.create({
        data: { facilityId: FACILITY, classBatchId: batchId, studentId: studentUnmarkedId, status: 'active' },
      });
      enrollmentUnmarkedId = enrollmentUnmarked.id;

      // Seed attendance directly (bypasses the 15-min window gate, out of scope for this suite —
      // it only tests upsertDraft's present/late comment gate).
      await tx.attendance.createMany({
        data: [
          { facilityId: FACILITY, classSessionId: sessionId, enrollmentId: enrollmentPresentId, status: 'present' },
          { facilityId: FACILITY, classSessionId: sessionId, enrollmentId: enrollmentLateId, status: 'late' },
          { facilityId: FACILITY, classSessionId: sessionId, enrollmentId: enrollmentAbsentId, status: 'absent' },
          // studentUnmarked deliberately has no Attendance row at all.
        ],
      });
    });
    dbReachable = true;
  } catch {
    console.warn('⚠ DB not reachable — session comment present-gate tests skipped');
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await withRls(SUPER, async (tx) => {
    await tx.sessionStudentComment.deleteMany({ where: { sessionEvidence: { classSessionId: sessionId } } });
    await tx.sessionEvidencePhoto.deleteMany({ where: { sessionEvidence: { classSessionId: sessionId } } });
    await tx.sessionEvidence.deleteMany({ where: { classSessionId: sessionId } });
    await tx.attendance.deleteMany({ where: { classSessionId: sessionId } });
    await tx.classSession.deleteMany({ where: { id: sessionId } });
    await tx.enrollment.deleteMany({ where: { classBatchId: batchId } });
    await tx.classBatch.deleteMany({ where: { id: batchId } });
    await tx.coursePrice.deleteMany({ where: { courseId } });
    await tx.course.deleteMany({ where: { id: courseId } });
    await tx.student.deleteMany({
      where: { id: { in: [studentPresentId, studentLateId, studentAbsentId, studentUnmarkedId] } },
    });
    await tx.employmentProfile.deleteMany({ where: { userId: teacherId } });
    await tx.appUser.deleteMany({ where: { id: teacherId } });
  });
});

describe('sessionEvidence.upsertDraft — present/late comment gate', () => {
  it('(a) accepts comments for present and late students', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    const saved = await teacher.sessionEvidence.upsertDraft({
      classSessionId: sessionId,
      comments: [
        { studentId: studentPresentId, teacherNote: 'Tốt' },
        { studentId: studentLateId, teacherNote: 'Đi muộn nhưng tích cực' },
      ],
    });
    expect(saved.comments).toHaveLength(2);
  });

  it('(b) drops (not rejects) a comment for an absent student, keeping the rest of the save', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    const saved = await teacher.sessionEvidence.upsertDraft({
      classSessionId: sessionId,
      summary: 'Tóm tắt vẫn được lưu dù có comment mồ côi',
      comments: [
        { studentId: studentPresentId, teacherNote: 'Vẫn được lưu' },
        { studentId: studentAbsentId, teacherNote: 'Không nên có nhận xét' },
      ],
    });
    expect(saved.summary).toBe('Tóm tắt vẫn được lưu dù có comment mồ côi');
    expect(saved.comments).toHaveLength(1);
    expect(saved.comments[0].studentId).toBe(studentPresentId);
  });

  it('(c) drops (not rejects) a comment for an unmarked student', async () => {
    if (!dbReachable) return;
    const teacher = await staffCaller({ userId: teacherId, roles: [Role.giao_vien], primaryRole: Role.giao_vien, isSuperAdmin: false, facilityIds: [FACILITY] });

    const saved = await teacher.sessionEvidence.upsertDraft({
      classSessionId: sessionId,
      comments: [{ studentId: studentUnmarkedId, teacherNote: 'Chưa điểm danh' }],
    });
    expect(saved.comments).toHaveLength(0);
  });
});
