/**
 * Pure decision logic for student provisioning at receipt.approve and rollback at receiptCancel.
 *
 * No Prisma here — all DB I/O lives in the router (finance.ts). These functions receive
 * pre-fetched facts and return a typed decision. This makes the business rules unit-testable
 * without a database.
 *
 * Invariants (locked decisions):
 *   - A student is only created at receipt.approve, never as an orphan.
 *   - Dedupe key = parent phone (ParentAccount.phone → Guardian → Student).
 *   - createdByReceiptId on Student: set ONLY when this receipt actually created a new student.
 *   - Rollback branch:
 *       void  = student was created by THIS receipt AND has zero attendance AND no other approved receipt
 *       refund = everything else (pre-existing student / has attendance / has other approved receipt)
 *   - A dedupe-matched pre-existing student MUST NEVER be archived.
 */

// ---------------------------------------------------------------------------
// Cancel rollback classifier
// ---------------------------------------------------------------------------

export type CancelFacts = {
  /** The receipt being cancelled. */
  receiptId: string;
  /** Student.createdByReceiptId — null if manually provisioned or seeded. */
  studentCreatedByReceiptId: string | null;
  /**
   * Total Attendance records across all Enrollments that were created by this receipt
   * (enrollment.createdByReceiptId === receiptId). Only attendance on THIS receipt's
   * enrollments is checked — multi-program enrollments from other receipts are scoped out.
   */
  attendanceCountForThisReceiptEnrollments: number;
  /**
   * Count of receipts in approved/sent/reconciled status for this student,
   * excluding the receipt being cancelled.
   */
  otherApprovedReceiptCount: number;
};

export type CancelDecision =
  | { action: 'void_student'; reason: string }
  | { action: 'refund_only'; reason: string };

/**
 * Determine whether cancelling a receipt should archive the student (void) or just
 * wind down the receipt's enrollment(s) (refund_only).
 *
 * The void branch is a strict AND of three conditions:
 *   1. Student was created by THIS receipt (not pre-existing, not seeded, not deduped from another)
 *   2. Zero attendance on the enrollments this receipt created
 *   3. No other approved/sent/reconciled receipt for the student
 *
 * Any condition missing → refund_only. Pre-existing students are always refund_only.
 */
export function classifyCancelRollback(facts: CancelFacts): CancelDecision {
  // Guard: student not created by THIS receipt → never archive
  if (facts.studentCreatedByReceiptId !== facts.receiptId) {
    return {
      action: 'refund_only',
      reason: 'pre-existing student: created by a different receipt or manually provisioned',
    };
  }

  // Student was created by this receipt. Check the two void conditions:

  // Has attendance on THIS receipt's enrollments → genuine academic engagement
  if (facts.attendanceCountForThisReceiptEnrollments > 0) {
    return {
      action: 'refund_only',
      reason: 'student has attendance records on this receipt\'s enrollments — genuine refund, not mistake void',
    };
  }

  // Has other approved receipts → financially active via another transaction
  if (facts.otherApprovedReceiptCount > 0) {
    return {
      action: 'refund_only',
      reason: 'student has other approved receipts — genuine refund path',
    };
  }

  // All conditions met: this was a mistake — void the student
  return {
    action: 'void_student',
    reason: 'mistake void: student created by this receipt, zero attendance, no other approved receipts',
  };
}
