import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '../../.env') });

import cron from 'node-cron';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { trpcServer } from '@hono/trpc-server';
import { resolveLmsSession, resolveSession, rlsContextOf, lmsRlsContextOf, mintStaffSession } from '@cmc/auth';
import { ssoConfigFromEnv, buildAuthUrl, redeemCode } from './lib/sso.js';
import { withRls } from '@cmc/db';
import { appRouter } from './routers/index.js';
import { createContext, COOKIE_NAME, LMS_COOKIE_NAME } from './context.js';
import { onNotification } from './events.js';
import { onStaffNotification } from './staff-notification.js';
import { putPdf, readPdf, pdfExists, PdfStoreError, MAX_PDF_BYTES } from './services/pdf-store.js';
import { renderReceiptHtml } from './services/receipt-html.js';
import { runParentMeetingReminders } from './services/parent-meeting-reminder.js';
import { generateParentMeetings } from './services/parent-meeting-cadence.js';
import { renderCertificateHtml } from './services/certificate-html.js';
import { runEmailOutbox } from './services/email-outbox.js';

const app = new Hono();

// Allowed origins from env (comma-separated); defaults to the dev Vite ports.
// credentials:true so the session cookie flows. In production, set CORS_ORIGINS.
// In production the allowlist MUST be set explicitly — falling back to localhost origins would
// silently disable the cross-origin defense that SameSite:Lax cookies rely on.
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS) {
  throw new Error('CORS_ORIGINS must be set explicitly in production');
}
const corsOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use('*', cors({ origin: corsOrigins, credentials: true }));

// Health + deploy marker: `commit`/`builtAt` come from env injected at deploy
// time (Jenkins passes the git SHA + build time); default 'unknown' locally so
// the response is additive and the deploy smoke check stays a plain 200.
app.get('/health', (c) =>
  c.json({
    ok: true,
    commit: process.env.APP_COMMIT ?? 'unknown',
    builtAt: process.env.APP_BUILT_AT ?? 'unknown',
  }),
);

// ── Exercise base-PDF storage (S1.7) ───────────────────────────────────────────────────────
// Upload: staff only (a teacher attaches the base PDF when creating an exercise). Raw PDF body.
// Returns the content-address ref to store in exercise.basePdfRef.
app.post('/upload/exercise-pdf', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  if (!session) return c.text('unauthorized', 401);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_PDF_BYTES) return c.text('file too large', 413);
  try {
    const ref = await putPdf(Buffer.from(body));
    return c.json({ ref });
  } catch (e) {
    if (e instanceof PdfStoreError) return c.text(e.message, 400);
    throw e;
  }
});

// Serve: per-principal access. Authorization reuses the exercise RLS policy as the single source
// of truth — staff see their facility's exercises, a parent/student only exercises in a class their
// owned student is enrolled in. We look for an RLS-visible exercise that uses this base PDF; if none
// is visible the principal may not see it. Authorization is checked BEFORE existence on disk so the
// endpoint never reveals whether a ref exists to a principal who is not entitled to it.
app.get('/files/exercise/:ref', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const lmsTok = getCookie(c, LMS_COOKIE_NAME);
  const staff = staffTok ? await resolveSession(staffTok) : null;
  const lms = !staff && lmsTok ? await resolveLmsSession(lmsTok) : null;
  if (!staff && !lms) return c.text('unauthorized', 401);

  const ref = c.req.param('ref');
  const rlsCtx = staff ? rlsContextOf(staff) : lmsRlsContextOf(lms!);
  const visible = await withRls(rlsCtx, (tx) =>
    tx.exercise.findFirst({ where: { basePdfRef: ref, archivedAt: null }, select: { id: true } }),
  );
  if (!visible) return c.text('forbidden', 403);

  if (!(await pdfExists(ref))) return c.text('not found', 404);
  try {
    const buf = await readPdf(ref);
    c.header('Content-Type', 'application/pdf');
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(buf as unknown as ArrayBuffer);
  } catch {
    return c.text('not found', 404);
  }
});

// Printable receipt (phiếu thu) — staff only, authorized via the receipt's RLS policy
// (a receipt is visible only to staff of its facility). Returns styled HTML for print-to-PDF.
app.get('/files/receipt/:id', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const staff = staffTok ? await resolveSession(staffTok) : null;
  if (!staff) return c.text('unauthorized', 401);

  const id = c.req.param('id');
  const data = await withRls(rlsContextOf(staff), async (tx) => {
    const r = await tx.receipt.findUnique({ where: { id } });
    if (!r) return null;
    const [student, course, facility] = await Promise.all([
      r.studentId ? tx.student.findUnique({ where: { id: r.studentId }, select: { fullName: true, studentCode: true } }) : Promise.resolve(null),
      tx.course.findUnique({ where: { id: r.courseId }, select: { code: true, name: true } }),
      tx.facility.findUnique({ where: { id: r.facilityId }, select: { name: true } }),
    ]);
    return { r, student, course, facility };
  });
  if (!data) return c.text('forbidden', 403); // RLS-invisible or missing — don't distinguish

  const { r, student, course, facility } = data;
  const html = renderReceiptHtml({
    code: r.code,
    facilityName: facility?.name ?? '',
    studentName: student ? `${student.fullName} (${student.studentCode})` : (r.studentId ? r.studentId.slice(0, 8) : '—'),
    courseLabel: course ? `${course.code} — ${course.name}` : r.courseId.slice(0, 8),
    period: r.period,
    yearsPrepaid: r.yearsPrepaid,
    annualPrice: r.annualPrice,
    grossAmount: r.grossAmount,
    tierPercent: r.tierPercent,
    voucherPercent: r.voucherPercent,
    effectiveDiscountPercent: r.effectiveDiscountPercent,
    netAmount: r.netAmount,
    status: r.status,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
  });
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.html(html);
});

