import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId, assertSuccess } from './helpers.js';

/**
 * Integration test: receipt `kind` classification by history fallback.
 *
 * Behavior locked from payroll-v2-commission-design.md and receiptApprove (finance.ts:235-245):
 *
 * Receipt approve derives `kind` as follows:
 * - If receipt linked to opportunity with stage O5_ENROLLED → kind = 'new' (covers first-time AND win-back via fresh funnel).
 * - Otherwise (NO opportunity OR opportunity not O5_ENROLLED):
 *   - If student has prior collected/approved/sent/reconciled receipt → kind = 'renewal'
 *   - Else → kind = 'new'
 *
 * This test locks the history-fallback logic (Case A: renewal; Case B: new) so a future
 * regression in the prior-receipt check is caught.
 *
 * Case A with prior receipt→renewed, Case B without prior→new are mutually exclusive,
 * so mutation (removal/inversion) of the history fallback is immediately caught.
 */
describe('receipt-kind-classification: history fallback (no opportunityId)', () => {
  const FACILITY = 1;

  let course: { id: string; code: string };
  const created = {
    courseIds: [] as string[],
    studentIds: [] as string[],
    receiptIds: [] as string[],
  };

  beforeAll(async () => {
    await superAdminUserId();

    // Create a shared course for all cases
    const courseCode = uniq('CRS');
    const courseData = await withRls(SUPER, async (tx) => {
      const c = await tx.course.create({
        data: { code: courseCode, name: 'History Fallback Test Course', program: 'UCREA' },
      });
      await tx.coursePrice.create({
        data: {
          facilityId: FACILITY,
          courseId: c.id,
          amount: 10_000_000,
          effectiveFrom: new Date('2020-01-01'),
        },
      });
      return c;
    });
    course = courseData;
    created.courseIds.push(course.id);
  });

  afterAll(async () => {
    await withRls(SUPER, async (tx) => {
      // Clean up in reverse creation order (FK constraints)
      if (created.receiptIds.length > 0) {
        await tx.receipt.deleteMany({ where: { id: { in: created.receiptIds } } });
      }
      if (created.studentIds.length > 0) {
        await tx.student.deleteMany({ where: { id: { in: created.studentIds } } });
      }
      if (created.courseIds.length > 0) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: created.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: created.courseIds } } });
      }
    });
  });

  it('Case A: receipt with NO opportunityId + student HAS prior approved receipt → kind = "renewal"', async () => {
    const caller = await staffCaller();

    // Create student with prior receipt history
    const studentCode = uniq('HSA');
    const student = await withRls(SUPER, async (tx) => {
      return tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode,
          fullName: 'Student With Prior Receipt',
          program: 'UCREA',
        },
      });
    });
    created.studentIds.push(student.id);

    // Create and approve first receipt (builds history)
    const prior = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
    }));
    const priorApproved = await caller.finance.receiptApprove({ id: prior.id });
    created.receiptIds.push(priorApproved.id);

    // Create second receipt (no opportunityId, student now has prior approved receipt)
    const second = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      // NO opportunityId
    }));

    // Approve it → should fallback to history: priorCollected > 0 → 'renewal'
    const approved = await caller.finance.receiptApprove({ id: second.id });

    expect(approved.kind).toBe('renewal');
    created.receiptIds.push(approved.id);
  });

  it('Case B: receipt with NO opportunityId + student has NO prior receipt → kind = "new"', async () => {
    const caller = await staffCaller();

    // Create fresh student with NO prior receipts
    const studentCode = uniq('HSB');
    const student = await withRls(SUPER, async (tx) => {
      return tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode,
          fullName: 'Fresh Student No Prior',
          program: 'UCREA',
        },
      });
    });
    created.studentIds.push(student.id);

    // Create receipt (no opportunityId, student has NO prior receipts)
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: student.id,
      courseId: course.id,
      yearsPrepaid: 1,
      // NO opportunityId
    }));

    // Approve it → should fallback to history: priorCollected = 0 → 'new'
    const approved = await caller.finance.receiptApprove({ id: receipt.id });

    expect(approved.kind).toBe('new');
    created.receiptIds.push(approved.id);
  });

  it('Mutation-proof: the two cases produce DIFFERENT kinds (A=renewal, B=new)', async () => {
    const caller = await staffCaller();

    // Create student A with prior receipt (→ should be 'renewal' when no opp)
    const codeA = uniq('HSM1');
    const studentA = await withRls(SUPER, async (tx) => {
      return tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: codeA,
          fullName: 'Mutation Student A',
          program: 'UCREA',
        },
      });
    });
    created.studentIds.push(studentA.id);

    const priorA = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: studentA.id,
      courseId: course.id,
      yearsPrepaid: 1,
    }));
    const priorAApproved = await caller.finance.receiptApprove({ id: priorA.id });
    created.receiptIds.push(priorAApproved.id);

    // Create student B with NO prior receipt (→ should be 'new' when no opp)
    const codeB = uniq('HSM2');
    const studentB = await withRls(SUPER, async (tx) => {
      return tx.student.create({
        data: {
          facilityId: FACILITY,
          studentCode: codeB,
          fullName: 'Mutation Student B',
          program: 'UCREA',
        },
      });
    });
    created.studentIds.push(studentB.id);

    // Create receipts for both (no opportunityId)
    const recA = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: studentA.id,
      courseId: course.id,
      yearsPrepaid: 1,
    }));
    const approvedA = await caller.finance.receiptApprove({ id: recA.id });

    const recB = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      studentId: studentB.id,
      courseId: course.id,
      yearsPrepaid: 1,
    }));
    const approvedB = await caller.finance.receiptApprove({ id: recB.id });

    // Verify they differ (if history logic is removed/broken, both become 'new')
    expect(approvedA.kind).toBe('renewal');
    expect(approvedB.kind).toBe('new');
    expect(approvedA.kind).not.toBe(approvedB.kind);

    created.receiptIds.push(approvedA.id, approvedB.id);
  });
});
