/**
 * Invariant (current, per finance.ts receiptApprove + commit b1ec5a4):
 * receiptApprove enforces a FACILITY-match guard on the chosen classBatch, and does
 * NOT enforce a courseId-match guard.
 *
 * Rationale (documented in finance.ts): ClassBatch.courseId references the
 * curriculum-content course (LMS homework mapping), while Receipt.courseId references
 * the priced sales course (what was billed) — two structurally separate catalogs, not
 * the same entity. Staff picks the class explicitly in the UI and that choice is trusted,
 * so a courseId mismatch is allowed. The real defect guarded against is enrolling a
 * receipt's student into a batch that physically belongs to a different FACILITY.
 *
 * (Historical note: an earlier version rejected on courseId mismatch; that guard was
 * intentionally replaced by the facility guard above. These tests assert the current behavior.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId, assertSuccess } from './helpers.js';

const FAC = 1;

async function createCourseWithPrice(program: 'UCREA' | 'BRIGHT_IG' = 'UCREA') {
  const code = uniq('CRS');
  return withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code, name: `Guard Test Course ${code}`, program },
    });
    await tx.coursePrice.create({
      data: { facilityId: FAC, courseId: course.id, amount: 8_000_000, effectiveFrom: new Date('2020-01-01') },
    });
    return course;
  });
}

async function createBatch(courseId: string) {
  const code = uniq('B');
  return withRls(SUPER, (tx) =>
    tx.classBatch.create({
      data: { facilityId: FAC, courseId, code, name: `Batch ${code}`, status: 'open' },
    }),
  );
}

describe('receiptApprove — batch/course mismatch guard', () => {
  let _actorId: string;

  // Two courses so we can create a cross-course mismatch.
  let courseA: { id: string };
  let courseB: { id: string };
  let batchA: { id: string }; // batch for courseA
  let batchB: { id: string }; // batch for courseB

  const cleanup = {
    receiptIds: [] as string[],
    studentIds: [] as string[],
    parentAccountIds: [] as string[],
    courseIds: [] as string[],
    batchIds: [] as string[],
  };

  let dbReachable = false;

  beforeAll(async () => {
    try {
      _actorId = await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — integration tests skipped');
      return;
    }

    courseA = await createCourseWithPrice('UCREA');
    courseB = await createCourseWithPrice('BRIGHT_IG');
    cleanup.courseIds.push(courseA.id, courseB.id);

    batchA = await createBatch(courseA.id);
    batchB = await createBatch(courseB.id);
    cleanup.batchIds.push(batchA.id, batchB.id);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
      // Receipts referencing our test courses must be deleted before courses (FK constraint).
      // Scope by courseId so we catch any receipt from a previous failed run, not only tracked IDs.
      if (cleanup.courseIds.length) {
        const allReceipts = await tx.receipt.findMany({
          where: { courseId: { in: cleanup.courseIds } },
          select: { id: true },
        });
        const allReceiptIds = allReceipts.map((r) => r.id);
        if (allReceiptIds.length) {
          await tx.enrollment.updateMany({
            where: { createdByReceiptId: { in: allReceiptIds } },
            data: { createdByReceiptId: null },
          });
          await tx.student.updateMany({
            where: { createdByReceiptId: { in: allReceiptIds } },
            data: { createdByReceiptId: null },
          });
          await tx.recordEvent.deleteMany({ where: { entityType: 'receipt', entityId: { in: allReceiptIds } } });
          await tx.receipt.deleteMany({ where: { id: { in: allReceiptIds } } });
        }
      }
      if (cleanup.studentIds.length) {
        // Enrollments must be deleted before their student (FK: enrollment.studentId).
        await tx.enrollment.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.guardian.deleteMany({ where: { studentId: { in: cleanup.studentIds } } });
        await tx.student.deleteMany({ where: { id: { in: cleanup.studentIds } } });
      }
      if (cleanup.parentAccountIds.length)
        await tx.parentAccount.deleteMany({ where: { id: { in: cleanup.parentAccountIds } } });
      if (cleanup.batchIds.length)
        await tx.classBatch.deleteMany({ where: { id: { in: cleanup.batchIds } } });
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  it('ALLOWS a batch whose course differs from the receipt (separate catalogs, same facility)', async () => {
    if (!dbReachable) return;

    const caller = await staffCaller();

    // Receipt is for courseA, batch belongs to courseB — a cross-course pairing that is
    // intentionally permitted (curriculum course vs billed course are separate catalogs).
    // Both live at the same facility (FAC), so the facility guard does not fire.
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FAC,
      courseId: courseA.id,
      yearsPrepaid: 1,
      classBatchId: batchB.id, // different course, same facility → allowed
      parentPhone: uniq('090'),
      studentName: uniq('Student'),
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');
    if (approved.studentId) cleanup.studentIds.push(approved.studentId);

    // Enrollment IS created into the staff-chosen batch (the trusted class pick).
    const enr = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({
        where: { createdByReceiptId: receipt.id },
        select: { classBatchId: true },
      }),
    );
    expect(enr).not.toBeNull();
    expect(enr!.classBatchId).toBe(batchB.id);
    const pa = await withRls(SUPER, (tx) =>
      tx.guardian.findFirst({ where: { studentId: approved.studentId ?? '' }, select: { parentAccountId: true } }),
    );
    if (pa) cleanup.parentAccountIds.push(pa.parentAccountId);
  });

  it('approves successfully when batch.courseId matches receipt.courseId', async () => {
    if (!dbReachable) return;

    const caller = await staffCaller();

    // Receipt is for courseA, batch is also for courseA — correct.
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FAC,
      courseId: courseA.id,
      yearsPrepaid: 1,
      classBatchId: batchA.id, // correct: batch for courseA
      parentPhone: uniq('091'),
      studentName: uniq('Student'),
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');

    // Enrollment created for the matching batch.
    const enr = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({
        where: { createdByReceiptId: receipt.id },
        select: { id: true, classBatchId: true, studentId: true },
      }),
    );
    expect(enr).not.toBeNull();
    expect(enr!.classBatchId).toBe(batchA.id);

    // Track created student + parent for cleanup.
    if (approved.studentId) cleanup.studentIds.push(approved.studentId);
    const pa = await withRls(SUPER, (tx) =>
      tx.guardian.findFirst({ where: { studentId: approved.studentId ?? '' }, select: { parentAccountId: true } }),
    );
    if (pa) cleanup.parentAccountIds.push(pa.parentAccountId);
  });
});
