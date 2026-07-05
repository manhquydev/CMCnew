/**
 * Integration tests: LMS StudentAccount provisioning at receipt.approve.
 *
 * Covers:
 *   1. New-student approve creates StudentAccount; loginCode logs in via lms-auth.loginStudent
 *   2. Idempotent: re-approve on already-approved receipt (races to CONFLICT) leaves account intact
 *   3. Idempotent: dedupe-matched student → no second StudentAccount created
 *   4. parentEmail captured on ParentAccount when provided at receiptCreate
 *   5. lms_account_ready email enqueued when parentEmail set + new student
 *   6. resetLmsPassword: changes password (old fails, new succeeds), bumps tokenVersion
 *   7. resetLmsPassword: NOT_FOUND when student has no LMS account
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loginStudent, resolveLmsSession, DEFAULT_STUDENT_PASSWORD } from '@cmc/auth';
import { staffCaller, withRls, SUPER, uniq, superAdminUserId, assertSuccess } from './helpers.js';

const FACILITY = 1;

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createCourseWithPrice() {
  const code = uniq('CRS');
  return withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code, name: `LMS Test Course ${code}`, program: 'UCREA' },
    });
    await tx.coursePrice.create({
      data: { facilityId: FACILITY, courseId: course.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
    });
    return course;
  });
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('LMS StudentAccount provisioning', () => {
  const cleanup = {
    receiptIds: [] as string[],
    studentIds: [] as string[],
    parentAccountIds: [] as string[],
    courseIds: [] as string[],
  };

  let dbReachable = false;

  beforeAll(async () => {
    try {
      await superAdminUserId();
      dbReachable = true;
    } catch {
      console.warn('⚠ DB not reachable — LMS provisioning tests skipped');
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await withRls(SUPER, async (tx) => {
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
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  // ── 1. Happy path: approve creates StudentAccount; loginCode+tempPassword work ──

  it('1. approve creates StudentAccount and returned tempPassword logs in via loginStudent', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('9')}`.slice(0, 12);
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: course.id,
      yearsPrepaid: 1,
      parentPhone: phone,
      parentName: 'PH Test',
      studentName: 'HS LMS Test',
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    expect(approved.status).toBe('approved');

    // lmsAccount must be present on a new student
    expect(approved.lmsAccount).not.toBeNull();
    const { loginCode, tempPassword } = approved.lmsAccount!;
    expect(loginCode).toMatch(/^HQ-HS-/); // facility-prefixed for global uniqueness
    expect(tempPassword).toBe(DEFAULT_STUDENT_PASSWORD); // fixed default, not random

    if (approved.studentId) cleanup.studentIds.push(approved.studentId);

    // StudentAccount exists in DB
    const acc = await withRls(SUPER, (tx) =>
      tx.studentAccount.findUnique({ where: { loginCode }, select: { isActive: true, studentId: true } }),
    );
    expect(acc).toBeTruthy();
    expect(acc!.isActive).toBe(true);

    // The returned tempPassword actually authenticates via loginStudent
    const session = await loginStudent(loginCode, tempPassword);
    expect(session).not.toBeNull();
    expect(session!.session.kind).toBe('student');
    expect(session!.session.studentIds).toContain(acc!.studentId);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);
  });

  // ── 2. Idempotent: re-approve attempt is blocked before provisioning ───────────

  it('2. re-approving an already-approved receipt rejects (CONFLICT) — does not duplicate StudentAccount', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('8')}`.slice(0, 12);
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS Idempotent',
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    if (approved.studentId) cleanup.studentIds.push(approved.studentId);
    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);

    // Second approve must throw
    await expect(caller.finance.receiptApprove({ id: receipt.id })).rejects.toThrow();

    // Only one StudentAccount for this student
    const count = await withRls(SUPER, (tx) =>
      tx.studentAccount.count({ where: { studentId: approved.studentId! } }),
    );
    expect(count).toBe(1);
  });

  // ── 3. Dedupe: second receipt for same phone reuses student; no second account ─

  it('3. dedupe-matched student on second receipt does not create a second StudentAccount', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('7')}`.slice(0, 12);

    // First receipt → creates student + StudentAccount
    const r1 = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS Dedupe LMS',
    }));
    cleanup.receiptIds.push(r1.id);
    const a1 = await caller.finance.receiptApprove({ id: r1.id });
    const studentId = a1.studentId!;
    cleanup.studentIds.push(studentId);
    expect(a1.lmsAccount).not.toBeNull(); // account created on first receipt

    // Second receipt for same phone → dedupe hit, no new account
    const r2 = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS Dedupe LMS',
    }));
    cleanup.receiptIds.push(r2.id);
    const a2 = await caller.finance.receiptApprove({ id: r2.id });
    expect(a2.studentId).toBe(studentId);
    // lmsAccount is null because account already existed (idempotent — no duplicate)
    expect(a2.lmsAccount).toBeNull();

    // Only one StudentAccount for the student
    const count = await withRls(SUPER, (tx) =>
      tx.studentAccount.count({ where: { studentId } }),
    );
    expect(count).toBe(1);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);
  });

  // ── 4. parentEmail is set on the ParentAccount when provided ─────────────────

  it('4. parentEmail provided at receiptCreate is stamped onto ParentAccount at approve', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('6')}`.slice(0, 12);
    const email = `ph_${uniq('e')}@example.com`;

    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, parentName: 'PH Email Test',
      parentEmail: email,
      studentName: 'HS Email Test',
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    if (approved.studentId) cleanup.studentIds.push(approved.studentId);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    expect(parent).toBeTruthy();
    expect(parent!.email).toBe(email);
    if (parent) cleanup.parentAccountIds.push(parent.id);
  });

  // ── 5. lms_account_ready email is enqueued when parentEmail is set ────────────

  it('5. lms_account_ready email enqueued when parentEmail provided + new student', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('5')}`.slice(0, 12);
    const email = `notify_${uniq('e')}@example.com`;

    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, parentEmail: email,
      studentName: 'HS Notify Test',
    }));
    cleanup.receiptIds.push(receipt.id);

    await caller.finance.receiptApprove({ id: receipt.id });

    const outbox = await withRls(SUPER, (tx) =>
      tx.emailOutbox.findFirst({ where: { toAddress: email, templateKind: 'lms_account_ready' } }),
    );
    expect(outbox).toBeTruthy();
    expect(outbox!.status).toBe('queued');
    expect(outbox!.subject).toContain('HS Notify Test');

    const approvedReceipt = await withRls(SUPER, (tx) => tx.receipt.findUnique({ where: { id: receipt.id }, select: { studentId: true } }));
    if (approvedReceipt?.studentId) cleanup.studentIds.push(approvedReceipt.studentId);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);
  });

  // ── 6. resetLmsPassword: fixed default returned, tokenVersion bump kicks out live sessions ─
  // The break-glass password is now a fixed constant (decision 0033 D2), so old/new password
  // strings are identical by design — the reset's real security value is the tokenVersion bump,
  // which invalidates any already-issued LMS JWT for this account.

  it('6. resetLmsPassword returns the fixed default and revokes prior sessions via tokenVersion bump', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const phone = `+84${uniq('4')}`.slice(0, 12);
    const receipt = assertSuccess(await caller.finance.receiptCreate({
      facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
      parentPhone: phone, studentName: 'HS Reset PW',
    }));
    cleanup.receiptIds.push(receipt.id);

    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    const studentId = approved.studentId!;
    cleanup.studentIds.push(studentId);
    const { loginCode, tempPassword: oldPw } = approved.lmsAccount!;
    expect(oldPw).toBe(DEFAULT_STUDENT_PASSWORD);

    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);

    // Mint a session BEFORE the reset — this token must be revoked once tokenVersion bumps.
    const before = await loginStudent(loginCode, oldPw);
    expect(before).not.toBeNull();
    expect(await resolveLmsSession(before!.token)).not.toBeNull();

    // Reset — fixed default (non-vacuous: still returns the same known constant), bumps tokenVersion.
    const reset = await caller.student.resetLmsPassword({ studentId });
    expect(reset.loginCode).toBe(loginCode);
    expect(reset.tempPassword).toBe(DEFAULT_STUDENT_PASSWORD);

    // The pre-reset token is now dead (stale tokenVersion) — the security-meaningful effect.
    expect(await resolveLmsSession(before!.token)).toBeNull();

    // The password itself is unchanged (still the fixed default) — a fresh login still works.
    const after = await loginStudent(loginCode, DEFAULT_STUDENT_PASSWORD);
    expect(after).not.toBeNull();
    expect(after!.session.studentIds).toContain(studentId);
  });

  // ── 7. resetLmsPassword CREATES an LMS account for a student that has none ─────
  // (create-or-reset: covers students made before auto-provisioning, or dedupe-matched ones).

  it('7. resetLmsPassword creates a facility-prefixed LMS account when the student has none', async () => {
    if (!dbReachable) return;
    const caller = await staffCaller();

    // Create a student directly (break-glass path — no receipt, so no StudentAccount yet)
    const code = uniq('HS');
    const student = await withRls(SUPER, (tx) =>
      tx.student.create({
        data: { facilityId: FACILITY, studentCode: code, fullName: 'HS No LMS', program: 'UCREA', lifecycle: 'active' },
      }),
    );
    cleanup.studentIds.push(student.id);

    // No account before.
    const before = await withRls(SUPER, (tx) =>
      tx.studentAccount.findUnique({ where: { studentId: student.id }, select: { id: true } }),
    );
    expect(before).toBeNull();

    const facility = await withRls(SUPER, (tx) =>
      tx.facility.findUniqueOrThrow({ where: { id: FACILITY }, select: { code: true } }),
    );

    // resetLmsPassword now provisions on demand: returns the facility-prefixed loginCode (decision
    // 0033 M1 — aligns to the SAME scheme finance.ts's provisioning uses, so login_code's global
    // @unique never collides across facilities) + the fixed default tempPassword.
    const res = await caller.student.resetLmsPassword({ studentId: student.id });
    expect(res.loginCode).toBe(`${facility.code}-${code}`);
    expect(res.tempPassword).toBe(DEFAULT_STUDENT_PASSWORD);

    // Account now exists and is active.
    const after = await withRls(SUPER, (tx) =>
      tx.studentAccount.findUnique({
        where: { studentId: student.id },
        select: { loginCode: true, isActive: true },
      }),
    );
    expect(after?.loginCode).toBe(`${facility.code}-${code}`);
    expect(after?.isActive).toBe(true);
  });
});
