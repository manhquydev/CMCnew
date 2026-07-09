import { Role, prisma, withRls, verifyPassword, type RlsContext } from '@cmc/db';
import { signSession, verifySession, type SessionClaims } from './jwt.js';

export { signSession, verifySession } from './jwt.js';
export type { SessionClaims } from './jwt.js';
export {
  loginStudent,
  mintParentSession,
  resolveLmsSession,
  lmsRlsContextOf,
  BLOCKED_LMS_LIFECYCLE,
  loginFamilyByPhone,
  verifyChildSelectionTicket,
  mintStudentSessionForStudent,
  type LmsSession,
  type EnterChildProfileResult,
} from './lms.js';
export { normalizeLoginPhone, normalizeContactPhone, DEFAULT_STUDENT_PASSWORD } from './login-phone.js';
export { Role } from '@cmc/db';
export {
  PERMISSIONS,
  can,
  DIRECTOR_ROLE_GRANTS,
  assignableRoles,
  canReadSensitiveHr,
  maskSensitive,
  isMaskedPlaceholder,
} from './permissions.js';

/** Fully-resolved identity for the current request. */
export interface RequestSession {
  userId: string;
  displayName: string;
  roles: Role[];
  primaryRole: Role;
  isSuperAdmin: boolean;
  facilityIds: number[];
}

/** RLS context derived from a resolved session. */
export function rlsContextOf(session: RequestSession): RlsContext {
  return { facilityIds: session.facilityIds, isSuperAdmin: session.isSuperAdmin };
}

// Identity resolution is trusted system code, so it reads under a super-admin RLS
// context (the user_facility table is itself RLS-protected).
const SYSTEM_RLS: RlsContext = { facilityIds: [], isSuperAdmin: true };

// Fixed bcrypt hash (rounds=10, matching @cmc/db's hashPassword cost) with no corresponding
// plaintext password. Used to run a dummy verifyPassword compare when the account lookup misses
// or is inactive, so the login response time does not reveal account existence (timing
// side-channel — the missing/inactive branch previously returned before ever hashing).
const DUMMY_PASSWORD_HASH = '$2a$10$6Btm02e12.9hB30BD5ZLZOjmmS1ht2tY2kma8SoaLj4RXn4y5W7Wa';

function toSession(user: {
  id: string;
  displayName: string;
  roles: Role[];
  primaryRole: Role;
  facilities: { facilityId: number }[];
}): RequestSession {
  return {
    userId: user.id,
    displayName: user.displayName,
    roles: user.roles,
    primaryRole: user.primaryRole,
    isSuperAdmin: user.roles.includes(Role.super_admin),
    facilityIds: user.facilities.map((f) => f.facilityId),
  };
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; session: RequestSession } | null> {
  const user = await withRls(SYSTEM_RLS, (tx) =>
    tx.appUser.findUnique({ where: { email }, include: { facilities: true } }),
  );
  if (!user || !user.isActive) {
    // Run a dummy compare so this branch's latency matches the "account exists, wrong
    // password" branch below — otherwise the two are distinguishable by timing alone.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;

  const claims: SessionClaims = {
    sub: user.id,
    roles: user.roles,
    primaryRole: user.primaryRole,
    tokenVersion: user.tokenVersion,
  };
  return { token: await signSession(claims), session: toSession(user) };
}

/**
 * Mint a staff session by email WITHOUT a password — used after an external IdP (Microsoft SSO) has
 * already authenticated the user. Returns null if no active AppUser matches (admin must pre-provision;
 * SSO never auto-creates accounts). The caller is responsible for trusting the email's origin.
 */
export async function mintStaffSession(
  email: string,
): Promise<{ token: string; session: RequestSession } | null> {
  const user = await withRls(SYSTEM_RLS, (tx) =>
    tx.appUser.findUnique({ where: { email }, include: { facilities: true } }),
  );
  if (!user || !user.isActive) return null;
  const claims: SessionClaims = {
    sub: user.id,
    roles: user.roles,
    primaryRole: user.primaryRole,
    tokenVersion: user.tokenVersion,
  };
  return { token: await signSession(claims), session: toSession(user) };
}

/** Verify a JWT and re-check it against live DB state (active + tokenVersion). */
export async function resolveSession(token: string): Promise<RequestSession | null> {
  const claims = await verifySession(token);
  if (!claims) return null;
  const user = await withRls(SYSTEM_RLS, (tx) =>
    tx.appUser.findUnique({ where: { id: claims.sub }, include: { facilities: true } }),
  );
  if (!user || !user.isActive) return null;
  if (user.tokenVersion !== claims.tokenVersion) return null;
  return toSession(user);
}

export { prisma, withRls };
