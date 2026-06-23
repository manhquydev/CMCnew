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
}

export async function createContext(c: Context): Promise<ApiContext> {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  const lmsToken = getCookie(c, LMS_COOKIE_NAME);
  const lms = lmsToken ? await resolveLmsSession(lmsToken) : null;
  return { c, session, lms };
}
