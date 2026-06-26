import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { login, type RequestSession } from '@cmc/auth';
import { withRls, hashPassword } from '@cmc/db';
import { logEvent } from '@cmc/audit';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { COOKIE_NAME } from '../context.js';
import { checkLoginLimit, clearLoginLimit, recordLoginFailure, throttle } from '../rate-limit.js';
import { issueActivation, verifyToken, consumeToken } from '../services/account-activation.js';

/** No session on these public flows → run under super-bypass to read/write identity + token rows. */
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };
const RESET_REQUEST_LIMIT = Number(process.env.PWRESET_RATE_LIMIT ?? 5);

function publicUser(s: RequestSession) {
  return {
    userId: s.userId,
    displayName: s.displayName,
    roles: s.roles,
    primaryRole: s.primaryRole,
    isSuperAdmin: s.isSuperAdmin,
    facilityIds: s.facilityIds,
  };
}

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.email);
      const result = await login(input.email, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.email);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai email hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.email);
      setCookie(ctx.c, COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 12,
        // Default secure everywhere; opt out only in local dev over HTTP via COOKIE_SECURE=false.
        secure: process.env.COOKIE_SECURE !== 'false',
      });
      return { user: publicUser(result.session) };
    }),

  me: publicProcedure.query(({ ctx }) => (ctx.session ? publicUser(ctx.session) : null)),

  logout: protectedProcedure.mutation(({ ctx }) => {
    deleteCookie(ctx.c, COOKIE_NAME, { path: '/' });
    return { ok: true };
  }),

  // ── Staff password reset (email-delivered, single-use token) ──────────────────────────────────
  // Always returns ok regardless of whether the email matched: no account enumeration.
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      throttle(`pwreset:ip:${ctx.ip}`, RESET_REQUEST_LIMIT);
      throttle(`pwreset:em:${input.email.toLowerCase()}`, RESET_REQUEST_LIMIT);
      await withRls(SYSTEM_CTX, async (tx) => {
        const user = await tx.appUser.findFirst({
          where: { email: input.email, isActive: true },
          select: { id: true, email: true, displayName: true },
        });
        if (!user) return; // silent: same response as the found case
        await issueActivation(tx, {
          kind: 'password_reset',
          subjectType: 'staff',
          subjectId: user.id,
          email: user.email,
          name: user.displayName,
          dedupKey: `pwreset:staff:${user.id}:${Date.now()}`,
        });
      });
      return { ok: true };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8) }))
    .mutation(async ({ input }) => {
      await withRls(SYSTEM_CTX, async (tx) => {
        const verified = await verifyToken(tx, input.token, ['password_reset']);
        if (!verified || verified.subjectType !== 'staff') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Liên kết không hợp lệ hoặc đã hết hạn' });
        }
        await tx.appUser.update({
          where: { id: verified.subjectId },
          data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
        });
        await consumeToken(tx, verified.id);
        await logEvent(tx, {
          entityType: 'user',
          entityId: verified.subjectId,
          type: 'status_changed',
          body: 'Đặt lại mật khẩu qua email',
          actorId: null,
        });
      });
      return { ok: true };
    }),

  // ── Staff account activation (onboarding: set initial password via emailed link) ──────────────
  activateVerify: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) =>
      withRls(SYSTEM_CTX, async (tx) => {
        const v = await verifyToken(tx, input.token, ['staff_account']);
        if (!v || v.subjectType !== 'staff') return { valid: false as const };
        const user = await tx.appUser.findUnique({ where: { id: v.subjectId }, select: { displayName: true } });
        return { valid: true as const, displayName: user?.displayName ?? null };
      }),
    ),

  activateSetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8) }))
    .mutation(async ({ input }) => {
      await withRls(SYSTEM_CTX, async (tx) => {
        const v = await verifyToken(tx, input.token, ['staff_account']);
        if (!v || v.subjectType !== 'staff') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Liên kết không hợp lệ hoặc đã hết hạn' });
        }
        await tx.appUser.update({
          where: { id: v.subjectId },
          data: { passwordHash: await hashPassword(input.newPassword), isActive: true, tokenVersion: { increment: 1 } },
        });
        await consumeToken(tx, v.id);
      });
      return { ok: true };
    }),
});
