import { initTRPC, TRPCError } from '@trpc/server';
import { Role, type RequestSession, type LmsSession } from '@cmc/auth';
import type { ApiContext } from './context.js';

const t = initTRPC.context<ApiContext>().create({
  // Never leak stack traces / absolute paths to clients, regardless of NODE_ENV.
  errorFormatter({ shape }) {
    const { stack: _stack, ...data } = shape.data as Record<string, unknown>;
    return { ...shape, data };
  },
});

/** A row-level-security denial from Postgres: a write that violates a policy's WITH CHECK
 * (cross-facility / cross-principal) surfaces as SQLSTATE 42501 (insufficient_privilege).
 * Reads under RLS just return no rows, so only the write path raises here. */
function isRlsDenial(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const c = cause as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  const code = c.code ?? c.meta?.code;
  const msg = String(c.message ?? '');
  return code === '42501' || /row-level security|insufficient_privilege/i.test(msg);
}

/** Turn a raw RLS denial into a clean FORBIDDEN instead of a generic 500. Applied to every
 * procedure so any tenant-isolation violation answers consistently. */
const mapRlsErrors = t.middleware(async ({ next }) => {
  const res = await next();
  if (!res.ok && isRlsDenial(res.error.cause)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Không có quyền trên tài nguyên này',
      cause: res.error.cause,
    });
  }
  return res;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(mapRlsErrors);

/** Requires a valid session; narrows ctx.session to non-null. */
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, session: ctx.session as RequestSession } });
});

/** super_admin only. */
export const superAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

/** Require any of the given roles (super_admin always passes). */
export function requireRole(...roles: Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (ctx.session.isSuperAdmin) return next();
    if (!roles.some((r) => ctx.session.roles.includes(r))) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
  });
}

/** Requires a valid LMS (parent/student) session; narrows ctx.lms to non-null. */
export const lmsProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.lms) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, lms: ctx.lms as LmsSession } });
});

/** Parent-only. */
export const parentProcedure = lmsProcedure.use(({ ctx, next }) => {
  if (ctx.lms.kind !== 'parent') throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

/** Student-only. */
export const studentProcedure = lmsProcedure.use(({ ctx, next }) => {
  if (ctx.lms.kind !== 'student') throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});

export { Role };
