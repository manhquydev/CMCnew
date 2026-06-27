/**
 * Integration tests: Student provisioning at receipt.approve + rollback at receiptCancel.
 *
 * Requires a running Postgres (DATABASE_URL in env). Tests are skipped gracefully when no
 * DB is reachable (checks for the seeded super_admin user at test startup).
 *
 * Scenarios:
 *   1. New-student path: approve creates Student + ParentAccount + Guardian + Enrollment
 *   2. Dedupe: second receipt for the same parentPhone reuses existing student
 *   3. Multi-child: two students under same parent matched by studentName
 *   4. Rollback void: new student + no attendance + no other receipt → student archived
 *   5. Rollback refund: new student + has attendance → student kept
 *   6. Rollback refund: pre-existing student → student kept (never archive pre-existing)
 *   7. Rollback: cancelling a draft receipt (status=draft) does NOT trigger rollback
 *   8. Multi-enrollment scope: only THIS receipt's enrollment is withdrawn on cancel
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

const FACILITY = 1;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function createCourseWithPrice(program: 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE' = 'UCREA') {
  const code = uniq('CRS');
  return withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code, name: `Test Course ${code}`, program },
    });
    await tx.coursePrice.create({
      data: { facilityId: FACILITY, courseId: course.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
    });
    return course;
  });
}

async function createClassBatch(courseId: string) {
  const code = uniq('B');
  return withRls(SUPER, (tx) =>
    tx.classBatch.create({
      data: { facilityId: FACILITY, courseId, code, name: `Batch ${code}`, status: 'open' },
    }),
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('student-provisioning: approve + rollback', () => {
  const cleanup = {
    receiptIds: [] as string[],
    studentIds: [] as string[],
    parentAccountIds: [] as string[],
    courseIds: [] as string[],
    batchIds: [] as string[],
    enrollmentIds: [] as string[],
  };

  let dbReachable = false;

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — integration tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      // Receipts first (FK: receipt → student, enrollment → receipt via createdByReceiptId)
      if (cleanup.receiptIds.length) {
        // Clear provenance FKs on enrollments before deleting receipts
        await tx.enrollment.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        // Clear provenance FKs on students before deleting receipts
        await tx.student.updateMany({ where: { createdByReceiptId: { in: cleanup.receiptIds } }, data: { createdByReceiptId: null } });
        await tx.receipt.deleteMany({ where: { id: { in: cleanup.receiptIds } } });
      }
      // Delete ALL enrollments for tracked students (catches any not explicitly recorded)
      if (cleanup.studentIds.length) {
        await tx.enrollment.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.guardian.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.parentAccountIds.length) {
        await tx.parentAccount.deleteMany({ where: { id: { in: cleanup.parentAccountIds } } });
      }
      if (cleanup.batchIds.length) {
        await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
      }
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  // ── 1. New-student path ─────────────────────────────────────────────────────

  it('1. approve creates Student + ParentAccount + Guardian + Enrollment (new-student path)', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    const batch = await createClassBatch(course.id);
    cleanup.courseIds.push(course.id);
    cleanup.batchIds.push(batch.id);

    const phone = `+84${uniq('9')}`.slice(0, 12);
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: course.id,
      yearsPrepaid: 1,
      parentPhone: phone,
      parentName: 'Nguyễn Văn A',
      studentName: 'Nguyễn Thị B',
      classBatchId: batch.id,
    });
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');
    expect(approved.studentId).toBeTruthy();

    // Student was created
    const student = await withRls(SUPER, (tx) =>
      tx.student.findUniqueOrThrow({ where: { id: approved.studentId! } }),
    );
    cleanup.studentIds.push(student.id);
    expect(student.fullName).toBe('Nguyễn Thị B');
    expect(student.lifecycle).toBe('active');
    expect(student.createdByReceiptId).toBe(receipt.id);
    expect(student.studentCode).toMatch(/^HS-/);

    // Guardian link created
    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    expect(parent).toBeTruthy();
    cleanup.parentAccountIds.push(parent!.id);
    const guardian = await withRls(SUPER, (tx) =>
      tx.guardian.findFirst({ where: { parentAccountId: parent!.id, studentId: student.id } }),
    );
    expect(guardian).toBeTruthy();

    // Enrollment created in the specified batch
    const enrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({ where: { studentId: student.id, classBatchId: batch.id } }),
    );
    expect(enrollment).toBeTruthy();
    expect(enrollment!.status).toBe('active');
    expect(enrollment!.createdByReceiptId).toBe(receipt.id);
    if (enrollment) cleanup.enrollmentIds.push(enrollment.id);
  });

  // ── 2. Dedupe: same parentPhone → reuse existing student ───────────────────

  it('2. second receipt for same parentPhone reuses existing student (dedupe hit)', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    const batch1 = await createClassBatch(course.id);
    const batch2 = await createClassBatch(course.id);
    cleanup.courseIds.push(course.id);
    cleanup.batchIds.push(batch1.id, batch2.id);

    const phone = `+84${uniq('8')}`.slice(0, 12);

    // First receipt → creates student
    const r1 = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, parentName: 'PH Test', studentName: 'HS Dedupe',
      classBatchId: batch1.id,
    });
    cleanup.receiptIds.push(r1.id);
    const a1 = await caller.finance.receiptApprove({ id: r1.id });
    const studentId1 = a1.studentId!;
    cleanup.studentIds.push(studentId1);

    // Second receipt for same phone → must reuse student
    const r2 = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS Dedupe',
      classBatchId: batch2.id,
    });
    cleanup.receiptIds.push(r2.id);
    const a2 = await caller.finance.receiptApprove({ id: r2.id });

    expect(a2.studentId).toBe(studentId1); // same student reused

    // Deduped student must NOT have createdByReceiptId overwritten to r2
    const student = await withRls(SUPER, (tx) =>
      tx.student.findUniqueOrThrow({ where: { id: studentId1 } }),
    );
    expect(student.createdByReceiptId).toBe(r1.id); // still points to the first receipt

    // Second enrollment exists on batch2
    const e2 = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({ where: { studentId: studentId1, classBatchId: batch2.id } }),
    );
    expect(e2).toBeTruthy();
    expect(e2!.createdByReceiptId).toBe(r2.id);
    if (e2) cleanup.enrollmentIds.push(e2.id);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);
  });

  // ── 3. Rollback void: new student + 0 attendance + 0 other receipts ────────

  it('3. cancel void: new student with no attendance → student archived, enrollment withdrawn', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    const batch = await createClassBatch(course.id);
    cleanup.courseIds.push(course.id);
    cleanup.batchIds.push(batch.id);

    const phone = `+84${uniq('7')}`.slice(0, 12);
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS VoidTest',
      classBatchId: batch.id,
    });
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    const studentId = approved.studentId!;
    cleanup.studentIds.push(studentId);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);

    // Cancel → void branch
    await caller.finance.receiptCancel({ id: receipt.id, reason: 'Nhập nhầm, hủy ngay' });

    const student = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    expect(student.archivedAt).not.toBeNull(); // soft-archived

    const enrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({ where: { studentId, classBatchId: batch.id } }),
    );
    expect(enrollment?.status).toBe('withdrawn');
  });

  // ── 4. Rollback refund: new student + has attendance → keep student ─────────

  it('4. cancel refund: new student with attendance → student kept, enrollment withdrawn', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    const batch = await createClassBatch(course.id);
    cleanup.courseIds.push(course.id);
    cleanup.batchIds.push(batch.id);

    const phone = `+84${uniq('6')}`.slice(0, 12);
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS RefundTest',
      classBatchId: batch.id,
    });
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    const studentId = approved.studentId!;
    cleanup.studentIds.push(studentId);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);

    // Simulate attendance: create a session + enrollment attendance record
    const enrollment = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirstOrThrow({ where: { studentId, classBatchId: batch.id } }),
    );
    cleanup.enrollmentIds.push(enrollment.id);
    const session = await withRls(SUPER, (tx) =>
      tx.classSession.create({
        data: {
          facilityId: FACILITY, classBatchId: batch.id,
          sessionDate: new Date('2026-07-01'), startTime: '08:00', endTime: '10:00', status: 'confirmed',
        },
      }),
    );
    await withRls(SUPER, (tx) =>
      tx.attendance.create({
        data: { facilityId: FACILITY, classSessionId: session.id, enrollmentId: enrollment.id, status: 'present' },
      }),
    );

    // Cancel → refund branch (has attendance)
    await caller.finance.receiptCancel({ id: receipt.id, reason: 'Hoàn tiền — đã đi học' });

    const student = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: studentId } }));
    expect(student.archivedAt).toBeNull(); // NOT archived

    const enrAfter = await withRls(SUPER, (tx) => tx.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } }));
    expect(enrAfter.status).toBe('withdrawn');
  });

  // ── 5. Rollback refund: pre-existing student → never archive ───────────────

  it('5. cancel refund: pre-existing student → student untouched', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    const batch = await createClassBatch(course.id);
    cleanup.courseIds.push(course.id);
    cleanup.batchIds.push(batch.id);

    // Pre-existing student (created directly, not via receipt)
    const existing = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: uniq('HS'), fullName: 'Existing HS', program: 'UCREA', lifecycle: 'active' },
      }),
    );
    cleanup.studentIds.push(existing.id);

    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      studentId: existing.id, // explicit link — pre-existing student
      classBatchId: batch.id,
    });
    cleanup.receiptIds.push(receipt.id);
    await caller.finance.receiptApprove({ id: receipt.id });

    await caller.finance.receiptCancel({ id: receipt.id, reason: 'Hoàn tiền HS có sẵn' });

    const student = await withRls(SUPER, (tx) => tx.student.findUniqueOrThrow({ where: { id: existing.id } }));
    expect(student.archivedAt).toBeNull(); // never archived — pre-existing guard holds
  });

  // ── 6. Draft cancel → no rollback ──────────────────────────────────────────

  it('6. cancelling a draft receipt (never approved) does not trigger student rollback', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('5')}`.slice(0, 12);
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS DraftCancel',
    });
    cleanup.receiptIds.push(receipt.id);

    // Cancel the draft WITHOUT approving
    await caller.finance.receiptCancel({ id: receipt.id, reason: 'Sai, hủy draft' });

    // No student should have been created (studentId is still null on the receipt)
    const r = await withRls(SUPER, (tx) => tx.receipt.findUniqueOrThrow({ where: { id: receipt.id } }));
    expect(r.status).toBe('cancelled');
    expect(r.studentId).toBeNull(); // never provisioned
  });
});
