import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveSession, resolveLmsSession, type RequestSession, type LmsSession } from '@cmc/auth';

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? 'cmc.session';
// LMS (parent/student) sessions use a distinct cookie so the two identity domains never collide.
export const LMS_COOKIE_NAME = process.env.LMS_COOKIE_NAME ?? 'cmc.lms';

export interface ApiContext {
  c: Context;
  session: RequestSession | null;
  lms: LmsSession | null;
  ip: string;
}

export async function createContext(c: Context): Promise<ApiContext> {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  const lmsToken = getCookie(c, LMS_COOKIE_NAME);
  const lms = lmsToken ? await resolveLmsSession(lmsToken) : null;
  // Client IP from X-Real-IP, which nginx sets to $remote_addr (the real peer) and the client
  // cannot forge. Do NOT use X-Forwarded-For[0]: nginx APPENDS via $proxy_add_x_forwarded_for, so
  // the leftmost token is attacker-controlled and would let an attacker rotate it to defeat the
  // login rate limiter. Falls back to the LAST XFF element (the hop nginx appended) then 'unknown'.
  const xff = c.req.header('x-forwarded-for');
  const xffLast = xff ? xff.split(',').pop()?.trim() : undefined;
  const ip = c.req.header('x-real-ip')?.trim() || xffLast || 'unknown';
  return { c, session, lms, ip };
}
