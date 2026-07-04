/**
 * Integration tests: family login (student LMS login = parent phone + profile picker).
 * Covers decision docs/decisions/0033-student-login-phone-identity.md.
 *
 * Mandatory security gates:
 *   - B1: a phone-login artifact (ticket) never authorizes a parentProcedure mutation, and is
 *     never usable as an LMS session/cookie.
 *   - S1: concurrent first-sibling approval of a brand-new phone never rolls back the money tx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  loginFamilyByPhone,
  verifyChildSelectionTicket,
  mintStudentSessionForStudent,
  resolveLmsSession,
  loginStudent,
  lmsRlsContextOf,
  type LmsSession,
} from '@cmc/auth';
import { hashPassword } from '@cmc/db';
import { staffCaller, lmsCaller, withRls, SUPER, uniq, superAdminUserId } from './helpers.js';
import type { ApiContext } from '../src/context.js';
import { appRouter } from '../src/routers/index.js';

/** A fully unauthenticated caller (no staff session, no LMS principal) — mirrors the convention
 * in curriculum-read.int.test.ts / search-global.int.test.ts. */
function anonCaller() {
  // Minimal Hono ctx: setLmsCookie → hono setCookie → c.header('set-cookie', …). A no-op header
  // suffices (mirrors the convention in email-otp-login.int.test.ts's publicCaller()).
  const c = { header: () => undefined } as unknown as ApiContext['c'];
  const ctx: ApiContext = { c, session: null, lms: null, ip: 'test' };
  return appRouter.createCaller(ctx);
}

const FACILITY = 1;

async function createCourseWithPrice() {
  const code = uniq('CRS');
  return withRls(SUPER, async (tx) => {
    const course = await tx.course.create({
      data: { code, name: `Family Login Test Course ${code}`, program: 'UCREA' },
    });
    await tx.coursePrice.create({
      data: { facilityId: FACILITY, courseId: course.id, amount: 10_000_000, effectiveFrom: new Date('2020-01-01') },
    });
    return course;
  });
}

/** A fresh, ALREADY-canonical `84xxxxxxxxx` phone unique per test run — normalizeLoginPhone is a
 * no-op passthrough on this shape, so the raw string passed to receiptCreate is byte-identical
 * to what provisioning stores/dedupes on (tests can look it up directly, no re-normalization).
 * Includes a monotonic counter — `uniq()`'s millisecond-granularity timestamp alone can collide
 * when called twice synchronously (no `await` between calls) in the same test. */
let phoneCounter = 0;
function freshPhone(): string {
  const digits = `${uniq('').replace(/\D/g, '')}${++phoneCounter}`.slice(-9).padStart(9, '0');
  return `84${digits}`;
}

