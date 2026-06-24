import { Role, type RequestSession, type LmsSession } from '@cmc/auth';
import { prisma, withRls } from '@cmc/db';
import { appRouter } from '../src/routers/index.js';
import type { ApiContext } from '../src/context.js';

/** super-admin RLS context — used for test fixture setup (bypasses RLS). */
export const SUPER = { facilityIds: [] as number[], isSuperAdmin: true };

/** A real app_user id to use as actorId in audit writes (FK-valid). Resolved once. */
let superUserId: string | null = null;
export async function superAdminUserId(): Promise<string> {
  if (superUserId) return superUserId;
  const u = await withRls(SUPER, (tx) =>
    tx.appUser.findFirst({ where: { isActive: true }, select: { id: true } }),
  );
  if (!u) throw new Error('No app_user seeded — run pnpm db:seed first');
  superUserId = u.id;
  return u.id;
}

/** Build a staff session. Defaults to super_admin; pass overrides to scope a facility / drop roles. */
export async function staffSession(over: Partial<RequestSession> = {}): Promise<RequestSession> {
  const userId = over.userId ?? (await superAdminUserId());
  return {
    userId,
    displayName: 'test',
    roles: [],
    primaryRole: Role.super_admin,
    isSuperAdmin: true,
    facilityIds: [],
    ...over,
  };
}

/** tRPC caller for a staff session (super-admin by default). */
export async function staffCaller(over: Partial<RequestSession> = {}) {
  const session = await staffSession(over);
  const ctx: ApiContext = { c: {} as never, session, lms: null };
  return appRouter.createCaller(ctx);
}

/** tRPC caller for an LMS (parent/student) principal. */
export function lmsCaller(lms: LmsSession) {
  const ctx: ApiContext = { c: {} as never, session: null, lms };
  return appRouter.createCaller(ctx);
}

/** A unique suffix so parallel/re-run fixtures never collide. */
export function uniq(prefix: string): string {
  return `${prefix}_${process.pid}_${Math.floor(performance.now())}`;
}

export { prisma, withRls };
