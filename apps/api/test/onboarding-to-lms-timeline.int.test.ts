/**
 * Integration test: the real teacher→class→student→session-evidence→parent timeline, in the
 * actual chronological order a real launch goes through — not isolated per-feature units.
 *
 * Maps to plans/reports/audit-260705-0105-teacher-parent-student-launch-readiness-report.md.
 * Exercises the two fixes shipped from that audit:
 *   A. user.create requires nationalId/startedAt/position and creates an EmploymentProfile
 *      atomically with the AppUser (apps/api/src/routers/user.ts).
 *   B. finance.receiptApprove returns overCapacity (null when no classBatchId, soft-warning
 *      true/false otherwise — mirrors enrollment.enroll/transfer semantics) (finance.ts).
 *
 * Timeline:
 *   1. Education director creates a teacher → AppUser + EmploymentProfile (fix A).
 *   2. Education director creates a real class batch (code format check).
 *   3. Accountant approves a money receipt bound to that batch → student, enrollment,
 *      StudentAccount, parent-notification email queued, overCapacity flips true once the
 *      (deliberately tiny) batch capacity is exceeded (fix B).
 *   4. The teacher from step 1 uploads a session photo + writes a per-student comment, publishes.
 *   5. The parent (real family-login session) views it in the LMS, scoped to their own child only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Role, hashPassword } from '@cmc/db';
import {
  loginFamilyByPhone,
  verifyChildSelectionTicket,
  mintStudentSessionForStudent,
  DEFAULT_STUDENT_PASSWORD,
} from '@cmc/auth';
import { PROGRAM_CODE_ABBREV } from '@cmc/domain-academic';
import { putSessionPhoto } from '../src/services/photo-store.js';
import { prisma, withRls, SUPER, staffCaller, lmsCaller, uniq, assertSuccess } from './helpers.js';

const FACILITY = 1;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A fresh canonical `84xxxxxxxxx` phone, unique per run (mirrors lms-family-login's freshPhone). */
let phoneCounter = 0;
function freshPhone(): string {
  const digits = `${uniq('').replace(/\D/g, '')}${++phoneCounter}`.slice(-9).padStart(9, '0');
  return `84${digits}`;
}

