import { withRls, verifyPassword, type RlsContext, type StudentLifecycle } from '@cmc/db';
import { signLmsSession, verifyLmsToken } from './jwt.js';

/** Lifecycle states that revoke LMS access. `completed` intentionally excluded — those students
 * still read transcripts/certificates. `active`/`admitted` are unaffected (normal access). */
export const BLOCKED_LMS_LIFECYCLE = new Set<StudentLifecycle>(['on_hold', 'withdrawn', 'transferred']);

/** Fully-resolved LMS identity (parent or student) for the current request. */
export interface LmsSession {
  kind: 'parent' | 'student';
  accountId: string;
  displayName: string;
  /** Students this principal owns: a parent's guardianed children, or a student themselves. */
  students: { id: string; fullName: string }[];
  /** Ids only — convenience for RLS context + client lookups. Mirror of students.map(id). */
  studentIds: string[];
  /** Distinct facilities of those students — the tenant scope for facility-only tables. */
  facilityIds: number[];
}

/** RLS context for an LMS principal: facility scope + ownership scope. */
export function lmsRlsContextOf(s: LmsSession): RlsContext {
  return {
    facilityIds: s.facilityIds,
    isSuperAdmin: false,
    principalKind: s.kind,
    studentIds: s.studentIds,
    accountId: s.accountId,
  };
}

// Identity resolution is trusted system code → reads under a super-admin RLS context
// (parent_account/student_account are RLS-locked to super_admin; guardian/student are
// facility-scoped). This mirrors the staff auth path.
const SYSTEM_RLS: RlsContext = { facilityIds: [], isSuperAdmin: true };

type ResolvedLms = LmsSession & { _tokenVersion: number };

async function parentSession(accountId: string): Promise<ResolvedLms | null> {
  return withRls(SYSTEM_RLS, async (tx) => {
    const acc = await tx.parentAccount.findUnique({
      where: { id: accountId },
      include: {
        guardians: {
          include: { student: { select: { id: true, fullName: true, facilityId: true, lifecycle: true } } },
        },
      },
    });
    if (!acc || !acc.isActive) return null;
    // Per-child filter, not whole-session reject: a parent with any non-blocked child must still
    // log in. Only when EVERY child is blocked does the session resolve with zero accessible children.
    const students = acc.guardians
      .map((g) => g.student)
      .filter((s) => !BLOCKED_LMS_LIFECYCLE.has(s.lifecycle));
    return {
      kind: 'parent' as const,
      accountId: acc.id,
      displayName: acc.displayName,
      students: students.map((s) => ({ id: s.id, fullName: s.fullName })),
      studentIds: students.map((s) => s.id),
      facilityIds: [...new Set(students.map((s) => s.facilityId))],
      _tokenVersion: acc.tokenVersion,
    };
  });
}

async function studentSession(accountId: string): Promise<ResolvedLms | null> {
  return withRls(SYSTEM_RLS, async (tx) => {
    const acc = await tx.studentAccount.findUnique({
      where: { id: accountId },
      include: { student: { select: { id: true, fullName: true, facilityId: true, lifecycle: true } } },
    });
    if (!acc || !acc.isActive) return null;
    if (BLOCKED_LMS_LIFECYCLE.has(acc.student.lifecycle)) return null;
    return {
      kind: 'student' as const,
      accountId: acc.id,
      displayName: acc.student.fullName,
      students: [{ id: acc.student.id, fullName: acc.student.fullName }],
      studentIds: [acc.student.id],
      facilityIds: [acc.student.facilityId],
      _tokenVersion: acc.tokenVersion,
    };
  });
}

function strip(s: ResolvedLms): LmsSession {
  const { _tokenVersion: _t, ...rest } = s;
  return rest;
}

export async function loginStudent(
  loginCode: string,
  password: string,
): Promise<{ token: string; session: LmsSession } | null> {
  const acc = await withRls(SYSTEM_RLS, (tx) => tx.studentAccount.findUnique({ where: { loginCode } }));
  if (!acc || !acc.isActive) return null;
  if (!(await verifyPassword(password, acc.passwordHash))) return null;
  const resolved = await studentSession(acc.id);
  if (!resolved) return null;
  const token = await signLmsSession({ sub: acc.id, kind: 'student', tokenVersion: acc.tokenVersion });
  return { token, session: strip(resolved) };
}

/**
 * Mint a parent session by accountId WITHOUT a password — used by passwordless flows (Email OTP).
 * The caller is responsible for having authenticated the parent (e.g. a verified OTP).
 */
export async function mintParentSession(
  accountId: string,
): Promise<{ token: string; session: LmsSession } | null> {
  const resolved = await parentSession(accountId);
  if (!resolved) return null;
  const token = await signLmsSession({ sub: accountId, kind: 'parent', tokenVersion: resolved._tokenVersion });
  return { token, session: strip(resolved) };
}

/** Verify an LMS JWT and re-check it against live DB state (active + tokenVersion). */
export async function resolveLmsSession(token: string): Promise<LmsSession | null> {
  const claims = await verifyLmsToken(token);
  if (!claims) return null;
  const resolved =
    claims.kind === 'parent' ? await parentSession(claims.sub) : await studentSession(claims.sub);
  if (!resolved) return null;
  if (resolved._tokenVersion !== claims.tokenVersion) return null;
  return strip(resolved);
}
