import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { resolveSession, type RequestSession } from '@cmc/auth';

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? 'cmc.session';

export interface ApiContext {
  c: Context;
  session: RequestSession | null;
}

export async function createContext(c: Context): Promise<ApiContext> {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  return { c, session };
}