describe('onboarding → class → receipt → session evidence → LMS timeline', () => {
  let dbReachable = false;

  // Directors / staff created directly (mirrors director-user-create.int.test.ts convention).
  let eduDirectorId: string;
  let accountantId: string;

  // Step 1 outputs.
  let teacherId: string;

  // Step 2 outputs.
  let facilityCode: string;
  let curriculumCourseId: string;
  let batchId: string;
  let batchCode: string;

  // Step 3 outputs.
  let salesCourseId: string;
  let heroPhone: string;
  let heroParentEmail: string;
  let heroStudentId: string;
  let heroParentAccountId: string;
  let overflowStudentId: string;

  // Step 4 outputs.
  let classSessionId: string;
  let photoRef: string;
  const teacherComment = 'Con tích cực phát biểu và hoàn thành bài tập nhóm đúng hạn.';

  // Cleanup registries.
  const cleanup = {
    receiptIds: [] as string[],
    studentIds: [] as string[],
    parentAccountIds: [] as string[],
    courseIds: [] as string[],
    userIds: [] as string[],
  };

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — onboarding-to-lms-timeline tests skipped');
      return;
    }

    const facility = await withRls(SUPER, (tx) =>
      tx.facility.findUniqueOrThrow({ where: { id: FACILITY }, select: { code: true } }),
    );
    facilityCode = facility.code;

    const pw = await hashPassword('TestPass!123');
    const eduDir = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: `${uniq('edudir_timeline')}@cmc.test`,
          displayName: 'Giám đốc Đào tạo Timeline',
          passwordHash: pw,
          roles: [Role.giam_doc_dao_tao],
          primaryRole: Role.giam_doc_dao_tao,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
        select: { id: true },
      }),
    );
    eduDirectorId = eduDir.id;
    cleanup.userIds.push(eduDirectorId);

    const accountant = await withRls(SUPER, (tx) =>
      tx.appUser.create({
        data: {
          email: `${uniq('ketoan_timeline')}@cmc.test`,
          displayName: 'Kế toán Timeline',
          passwordHash: pw,
          roles: [Role.ke_toan],
          primaryRole: Role.ke_toan,
          facilities: { create: [{ facilityId: FACILITY }] },
        },
        select: { id: true },
      }),
    );
    accountantId = accountant.id;
    cleanup.userIds.push(accountantId);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      if (classSessionId) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'session_evidence' } });
        await tx.sessionStudentComment.deleteMany({ where: { sessionEvidence: { classSessionId } } });
        await tx.sessionEvidencePhoto.deleteMany({ where: { sessionEvidence: { classSessionId } } });
        await tx.sessionEvidence.deleteMany({ where: { classSessionId } });
        await tx.classSession.deleteMany({ where: { id: classSessionId } });
      }
      if (cleanup.receiptIds.length) {
        await tx.enrollment.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        await tx.student.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        await tx.receipt.deleteMany({ where: { id: { in: cleanup.receiptIds } } });
      }
      if (cleanup.studentIds.length) {
        await tx.studentAccount.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.enrollment.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.guardian.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.parentAccountIds.length) {
        await tx.parentAccount.deleteMany({ where: { id: { in: cleanup.parentAccountIds } } });
      }
      if (batchId) {
        await tx.scheduleSlot.deleteMany({ where: { classBatchId: batchId } });
        await tx.classBatch.deleteMany({ where: { id: batchId } });
      }
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
      if (teacherId) {
        await tx.recordEvent.deleteMany({ where: { entityType: 'employment_profile' } });
        await tx.employmentProfile.deleteMany({ where: { userId: teacherId } });
      }
      const allUserIds = [...cleanup.userIds, teacherId].filter(Boolean);
      if (allUserIds.length) {
        // receiptCreate emits a staff-notification to the approver pool (accountant here) — must
        // clear those rows before the AppUser FK can be dropped.
        await tx.staffNotification.deleteMany({ where: { recipientId: { in: allUserIds } } });
        await tx.userFacility.deleteMany({ where: { userId: { in: allUserIds } } });
        await tx.appUser.deleteMany({ where: { id: { in: allUserIds } } });
      }
    });
  });

  // ── 1. Education director creates a teacher → AppUser + EmploymentProfile atomically ──────

  it('1. director creates a teacher; AppUser + EmploymentProfile exist with matching HR fields', async () => {
    if (!dbReachable) return;
    const director = await staffCaller({
      userId: eduDirectorId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const teacher = await director.user.create({
      email: `${uniq('gv_timeline')}@cmc.test`,
      displayName: 'Nguyễn Thị Hồng Nhung',
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      facilityIds: [FACILITY],
      nationalId: `001${uniq('').replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      startedAt: '2026-07-01',
      position: 'Giáo viên chủ nhiệm',
      phone: '0901234567',
      personalEmail: `personal-teacher-${uniq('')}@example.com`,
    });
    teacherId = teacher.id;
    expect(teacher.roles).toContain(Role.giao_vien);

    const profile = await withRls(SUPER, (tx) =>
      tx.employmentProfile.findUnique({ where: { userId: teacherId } }),
    );
    expect(profile).toBeTruthy();
    expect(profile!.position).toBe('Giáo viên chủ nhiệm');
    expect(profile!.startedAt?.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(profile!.nationalId).toMatch(/^001\d{9}$/);
    expect(profile!.employeeCode).toMatch(/^CMC\d{4}$/);
    expect(profile!.facilityId).toBe(FACILITY);
  });

  // ── 2. Education director creates a real class batch ──────────────────────────────────────

  it('2. director creates a class batch with the correct facility+program code format', async () => {
    if (!dbReachable) return;
    const director = await staffCaller({
      userId: eduDirectorId,
      roles: [Role.giam_doc_dao_tao],
      primaryRole: Role.giam_doc_dao_tao,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const curriculumCourse = await withRls(SUPER, (tx) =>
      tx.course.create({
        data: { code: uniq('CUR'), name: 'UCREA Nền tảng — Timeline', program: 'UCREA' },
      }),
    );
    curriculumCourseId = curriculumCourse.id;
    cleanup.courseIds.push(curriculumCourseId);

    const batch = await director.classBatch.create({
      facilityId: FACILITY,
      courseId: curriculumCourseId,
      name: 'UCREA Nền tảng — Lớp Timeline K1',
      capacity: 1, // deliberately tiny so the second receipt approval trips overCapacity
    });
    batchId = batch.id;
    batchCode = batch.code;

    const year = new Date().getFullYear();
    const yy = String(year).slice(-2).padStart(2, '0');
    const expected = new RegExp(`^${facilityCode}-${PROGRAM_CODE_ABBREV.UCREA}-${yy}-\\d{4}$`);
    expect(batchCode).toMatch(expected);
  });

  // ── 3. Real money-receipt approval enrolls the student ────────────────────────────────────

  it('3. receipt approval creates the student, enrollment, LMS account, and queues the parent email', async () => {
    if (!dbReachable) return;
    const accountant = await staffCaller({
      userId: accountantId,
      roles: [Role.ke_toan],
      primaryRole: Role.ke_toan,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    const salesCourse = await withRls(SUPER, async (tx) => {
      const course = await tx.course.create({
        data: { code: uniq('SALE'), name: 'UCREA Nền tảng — Học phí Timeline', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: { facilityId: FACILITY, courseId: course.id, amount: 12_000_000, effectiveFrom: new Date('2020-01-01') },
      });
      return course;
    });
    salesCourseId = salesCourse.id;
    cleanup.courseIds.push(salesCourseId);

    heroPhone = freshPhone();
    heroParentEmail = `ph_${uniq('e')}@example.com`;

    const receipt = assertSuccess(await accountant.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: salesCourseId,
      yearsPrepaid: 1,
      parentPhone: heroPhone,
      parentName: 'Trần Thị Mai',
      parentEmail: heroParentEmail,
      studentName: 'Trần Gia Bảo',
      classBatchId: batchId,
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await accountant.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');
    expect(approved.studentId).toBeTruthy();
    heroStudentId = approved.studentId!;
    cleanup.studentIds.push(heroStudentId);

    // Capacity is 1, this is the only active enrollee so far → not over capacity yet.
    expect(approved.overCapacity).toBe(false);

    expect(approved.lmsAccount).not.toBeNull();

    const enrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({ where: { classBatchId: batchId, studentId: heroStudentId, archivedAt: null } }),
    );
    expect(enrollment).toBeTruthy();
    expect(enrollment!.status).toBe('active');

    const account = await withRls(SUPER, (tx) =>
      tx.studentAccount.findUnique({ where: { studentId: heroStudentId } }),
    );
    expect(account).toBeTruthy();
    expect(account!.isActive).toBe(true);

    const outbox = await withRls(SUPER, (tx) =>
      tx.emailOutbox.findFirst({ where: { toAddress: heroParentEmail, templateKind: 'lms_account_ready' } }),
    );
    expect(outbox).toBeTruthy();
    expect(outbox!.status).toBe('queued');

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirstOrThrow({ where: { phone: heroPhone } }));
    heroParentAccountId = parent.id;
    cleanup.parentAccountIds.push(parent.id);

    // Now fill the batch past its capacity of 1 with a second, unrelated receipt/student —
    // overCapacity must flip to true (soft warning, never blocks — decision preserved).
    const overflowPhone = freshPhone();
    const overflowReceipt = assertSuccess(await accountant.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: salesCourseId,
      yearsPrepaid: 1,
      parentPhone: overflowPhone,
      parentName: 'Lê Văn Hùng',
      studentName: 'Lê Minh Khang',
      classBatchId: batchId,
    }));
    cleanup.receiptIds.push(overflowReceipt.id);
    const overflowApproved = await accountant.finance.receiptApprove({ id: overflowReceipt.id });
    expect(overflowApproved.overCapacity).toBe(true);
    overflowStudentId = overflowApproved.studentId!;
    cleanup.studentIds.push(overflowStudentId);
    const overflowParent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone: overflowPhone } }));
    if (overflowParent) cleanup.parentAccountIds.push(overflowParent.id);

    // A receipt with no classBatchId at all must report overCapacity: null (capacity check N/A).
    const noBatchReceipt = assertSuccess(await accountant.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: salesCourseId,
      yearsPrepaid: 1,
      parentPhone: freshPhone(),
      studentName: 'Phạm Thu Trang',
    }));
    cleanup.receiptIds.push(noBatchReceipt.id);
    const noBatchApproved = await accountant.finance.receiptApprove({ id: noBatchReceipt.id });
    expect(noBatchApproved.overCapacity).toBeNull();
    if (noBatchApproved.studentId) cleanup.studentIds.push(noBatchApproved.studentId);
  });

  // ── 4. The teacher publishes session evidence for the hero student ────────────────────────

  it('4. the teacher uploads a session photo and comment, then publishes', async () => {
    if (!dbReachable) return;
    const classSession = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY,
          classBatchId: batchId,
          sessionDate: new Date('2026-07-06'),
          startTime: '18:00',
          endTime: '19:30',
          status: 'confirmed',
          teacherId,
        },
      }),
    );
    classSessionId = classSession.id;

    // upsertDraft only accepts a comment for a present/late student (phase-02-attendance-gate-
    // and-comment-lock.md) — seed the hero student's attendance directly via SUPER tx (this
    // step tests evidence publish, not attendance.mark's own authz).
    const heroEnrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirstOrThrow({ where: { classBatchId: batchId, studentId: heroStudentId, archivedAt: null } }),
    );
    await withRls(SUPER, (tx) =>
      tx.attendance.create({
        data: { facilityId: FACILITY, classSessionId: classSession.id, enrollmentId: heroEnrollment.id, status: 'present' },
      }),
    );

    photoRef = await putSessionPhoto(Buffer.concat([PNG_MAGIC, Buffer.from(`timeline-${uniq('photo')}`)]));

    const teacher = await staffCaller({
      userId: teacherId,
      roles: [Role.giao_vien],
      primaryRole: Role.giao_vien,
      isSuperAdmin: false,
      facilityIds: [FACILITY],
    });

    await teacher.sessionEvidence.upsertDraft({
      classSessionId,
      summary: 'Buổi học chủ đề robot mini: cả lớp lắp ráp và thuyết trình sản phẩm.',
      photos: [{ ref: photoRef }],
      comments: [
        {
          studentId: heroStudentId,
          participation: 'Tích cực',
          strength: 'Tư duy logic',
          needsImprovement: 'Luyện trình bày',
          teacherNote: teacherComment,
        },
      ],
    });

    const published = await teacher.sessionEvidence.publish({ classSessionId });
    expect(published.status).toBe('published');
    expect(published.publishedAt).toBeTruthy();
  });

  // ── 5. The parent logs in for real and views the evidence, scoped to their own child ─────

  it('5. the parent (real family login) sees the exact photo + comment for their own child only', async () => {
    if (!dbReachable) return;
    const familyLogin = await loginFamilyByPhone(heroPhone, DEFAULT_STUDENT_PASSWORD);
    expect(familyLogin).not.toBeNull();
    expect(familyLogin!.children.map((c) => c.id)).toContain(heroStudentId);

    const verified = await verifyChildSelectionTicket(familyLogin!.ticket);
    expect(verified).not.toBeNull();
    expect(verified!.parentAccountId).toBe(heroParentAccountId);

    const entered = await mintStudentSessionForStudent(heroStudentId, verified!.parentAccountId);
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;

    const parent = lmsCaller(entered.session);
    const rows = await parent.sessionEvidence.listForPrincipal({ studentId: heroStudentId });

    const row = rows.find((r) => r.classSession.id === classSessionId);
    expect(row).toBeTruthy();
    expect(row!.photos.map((p) => p.photoRef)).toContain(photoRef);
    expect(row!.comments).toHaveLength(1);
    expect(row!.comments[0].studentId).toBe(heroStudentId);
    expect(row!.comments[0].teacherNote).toBe(teacherComment);

    // Scoping: the overflow student's session (none published here, but the account itself)
    // must never leak into this parent's own family session.
    expect(entered.session.studentIds).not.toContain(overflowStudentId);
  });
});
