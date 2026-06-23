import { prisma, withRls, verifyPassword, type RlsContext } from '@cmc/db';
import { signLmsSession, verifyLmsToken } from './jwt.js';

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
        guardians: { include: { student: { select: { id: true, fullName: true, facilityId: true } } } },
      },
    });
    if (!acc || !acc.isActive) return null;
    const students = acc.guardians.map((g) => g.student);
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
      include: { student: { select: { id: true, fullName: true, facilityId: true } } },
    });
    if (!acc || !acc.isActive) return null;
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

export async function loginParent(
  emailOrPhone: string,
  password: string,
): Promise<{ token: string; session: LmsSession } | null> {
  const acc = await withRls(SYSTEM_RLS, (tx) =>
    tx.parentAccount.findFirst({ where: { OR: [{ email: emailOrPhone }, { phone: emailOrPhone }] } }),
  );
  if (!acc || !acc.isActive) return null;
  if (!(await verifyPassword(password, acc.passwordHash))) return null;
  const resolved = await parentSession(acc.id);
  if (!resolved) return null;
  const token = await signLmsSession({ sub: acc.id, kind: 'parent', tokenVersion: acc.tokenVersion });
  return { token, session: strip(resolved) };
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
