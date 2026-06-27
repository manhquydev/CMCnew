import { TRPCError } from '@trpc/server';

// In-process fixed-window rate limiter for login endpoints.
//
// Topology note: the deployment is single-instance (one api container; SSE fan-out is also
// in-process via EventEmitter). An in-memory counter is therefore exactly as accurate as a
// Redis-backed one would be, with zero new dependency/outage surface (YAGNI). The day a second
// api replica is added, BOTH this limiter and SSE must move to a shared backend (the declared-
// but-unused REDIS_URL) together — that is the single correct trigger, not before.
//
// Only the app layer sees the login identifier (email/phone/loginCode), so per-account throttling
// lives here rather than in nginx. nginx may add a coarse per-IP backstop as defense-in-depth.
//
// IMPORTANT: only FAILED attempts increment the counters (recordLoginFailure), and a success
// clears the per-identifier bucket. This keeps a shared-NAT public IP (a tuition center where many
// parents/students sign in from one office Wi-Fi) from locking itself out on legitimate logins,
// while still throttling brute-force / credential-stuffing, which is all failures.

type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();

// Per (IP + identifier): targeted brute-force throttle.
const PAIR_LIMIT = Number(process.env.LOGIN_RATE_PAIR_LIMIT ?? 5);
// Per IP: credential-stuffing / enumeration throttle across many accounts from one source.
const IP_LIMIT = Number(process.env.LOGIN_RATE_IP_LIMIT ?? 20);
const WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS ?? 15 * 60_000);

let lastSweep = 0;

// Opportunistic GC: drop expired buckets so the Map cannot grow unbounded under attack.
function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}

// True if the bucket is currently at/over its limit within the active window.
function isOver(key: string, limit: number, now: number): boolean {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) return false;
  return b.count >= limit;
}

// Increment a bucket's failure count, starting a fresh window if needed.
function bump(key: string, now: number): void {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count++;
}

const pairKey = (ip: string, id: string) => `login:${ip}:${id.trim().toLowerCase()}`;
const ipKey = (ip: string) => `login:ip:${ip}`;

/**
 * Throttle a login attempt. Call BEFORE checking credentials. Throws TOO_MANY_REQUESTS once
 * either the per-(IP+identifier) or the per-IP failure window is already exhausted. Does NOT
 * increment — only failures count, recorded via recordLoginFailure().
 */
export function checkLoginLimit(ip: string, identifier: string): void {
  const now = Date.now();
  sweep(now);
  if (isOver(pairKey(ip, identifier), PAIR_LIMIT, now) || isOver(ipKey(ip), IP_LIMIT, now)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau ít phút.',
    });
  }
}

/** Record a failed login: increments both the per-(IP+identifier) and per-IP failure counters. */
export function recordLoginFailure(ip: string, identifier: string): void {
  const now = Date.now();
  bump(pairKey(ip, identifier), now);
  bump(ipKey(ip), now);
}

/** Reset the per-(IP+identifier) counter after a successful login so a valid user is never locked. */
export function clearLoginLimit(ip: string, identifier: string): void {
  buckets.delete(pairKey(ip, identifier));
}

/**
 * Generic fixed-window throttle for non-login endpoints (e.g. password-reset requests). Unlike the
 * login limiter, EVERY call counts — there is no "success clears it" notion. Throws once the window
 * is exhausted (window = the shared LOGIN_RATE_WINDOW_MS). Pass a stable bucket key (e.g.
 * `pwreset:<ip>` and/or `pwreset:<email>`).
 */
export function throttle(bucketKey: string, limit: number): void {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(bucketKey);
  if (b && now <= b.resetAt && b.count >= limit) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.',
    });
  }
  bump(bucketKey, now);
}

/** Test-only: wipe all counters between cases. */
export function __resetRateLimitStore(): void {
  buckets.clear();
  lastSweep = 0;
}
