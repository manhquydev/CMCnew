/**
 * Unit tests for the pure cancel-rollback classifier (no DB required).
 *
 * Covers every branch of classifyCancelRollback:
 *   - pre-existing student (createdByReceiptId null)
 *   - student created by a DIFFERENT receipt
 *   - void: created-by-this + 0 attendance + 0 other receipts
 *   - refund: created-by-this + has attendance
 *   - refund: created-by-this + has other approved receipts
 *   - refund: created-by-this + both attendance AND other receipts
 *   - multi-enrollment scoping: only this receipt's enrollment attendance counts
 */
import { describe, it, expect } from 'vitest';
import { classifyCancelRollback } from '../src/services/student-provisioning.js';

const RX_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const RX_B = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('classifyCancelRollback — pure classifier', () => {
  it('pre-existing student (createdByReceiptId null) → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: null,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('refund_only');
  });

  it('student created by a DIFFERENT receipt → refund_only (never archive pre-existing)', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_B,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('refund_only');
  });

  it('created by this receipt + 0 attendance + 0 other receipts → void_student', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('void_student');
  });

  it('created by this receipt + has attendance → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 3,
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('refund_only');
  });

  it('created by this receipt + exactly 1 attendance → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 1,
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('refund_only');
  });

  it('created by this receipt + has other approved receipt → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 1,
    });
    expect(d.action).toBe('refund_only');
  });

  it('created by this receipt + multiple other approved receipts → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 5,
    });
    expect(d.action).toBe('refund_only');
  });

  it('created by this receipt + both attendance AND other receipts → refund_only', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 2,
      otherApprovedReceiptCount: 3,
    });
    expect(d.action).toBe('refund_only');
  });

  it('multi-enrollment scoping: only THIS receipt enrollment attendance counts for void decision', () => {
    // Scenario: student has another enrollment (from a different path) with attendance,
    // but the enrollment created by THIS receipt has 0 attendance → void conditions met.
    // The attendanceCountForThisReceiptEnrollments isolates to just this receipt's scope.
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0, // this receipt's enrollment has 0 attendance
      otherApprovedReceiptCount: 0,
    });
    expect(d.action).toBe('void_student');
  });

  it('refund_only reason contains diagnostic text', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: null,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    expect(d.reason).toContain('pre-existing');
  });

  it('void_student reason contains diagnostic text', () => {
    const d = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    expect(d.reason).toContain('mistake void');
  });

  it('mutation-proof: void and refund produce different actions', () => {
    const void_ = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 0,
      otherApprovedReceiptCount: 0,
    });
    const refund = classifyCancelRollback({
      receiptId: RX_A,
      studentCreatedByReceiptId: RX_A,
      attendanceCountForThisReceiptEnrollments: 1,
      otherApprovedReceiptCount: 0,
    });
    expect(void_.action).not.toBe(refund.action);
  });
});
