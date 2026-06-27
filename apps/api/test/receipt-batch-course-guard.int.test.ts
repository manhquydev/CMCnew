/**
 * Invariant: receiptApprove must reject enrollment when the specified classBatch
 * belongs to a different course than the receipt's courseId.
 *
 * Bug: no courseId check existed → approving a receipt with classBatchId enrolled
 * the student into an unrelated batch (e.g., Course-P receipt → Course-S4 batch),
 * corrupting attendance attribution and commission KPIs.
 *
 * Fix: receiptApprove now fetches batch.courseId and throws BAD_REQUEST when
 * batch.courseId ≠ receipt.courseId, before any enrollment is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';

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
  let actorId: string;

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
      actorId = await superAdminUserId();
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

  it('rejects approval when batch.courseId ≠ receipt.courseId', async () => {
    if (!dbReachable) return;

    const caller = await staffCaller();

    // Receipt is for courseA, but the batch belongs to courseB — cross-course mismatch.
    // receiptCreate returns the receipt directly (the .then() in the handler unwraps pushNotifs).
    const receipt = await caller.finance.receiptCreate({
      facilityId: FAC,
      courseId: courseA.id,
      yearsPrepaid: 1,
      classBatchId: batchB.id, // mismatch: batch is for courseB
      parentPhone: uniq('090'),
      studentName: uniq('Student'),
    });
    cleanup.receiptIds.push(receipt.id);

    await expect(
      caller.finance.receiptApprove({ id: receipt.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // Confirm receipt is still draft (approve was rolled back).
    const still = await withRls(SUPER, (tx) => tx.receipt.findUniqueOrThrow({ where: { id: receipt.id } }));
    expect(still.status).toBe('draft');

    // Confirm no enrollment was created (the guard fires before enrollment logic).
    const enr = await withRls(SUPER, (tx) =>
      tx.enrollment.findFirst({ where: { createdByReceiptId: receipt.id } }),
    );
    expect(enr).toBeNull();
  });

  it('approves successfully when batch.courseId matches receipt.courseId', async () => {
    if (!dbReachable) return;

    const caller = await staffCaller();

    // Receipt is for courseA, batch is also for courseA — correct.
    const receipt = await caller.finance.receiptCreate({
      facilityId: FAC,
      courseId: courseA.id,
      yearsPrepaid: 1,
      classBatchId: batchA.id, // correct: batch for courseA
      parentPhone: uniq('091'),
      studentName: uniq('Student'),
    });
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
