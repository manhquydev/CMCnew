import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { loginParent, loginStudent, mintParentSession, type LmsSession } from '@cmc/auth';
import { withRls, hashPassword } from '@cmc/db';
import { router, publicProcedure, lmsProcedure } from '../trpc.js';
import { LMS_COOKIE_NAME } from '../context.js';
import { checkLoginLimit, clearLoginLimit, recordLoginFailure, throttle } from '../rate-limit.js';
import { issueActivation, verifyToken, consumeToken } from '../services/account-activation.js';
import { requestLoginOtp, verifyLoginOtp } from '../services/login-otp.js';

const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };
const RESET_REQUEST_LIMIT = Number(process.env.PWRESET_RATE_LIMIT ?? 5);
const OTP_REQUEST_LIMIT = Number(process.env.OTP_RATE_LIMIT ?? 5);

function publicLms(s: LmsSession) {
  return {
    kind: s.kind,
    accountId: s.accountId,
    displayName: s.displayName,
    students: s.students,
    studentIds: s.studentIds,
    facilityIds: s.facilityIds,
  };
}

function setLmsCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, LMS_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,
    // Default secure everywhere; opt out only in local dev over HTTP via COOKIE_SECURE=false.
    secure: process.env.COOKIE_SECURE !== 'false',
  });
}

// LMS sign-in for parents and students (separate identity domain from staff AppUser).
export const lmsAuthRouter = router({
  loginParent: publicProcedure
    .input(z.object({ emailOrPhone: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.emailOrPhone);
      const result = await loginParent(input.emailOrPhone, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.emailOrPhone);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai tài khoản hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.emailOrPhone);
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  loginStudent: publicProcedure
    .input(z.object({ loginCode: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      checkLoginLimit(ctx.ip, input.loginCode);
      const result = await loginStudent(input.loginCode, input.password);
      if (!result) {
        recordLoginFailure(ctx.ip, input.loginCode);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sai mã hoặc mật khẩu' });
      }
      clearLoginLimit(ctx.ip, input.loginCode);
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  // ── Parent passwordless login via Email OTP (R3) ──────────────────────────────────────────────
  // Request a 6-digit code emailed via Graph. Always returns ok (no account enumeration). In dev
  // with Graph unconfigured, the code is returned in `devCode` so the flow is testable pre-secret.
  otpRequest: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      throttle(`otp:ip:${ctx.ip}`, OTP_REQUEST_LIMIT);
      throttle(`otp:em:${input.email.toLowerCase()}`, OTP_REQUEST_LIMIT);
      const { devCode } = await requestLoginOtp(input.email);
      return { ok: true as const, ...(devCode ? { devCode } : {}) };
    }),

  otpVerify: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      throttle(`otpv:ip:${ctx.ip}`, OTP_REQUEST_LIMIT * 4);
      const accountId = await verifyLoginOtp(input.email, input.code);
      if (!accountId) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Mã không đúng hoặc đã hết hạn' });
      const result = await mintParentSession(accountId);
      if (!result) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tài khoản không khả dụng' });
      setLmsCookie(ctx.c, result.token);
      return { principal: publicLms(result.session) };
    }),

  me: publicProcedure.query(({ ctx }) => (ctx.lms ? publicLms(ctx.lms) : null)),

  logout: lmsProcedure.mutation(({ ctx }) => {
    deleteCookie(ctx.c, LMS_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }),

  // ── Parent password reset (email only; phone-only parents reset via staff) ────────────────────
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      throttle(`pwreset:ip:${ctx.ip}`, RESET_REQUEST_LIMIT);
      throttle(`pwreset:em:${input.email.toLowerCase()}`, RESET_REQUEST_LIMIT);
      await withRls(SYSTEM_CTX, async (tx) => {
        const parent = await tx.parentAccount.findFirst({
          where: { email: input.email, isActive: true },
          select: { id: true, email: true, displayName: true },
        });
        if (!parent?.email) return; // silent, no enumeration
        await issueActivation(tx, {
          kind: 'password_reset',
          subjectType: 'parent',
          subjectId: parent.id,
          email: parent.email,
          name: parent.displayName,
          dedupKey: `pwreset:parent:${parent.id}:${Date.now()}`,
        });
      });
      return { ok: true };
    }),

  resetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8) }))
    .mutation(async ({ input }) => {
      await withRls(SYSTEM_CTX, async (tx) => {
        const v = await verifyToken(tx, input.token, ['password_reset']);
        if (!v || v.subjectType !== 'parent') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Liên kết không hợp lệ hoặc đã hết hạn' });
        }
        await tx.parentAccount.update({
          where: { id: v.subjectId },
          data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
        });
        await consumeToken(tx, v.id);
      });
      return { ok: true };
    }),

  // ── Parent account activation (welcome → set initial password) ────────────────────────────────
  activateVerify: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) =>
      withRls(SYSTEM_CTX, async (tx) => {
        const v = await verifyToken(tx, input.token, ['parent_account']);
        if (!v || v.subjectType !== 'parent') return { valid: false as const };
        const p = await tx.parentAccount.findUnique({ where: { id: v.subjectId }, select: { displayName: true } });
        return { valid: true as const, displayName: p?.displayName ?? null };
      }),
    ),

  activateSetPassword: publicProcedure
    .input(z.object({ token: z.string().min(1), newPassword: z.string().min(8) }))
    .mutation(async ({ input }) => {
      await withRls(SYSTEM_CTX, async (tx) => {
        const v = await verifyToken(tx, input.token, ['parent_account']);
        if (!v || v.subjectType !== 'parent') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Liên kết không hợp lệ hoặc đã hết hạn' });
        }
        await tx.parentAccount.update({
          where: { id: v.subjectId },
          data: { passwordHash: await hashPassword(input.newPassword), isActive: true, tokenVersion: { increment: 1 } },
        });
        await consumeToken(tx, v.id);
      });
      return { ok: true };
    }),
});