// Printable certificate (chứng chỉ) — staff only, authorized via the certificate RLS policy.
app.get('/files/certificate/:id', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const staff = staffTok ? await resolveSession(staffTok) : null;
  if (!staff) return c.text('unauthorized', 401);

  const id = c.req.param('id');
  const data = await withRls(rlsContextOf(staff), async (tx) => {
    const cert = await tx.certificate.findUnique({ where: { id } });
    if (!cert) return null;
    const [student, facility] = await Promise.all([
      tx.student.findUnique({ where: { id: cert.studentId }, select: { fullName: true } }),
      tx.facility.findUnique({ where: { id: cert.facilityId }, select: { name: true } }),
    ]);
    return { cert, student, facility };
  });
  if (!data) return c.text('forbidden', 403);

  const { cert, student, facility } = data;
  const html = renderCertificateHtml({
    id: cert.id,
    facilityName: facility?.name ?? '',
    studentName: student?.fullName ?? cert.studentId.slice(0, 8),
    program: cert.program,
    level: cert.level,
    title: cert.title,
    issuedAt: cert.issuedAt,
  });
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.html(html);
});

// Realtime notifications for LMS principals (parent/student). The connection is authenticated
// by the LMS session cookie; events are filtered to the principal's owned students, so a parent
// only ever receives their own children's alerts. A periodic comment keeps proxies from idling
// the stream out; the bus listener is removed on disconnect.
app.get('/sse/notifications', async (c) => {
  const token = getCookie(c, LMS_COOKIE_NAME);
  const lms = token ? await resolveLmsSession(token) : null;
  if (!lms) return c.text('unauthorized', 401);
  let ownedIds = new Set(lms.studentIds);

  return streamSSE(c, async (stream) => {
    const unsubscribe = onNotification((evt) => {
      if (!ownedIds.has(evt.studentId)) return;
      void stream.writeSSE({ event: 'notification', data: JSON.stringify(evt.notification) });
    });
    stream.onAbort(unsubscribe);

    await stream.writeSSE({ event: 'ready', data: '1' });
    while (!stream.aborted) {
      await stream.sleep(25_000);
      if (stream.aborted) break;
      // Re-validate the LMS session every heartbeat (parity with /sse/staff): detects account
      // deactivation, token expiry, or a changed guardian→student link. Refresh ownedIds so a
      // revoked child stops receiving events without needing a reconnect.
      const refreshed = token ? await resolveLmsSession(token) : null;
      if (!refreshed || refreshed.accountId !== lms.accountId) {
        unsubscribe();
        break;
      }
      ownedIds = new Set(refreshed.studentIds);
      await stream.writeSSE({ event: 'ping', data: '1' });
    }
    unsubscribe();
  });
});

// Staff real-time notification stream. Authenticated via:
//   1. Bearer JWT in Authorization header (primary, for EventSource polyfills / fetch-based clients)
//   2. Staff session cookie (fallback, for native EventSource)
// Only events for the connected user's recipientId are forwarded.
app.get('/sse/staff', async (c) => {
  // Bearer takes precedence; fall back to cookie.
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = getCookie(c, COOKIE_NAME);
  const token = bearerToken ?? cookieToken;
  const staff = token ? await resolveSession(token) : null;
  if (!staff) return c.text('unauthorized', 401);

  const userId = staff.userId;

  return streamSSE(c, async (stream) => {
    const unsubscribe = onStaffNotification((evt) => {
      if (evt.recipientId !== userId) return;
      void stream.writeSSE({ event: 'staff_notification', data: JSON.stringify(evt.notification) });
    });
    stream.onAbort(unsubscribe);

    await stream.writeSSE({ event: 'ready', data: '1' });
    while (!stream.aborted) {
      await stream.sleep(25_000);
      if (stream.aborted) break;
      // Re-validate session on every heartbeat: detects forced logout, deactivation, token expiry.
      const refreshed = token ? await resolveSession(token) : null;
      if (!refreshed || refreshed.userId !== userId) {
        unsubscribe();
        break;
      }
      await stream.writeSSE({ event: 'ping', data: '1' });
    }
    unsubscribe();
  });
});