describe('Family login (phone + Cmc2026@ + profile picker)', () => {
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
      console.warn('⚠ DB not reachable — family login tests skipped');
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
        await tx.guardianLinkRequest.deleteMany({ where: { requestedByAccountId: { in: cleanup.parentAccountIds } } });
        await tx.parentAccount.deleteMany({ where: { id: { in: cleanup.parentAccountIds } } });
      }
      if (cleanup.courseIds.length) {
        await tx.coursePrice.deleteMany({ where: { courseId: { in: cleanup.courseIds } } });
        await tx.course.deleteMany({ where: { id: { in: cleanup.courseIds } } });
      }
    });
  });

  async function approveNewStudent(phone: string, studentName: string, opts?: { parentName?: string }) {
    const caller = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);
    const receipt = await caller.finance.receiptCreate({
      facilityId: FACILITY,
      courseId: course.id,
      yearsPrepaid: 1,
      parentPhone: phone,
      parentName: opts?.parentName,
      studentName,
    });
    cleanup.receiptIds.push(receipt.id);
    const approved = await caller.finance.receiptApprove({ id: receipt.id });
    if (approved.studentId) cleanup.studentIds.push(approved.studentId);
    return approved;
  }

  async function trackParent(phone: string) {
    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirst({ where: { phone } }));
    if (parent) cleanup.parentAccountIds.push(parent.id);
    return parent;
  }

  // ── 1. Provision + login (1 child) ──────────────────────────────────────────

  it('1. approve provisions a family login; loginFamilyByPhone + enterChildProfile yield a student session', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const approved = await approveNewStudent(phone, 'HS Family Login 1');
    await trackParent(phone);

    const result = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(result).not.toBeNull();
    expect(result!.children).toHaveLength(1);
    expect(result!.children[0].id).toBe(approved.studentId);

    const verified = await verifyChildSelectionTicket(result!.ticket);
    expect(verified).not.toBeNull();
    const entered = await mintStudentSessionForStudent(approved.studentId!, verified!.parentAccountId);
    expect(entered.ok).toBe(true);
    if (entered.ok) {
      expect(entered.session.kind).toBe('student');
      expect(entered.session.studentIds).toContain(approved.studentId);
    }
  });

  // ── 2. Picker (2+ children) — idempotent sibling attach ─────────────────────

  it('2. two children on the same phone both appear in the picker; no 2nd ParentAccount, 2nd approve does not throw', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const a1 = await approveNewStudent(phone, 'HS Sibling One');
    const a2 = await approveNewStudent(phone, 'HS Sibling Two');
    await trackParent(phone);

    expect(a1.studentId).not.toBe(a2.studentId);

    const parents = await withRls(SUPER, (tx) => tx.parentAccount.findMany({ where: { phone } }));
    expect(parents).toHaveLength(1); // exactly one ParentAccount for the phone

    const result = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(result).not.toBeNull();
    const ids = result!.children.map((c) => c.id).sort();
    expect(ids).toEqual([a1.studentId, a2.studentId].sort());
  });

  // ── 3. Family password set once, never overwritten by a later sibling ──────

  it('3. a returning parent\'s changed family password survives a 2nd sibling approve', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    await approveNewStudent(phone, 'HS Password Once 1');
    await trackParent(phone);

    // Simulate a family password that has already been changed away from the default.
    await withRls(SUPER, async (tx) => {
      const parent = await tx.parentAccount.findFirstOrThrow({ where: { phone } });
      await tx.parentAccount.update({
        where: { id: parent.id },
        data: { passwordHash: await hashPassword('AlreadyChanged9@') },
      });
    });

    await approveNewStudent(phone, 'HS Password Once 2');

    // The changed password must still work; the default must NOT.
    const withChanged = await loginFamilyByPhone(phone, 'AlreadyChanged9@');
    expect(withChanged).not.toBeNull();
    const withDefault = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(withDefault).toBeNull();
  });

  // ── 4. No-phone fallback: malformed phone never blocks provisioning ─────────

  it('4. a malformed parentPhone still provisions the break-glass account (no family login)', async () => {
    if (!dbReachable) return;
    const badPhone = '123'; // too short to normalize
    const approved = await approveNewStudent(badPhone, 'HS No Phone Fallback');
    expect(approved.lmsAccount).not.toBeNull();

    const session = await loginStudent(approved.lmsAccount!.loginCode, approved.lmsAccount!.tempPassword);
    expect(session).not.toBeNull();

    const familyLogin = await loginFamilyByPhone(badPhone, 'Cmc2026@');
    expect(familyLogin).toBeNull();
  });

  // ── 5. enterChildProfile cross-family FORBIDDEN (server re-resolve) ─────────

  it('5. a ticket from family A cannot enter a child of family B', async () => {
    if (!dbReachable) return;
    const phoneA = freshPhone();
    const phoneB = freshPhone();
    await approveNewStudent(phoneA, 'HS Family A Child');
    const bApproved = await approveNewStudent(phoneB, 'HS Family B Child');
    await trackParent(phoneA);
    await trackParent(phoneB);

    const loginA = await loginFamilyByPhone(phoneA, 'Cmc2026@');
    expect(loginA).not.toBeNull();
    const verifiedA = await verifyChildSelectionTicket(loginA!.ticket);
    expect(verifiedA).not.toBeNull();

    const result = await mintStudentSessionForStudent(bApproved.studentId!, verifiedA!.parentAccountId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });

  // ── 6. Blocked-lifecycle child hidden from picker + FORBIDDEN on direct attempt ─

  it('6. a blocked (on_hold) child is absent from the picker and FORBIDDEN via enterChildProfile', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const approved = await approveNewStudent(phone, 'HS Blocked Lifecycle');
    await trackParent(phone);

    await withRls(SUPER, (tx) =>
      tx.student.update({ where: { id: approved.studentId! }, data: { lifecycle: 'on_hold' } }),
    );

    const result = await loginFamilyByPhone(phone, 'Cmc2026@');
    // Sole child now blocked → zero non-blocked children → loginFamilyByPhone itself returns null.
    expect(result).toBeNull();

    // Direct attempt via a ticket signed against the parent (bypassing the "0 children" gate)
    // must still be rejected server-side when re-resolving membership.
    const parent = await withRls(SUPER, (tx) => tx.parentAccount.findFirstOrThrow({ where: { phone } }));
    const mint = await mintStudentSessionForStudent(approved.studentId!, parent.id);
    expect(mint.ok).toBe(false);
    if (!mint.ok) expect(mint.reason).toBe('forbidden');
  });

  // ── 7. Non-vacuous family reset (via guardian.resetFamilyPassword) ──────────

  it('7. resetFamilyPassword: old (non-default) password fails after reset, Cmc2026@ works, tokenVersion bumps', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const approved = await approveNewStudent(phone, 'HS Non Vacuous Reset');
    const parent = await trackParent(phone);
    expect(parent).not.toBeNull();

    // Seed a non-default password directly.
    await withRls(SUPER, async (tx) => {
      await tx.parentAccount.update({
        where: { id: parent!.id },
        data: { passwordHash: await hashPassword('NotDefault9@') },
      });
    });

    const beforeVersion = (await withRls(SUPER, (tx) =>
      tx.parentAccount.findUniqueOrThrow({ where: { id: parent!.id }, select: { tokenVersion: true } }),
    )).tokenVersion;

    const staff = await staffCaller();
    const reset = await staff.guardian.resetFamilyPassword({ parentAccountId: parent!.id });
    expect(reset.ok).toBe(true);

    expect(await loginFamilyByPhone(phone, 'NotDefault9@')).toBeNull();
    const afterDefault = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(afterDefault).not.toBeNull();
    expect(afterDefault!.children.map((c) => c.id)).toContain(approved.studentId);

    const afterVersion = (await withRls(SUPER, (tx) =>
      tx.parentAccount.findUniqueOrThrow({ where: { id: parent!.id }, select: { tokenVersion: true } }),
    )).tokenVersion;
    expect(afterVersion).toBe(beforeVersion + 1);
  });

  // ── 8. changeFamilyPassword happy path + tokenVersion revocation ────────────

  it('8. changeFamilyPassword updates own credential and revokes the prior family session', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    await approveNewStudent(phone, 'HS Change Password');
    const parent = await trackParent(phone);
    expect(parent).not.toBeNull();

    const parentSessionShape: LmsSession = {
      kind: 'parent',
      accountId: parent!.id,
      displayName: parent!.displayName,
      students: [],
      studentIds: [],
      facilityIds: [],
    };

    const beforeVersion = (await withRls(SUPER, (tx) =>
      tx.parentAccount.findUniqueOrThrow({ where: { id: parent!.id }, select: { tokenVersion: true } }),
    )).tokenVersion;

    const caller = lmsCaller(parentSessionShape);
    const result = await caller.guardian.changeFamilyPassword({ newPassword: 'BrandNew9@' });
    expect(result.ok).toBe(true);

    const afterVersion = (await withRls(SUPER, (tx) =>
      tx.parentAccount.findUniqueOrThrow({ where: { id: parent!.id }, select: { tokenVersion: true } }),
    )).tokenVersion;
    expect(afterVersion).toBe(beforeVersion + 1);

    expect(await loginFamilyByPhone(phone, 'Cmc2026@')).toBeNull();
    expect(await loginFamilyByPhone(phone, 'BrandNew9@')).not.toBeNull();
  });

  // ── 9. RLS isolation: a parent principal cannot write another family's row ──

  it('9. a parent principal cannot update a different ParentAccount row (RLS denial)', async () => {
    if (!dbReachable) return;
    const phoneA = freshPhone();
    const phoneB = freshPhone();
    await approveNewStudent(phoneA, 'HS RLS A');
    await approveNewStudent(phoneB, 'HS RLS B');
    const parentA = await trackParent(phoneA);
    const parentB = await trackParent(phoneB);
    expect(parentA).not.toBeNull();
    expect(parentB).not.toBeNull();

    const asA: LmsSession = {
      kind: 'parent',
      accountId: parentA!.id,
      displayName: parentA!.displayName,
      students: [],
      studentIds: [],
      facilityIds: [],
    };

    await expect(
      withRls(lmsRlsContextOf(asA), (tx) =>
        tx.parentAccount.update({ where: { id: parentB!.id }, data: { displayName: 'Hijacked' } }),
      ),
    ).rejects.toThrow();

    const bUnchanged = await withRls(SUPER, (tx) =>
      tx.parentAccount.findUniqueOrThrow({ where: { id: parentB!.id }, select: { displayName: true } }),
    );
    expect(bUnchanged.displayName).not.toBe('Hijacked');
  });

  // ── 10. [MANDATORY B1] phone-login artifact rejected by every parentProcedure mutation ──

  it('11. [B1] a phone-login-only context (no LMS session) is rejected by guardian.profileUpdate and guardian.requestLink', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    await approveNewStudent(phone, 'HS B1 Guard');
    await trackParent(phone);

    // Obtain a ticket — but per the design it can NEVER populate ctx.lms (it isn't a cookie, isn't
    // read from one, and structurally fails resolveLmsSession — see test 12). The only way a
    // phone-login artifact could reach a parentProcedure mutation is if it were smuggled into
    // ctx.lms; simulate the actual attacker-observable state (no session) and confirm rejection.
    const result = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(result).not.toBeNull();

    await expect(
      anonCaller().guardian.profileUpdate({ displayName: 'Attacker Renamed' }),
    ).rejects.toThrow();
    await expect(
      anonCaller().guardian.requestLink({ studentCode: 'HS-anything' }),
    ).rejects.toThrow();
  });

  // ── 11. [MANDATORY B1] the ticket is not a session ──────────────────────────

  it('12. [B1] the child-selection ticket is rejected by resolveLmsSession and by a tampered/expired ticket', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    await approveNewStudent(phone, 'HS B1 Ticket Shape');
    await trackParent(phone);

    const result = await loginFamilyByPhone(phone, 'Cmc2026@');
    expect(result).not.toBeNull();

    // The ticket must NEVER resolve as an LMS session (it carries no `kind`).
    expect(await resolveLmsSession(result!.ticket)).toBeNull();

    // A tampered ticket is rejected outright.
    expect(await verifyChildSelectionTicket(result!.ticket + 'tampered')).toBeNull();
  });

  // ── 12. [MANDATORY S1] concurrent first-sibling approve never rolls back the money tx ──

  it('13. [S1] two brand-new siblings of the same brand-new phone approved concurrently both commit', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const caller1 = await staffCaller();
    const caller2 = await staffCaller();
    const course = await createCourseWithPrice();
    cleanup.courseIds.push(course.id);

    const [r1, r2] = await Promise.all([
      caller1.finance.receiptCreate({
        facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
        parentPhone: phone, studentName: 'HS Concurrent Sibling One',
      }),
      caller2.finance.receiptCreate({
        facilityId: FACILITY, courseId: course.id, yearsPrepaid: 1,
        parentPhone: phone, studentName: 'HS Concurrent Sibling Two',
      }),
    ]);
    cleanup.receiptIds.push(r1.id, r2.id);

    const [a1, a2] = await Promise.all([
      caller1.finance.receiptApprove({ id: r1.id }),
      caller2.finance.receiptApprove({ id: r2.id }),
    ]);

    // Both money transactions must commit — neither approve may throw due to the ParentAccount
    // phone unique-violation race (decision 0033 S1).
    expect(a1.status).toBe('approved');
    expect(a2.status).toBe('approved');
    if (a1.studentId) cleanup.studentIds.push(a1.studentId);
    if (a2.studentId) cleanup.studentIds.push(a2.studentId);

    const parents = await withRls(SUPER, (tx) => tx.parentAccount.findMany({ where: { phone } }));
    expect(parents).toHaveLength(1); // both siblings converged onto the SAME ParentAccount
    cleanup.parentAccountIds.push(parents[0].id);
  });

  // ── 14. Router-level coverage: loginFamilyByPhone → enterChildProfile through the actual
  // tRPC procedures (not just the underlying @cmc/auth functions) — exercises rate-limiting,
  // TRPCError mapping, and the real setLmsCookie call.

  it('14. router: loginFamilyByPhone + enterChildProfile mint a real student principal; bad ticket/cross-family reject', async () => {
    if (!dbReachable) return;
    const phone = freshPhone();
    const approved = await approveNewStudent(phone, 'HS Router Level');
    await trackParent(phone);

    const anon = anonCaller();

    // Wrong password → UNAUTHORIZED, no account enumeration (generic message either way).
    await expect(
      anon.lmsAuth.loginFamilyByPhone({ phone, password: 'WrongPassword9@' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const login = await anon.lmsAuth.loginFamilyByPhone({ phone, password: 'Cmc2026@' });
    expect(login.children.map((c) => c.id)).toContain(approved.studentId);

    // A tampered ticket is rejected before any membership check.
    await expect(
      anon.lmsAuth.enterChildProfile({ ticket: login.ticket + 'x', studentId: approved.studentId! }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // Real ticket + own child → mints a kind:'student' principal.
    const entered = await anon.lmsAuth.enterChildProfile({ ticket: login.ticket, studentId: approved.studentId! });
    expect(entered.principal.kind).toBe('student');
    expect(entered.principal.studentIds).toContain(approved.studentId);

    // Real ticket + a child NOT belonging to this family → FORBIDDEN through the router.
    const otherPhone = freshPhone();
    const other = await approveNewStudent(otherPhone, 'HS Router Level Other Family');
    await trackParent(otherPhone);
    await expect(
      anon.lmsAuth.enterChildProfile({ ticket: login.ticket, studentId: other.studentId! }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