// ── Staff SSO via Microsoft Entra (OIDC authorization-code flow, R4) ───────────────────────────
// /auth/sso/login redirects to Microsoft; /auth/sso/callback redeems the code, matches an existing
// AppUser by org-domain email, and sets the normal staff session cookie. Microsoft passwords are
// never stored. Disabled (503) until ENTRA_CLIENT_SECRET is configured.
const SSO_TX_COOKIE = 'cmc.sso_tx';
const erpOrigin = () => process.env.ADMIN_APP_ORIGIN ?? 'http://localhost:5173';
const cookieSecure = () => process.env.COOKIE_SECURE !== 'false';

app.get('/auth/sso/login', async (c) => {
  const cfg = ssoConfigFromEnv();
  if (!cfg) return c.text('SSO chưa được cấu hình', 503);
  const { url, tx } = await buildAuthUrl(cfg);
  setCookie(c, SSO_TX_COOKIE, JSON.stringify(tx), {
    httpOnly: true,
    sameSite: 'Lax',
    // Path '/' (not '/auth/sso') so the cookie comes back on the callback even when the app is
    // served behind an nginx prefix: the browser sees /api/auth/sso/callback, which would not match
    // a '/auth/sso' cookie path → the tx cookie would be dropped and the state check would fail with
    // "Phiên đăng nhập hết hạn". It's httpOnly + short-lived (10 min) and only carries PKCE/CSRF state.
    path: '/',
    maxAge: 600, // 10 min to complete the round-trip
    secure: cookieSecure(),
  });
  return c.redirect(url);
});

app.get('/auth/sso/callback', async (c) => {
  const cfg = ssoConfigFromEnv();
  if (!cfg) return c.text('SSO chưa được cấu hình', 503);
  const fail = (reason: string) => c.redirect(`${erpOrigin()}/login?sso_error=${reason}`);

  if (c.req.query('error')) return fail('denied');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const raw = getCookie(c, SSO_TX_COOKIE);
  deleteCookie(c, SSO_TX_COOKIE, { path: '/' });
  if (!code || !state || !raw) return fail('state');

  let tx: { state: string; verifier: string };
  try {
    tx = JSON.parse(raw);
  } catch {
    return fail('state');
  }
  if (tx.state !== state) return fail('state'); // CSRF guard

  const email = await redeemCode(cfg, code, tx.verifier).catch(() => null);
  if (!email) return fail('domain'); // wrong tenant / non-org email / token invalid

  const result = await mintStaffSession(email);
  if (!result) return fail('not_provisioned'); // admin must pre-create the AppUser

  setCookie(c, COOKIE_NAME, result.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,
    secure: cookieSecure(),
  });
  return c.redirect(erpOrigin());
});

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) =>
      createContext(c) as unknown as Promise<Record<string, unknown>>,
  }),
);

const port = Number(process.env.API_PORT ?? 4000);
serve({ fetch: app.fetch, port });
console.log(`✓ CMCnew API on http://localhost:${port}`);

// Embedded reminder cron (docs/specs/parent-meeting.md): every 30 min, remind parents of
// meetings within T-1 day. Idempotent via parent_meeting.remindedAt — re-ticks never double-send.
// Set DISABLE_CRON=1 in tests/CI to keep the process side-effect-free.
if (process.env.DISABLE_CRON !== '1') {
  cron.schedule('*/30 * * * *', () => {
    runParentMeetingReminders()
      .then((r) => {
        if (r.meetingsReminded) console.log(`↳ parent-meeting reminders: ${r.meetingsReminded} meetings → ${r.notificationsCreated} notifications`);
      })
      .catch((e) => console.error('parent-meeting reminder tick failed', e));
  });

  // Auto-cadence generation (charter §4): daily at 02:00, generate per-program meetings for running
  // classes. Idempotent via the (classBatchId, scheduledAt) unique constraint — re-ticks add nothing new.
  cron.schedule('0 2 * * *', () => {
    generateParentMeetings()
      .then((r) => {
        if (r.meetingsCreated) console.log(`↳ parent-meeting cadence: +${r.meetingsCreated} meetings across ${r.classesScanned} running classes`);
      })
      .catch((e) => console.error('parent-meeting cadence tick failed', e));
  });

  // Email outbox drain (decision: email-graph-integration): every minute, send up to 20 queued
  // emails via Microsoft Graph (rate-limited under Exchange's 30/min cap). No-op when GRAPH_* env is
  // unset — rows stay queued until the tenant is configured, so this is safe to run in production.
  cron.schedule('* * * * *', () => {
    runEmailOutbox()
      .then((r) => {
        if (!r.disabled && (r.sent || r.failed)) console.log(`↳ email outbox: ${r.sent} sent, ${r.failed} failed, ${r.rescheduled} rescheduled`);
      })
      .catch((e) => console.error('email outbox tick failed', e));
  });
}
