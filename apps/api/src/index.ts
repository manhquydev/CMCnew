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
import { resolveLmsSession, resolveSession, rlsContextOf, lmsRlsContextOf, mintStaffSession, can } from '@cmc/auth';
import { ssoConfigFromEnv, buildAuthUrl, redeemCode } from './lib/sso.js';
import { withRls, type RlsContext } from '@cmc/db';
import { appRouter } from './routers/index.js';
import { createContext, COOKIE_NAME, LMS_COOKIE_NAME } from './context.js';
import { onNotification } from './events.js';
import { onStaffNotification } from './staff-notification.js';
import {
  putPdf,
  readPdf,
  pdfExists,
  PdfStoreError,
  PdfStoreConfigError,
  MAX_PDF_BYTES,
} from './services/pdf-store.js';
import { putSessionPhoto, readSessionPhoto, PhotoStoreError, MAX_SESSION_PHOTO_BYTES } from './services/photo-store.js';
import { renderReceiptHtml } from './services/receipt-html.js';
import { runParentMeetingReminders } from './services/parent-meeting-reminder.js';
import { generateParentMeetings } from './services/parent-meeting-cadence.js';
import { renderCertificateHtml } from './services/certificate-html.js';
import { renderTranscriptHtml } from './services/transcript-html.js';
import { runEmailOutbox } from './services/email-outbox.js';
import { runExerciseOpenNotifications } from './services/exercise-open-notify.js';
import { logger } from './lib/logger.js';
import { recordError, maybeAlert } from './lib/error-alert.js';

export const app = new Hono();

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

// Global error boundary: log every uncaught handler error with request context, count it toward
// the rolling error-rate window, and fire an ops alert once the window crosses threshold. The
// alert path is fire-and-forget and internally guarded — it must never mask the original error.
app.onError((err, c) => {
  logger.error({ method: c.req.method, path: c.req.path, err }, 'unhandled request error');
  recordError();
  void maybeAlert(logger);
  return c.json({ error: 'internal_error' }, 500);
});

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
// Upload: gated to the same roles that author exercises (exercise.upsert) — only the two
// director roles create exercises post-seam-fixes, so upload authority must match write
// authority. Raw PDF body. Returns the content-address ref to store in exercise.basePdfRef.
app.post('/upload/exercise-pdf', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  if (!session) return c.text('unauthorized', 401);
  if (!can(session.roles, session.isSuperAdmin, 'exercise', 'upsert')) {
    return c.text('forbidden', 403);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_PDF_BYTES) return c.text('file too large', 413);
  try {
    const ref = await putPdf(Buffer.from(body));
    return c.json({ ref });
  } catch (e) {
    if (e instanceof PdfStoreConfigError) throw e; // server misconfig — surface as 500, not a client-facing 400
    if (e instanceof PdfStoreError) return c.text(e.message, 400);
    throw e;
  }
});

// Upload session evidence photos. Read access is intentionally NOT handled here;
// session photos must be served only after the published evidence ownership check.
// Gated to the same roles as sessionEvidence.upsertDraft (unlike exercise-pdf, a student
// photo is more sensitive than a worksheet — restrict who can write blobs at all, not
// only who can later link them).
app.post('/upload/session-photo', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  if (!session) return c.text('unauthorized', 401);
  if (!can(session.roles, session.isSuperAdmin, 'sessionEvidence', 'upsertDraft')) {
    return c.text('forbidden', 403);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_SESSION_PHOTO_BYTES) return c.text('file too large', 413);
  try {
    const ref = await putSessionPhoto(Buffer.from(body));
    return c.json({ ref });
  } catch (e) {
    if (e instanceof PhotoStoreError) return c.text(e.message, 400);
    throw e;
  }
});

app.get('/files/session-photo/:ref', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const lmsTok = getCookie(c, LMS_COOKIE_NAME);
  const staff = staffTok ? await resolveSession(staffTok) : null;
  const lms = !staff && lmsTok ? await resolveLmsSession(lmsTok) : null;
  if (!staff && !lms) return c.text('unauthorized', 401);

  const ref = c.req.param('ref');
  const rlsCtx = staff ? rlsContextOf(staff) : lmsRlsContextOf(lms!);
  const visible = await withRls(rlsCtx, (tx) =>
    tx.sessionEvidencePhoto.findFirst({
      where: {
        photoRef: ref,
        sessionEvidence: staff
          ? { archivedAt: null }
          : { status: 'published', publishedAt: { not: null }, archivedAt: null },
      },
      select: { id: true },
    }),
  );
  if (!visible) return c.text('forbidden', 403);

  try {
    const { buffer, contentType } = await readSessionPhoto(ref);
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(buffer as unknown as ArrayBuffer);
  } catch {
    return c.text('not found', 404);
  }
});

// Serve: exercise PDFs are a GLOBAL curriculum asset — RLS is DISABLED on the exercise table
// (decision 0022), so this findFirst matches for ANY authenticated principal (staff or LMS),
// regardless of facility, enrollment, or exercise status. In effect any logged-in principal can
// fetch any non-archived exercise PDF by ref, INCLUDING drafts/closed. That was accepted with the
// global-asset decision: worksheets carry no PII, and the only gate is "must be authenticated"
// (anonymous → 401 below). No status='published' filter is applied on purpose — staff preview
// drafts before publishing and LMS reads are already gated upstream by the unit-open check. The
// existence-on-disk check runs only after this authz so an unauthenticated caller learns nothing.
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

// Printable certificate (chứng chỉ) — staff (facility RLS) OR LMS parent/student who owns the
// certificate's student. The certificate table's RLS policy is staff-only (principal_kind='staff'),
// so the LMS branch reads under a system (bypass) context and enforces ownership explicitly in code —
// never trust the :id path param alone (same invariant as submission.layerForGuardian).
const SYSTEM_RLS: RlsContext = { facilityIds: [], isSuperAdmin: true };

app.get('/files/certificate/:id', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const lmsTok = getCookie(c, LMS_COOKIE_NAME);
  const staff = staffTok ? await resolveSession(staffTok) : null;
  const lms = !staff && lmsTok ? await resolveLmsSession(lmsTok) : null;
  if (!staff && !lms) return c.text('unauthorized', 401);

  const id = c.req.param('id');
  const data = staff
    ? await withRls(rlsContextOf(staff), async (tx) => {
        const cert = await tx.certificate.findUnique({ where: { id } });
        if (!cert) return null;
        const [student, facility] = await Promise.all([
          tx.student.findUnique({ where: { id: cert.studentId }, select: { fullName: true } }),
          tx.facility.findUnique({ where: { id: cert.facilityId }, select: { name: true } }),
        ]);
        return { cert, student, facility };
      })
    : await withRls(SYSTEM_RLS, async (tx) => {
        const cert = await tx.certificate.findUnique({ where: { id } });
        if (!cert || !lms!.studentIds.includes(cert.studentId)) return null; // ownership check — the security boundary for this branch
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

// Printable học bạ (transcript) — LMS parent/student only, scoped to an owned student.
// finalGrade/qualitativeAssessment/student RLS already support parent/student ownership
// (studentId ∈ app.student_ids), so lmsRlsContextOf is sufficient here — no bypass needed,
// unlike the certificate branch above.
app.get('/files/transcript/:studentId', async (c) => {
  const lmsTok = getCookie(c, LMS_COOKIE_NAME);
  const lms = lmsTok ? await resolveLmsSession(lmsTok) : null;
  if (!lms) return c.text('unauthorized', 401);

  const studentId = c.req.param('studentId');
  if (!lms.studentIds.includes(studentId)) return c.text('forbidden', 403);

  const data = await withRls(lmsRlsContextOf(lms), async (tx) => {
    const student = await tx.student.findUnique({ where: { id: studentId }, select: { fullName: true, facilityId: true } });
    if (!student) return null;
    const [facility, finalGrades, qualitative] = await Promise.all([
      tx.facility.findUnique({ where: { id: student.facilityId }, select: { name: true } }),
      tx.finalGrade.findMany({
        where: { studentId },
        orderBy: { periodKey: 'desc' },
        select: {
          id: true,
          program: true,
          level: true,
          periodKey: true,
          homeworkAvg: true,
          testScore: true,
          attendanceRate: true,
          qualitativeScore: true,
          finalScore: true,
          passed: true,
          complete: true,
        },
      }),
      tx.qualitativeAssessment.findMany({
        where: { studentId, archivedAt: null },
        orderBy: { periodKey: 'desc' },
        select: { id: true, period: true, periodKey: true, criteria: true, narrative: true },
      }),
    ]);
    return { student, facility, finalGrades, qualitative };
  });
  if (!data) return c.text('forbidden', 403);

  const html = renderTranscriptHtml({
    facilityName: data.facility?.name ?? '',
    studentName: data.student.fullName,
    finalGrades: data.finalGrades,
    qualitative: data.qualitative.map((q) => ({ ...q, criteria: q.criteria as Record<string, number> })),
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

type StaffSsoTx = {
  state: string;
  verifier: string;
  returnOrigin?: string;
  returnPath?: string;
  redirectUri?: string;
};

function splitOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function allowedStaffOrigins(): Set<string> {
  const origins = [erpOrigin(), ...splitOrigins(process.env.STAFF_APP_ORIGINS)]
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => !!origin);
  return new Set(origins);
}

function staffReturnOrigin(requested: string | undefined | null): string {
  const fallback = normalizeOrigin(erpOrigin()) ?? 'http://localhost:5173';
  const candidate = normalizeOrigin(requested) ?? fallback;
  return allowedStaffOrigins().has(candidate) ? candidate : fallback;
}

function originFromHeader(raw: string | undefined): string | null {
  return normalizeOrigin(raw);
}

function firstForwardedValue(raw: string | undefined): string | null {
  const value = raw?.split(',')[0]?.trim();
  return value || null;
}

function originFromForwardedHost(protoRaw: string | undefined, hostRaw: string | undefined): string | null {
  const host = firstForwardedValue(hostRaw);
  if (!host || host.includes('/') || host.includes('\\')) return null;
  const proto = firstForwardedValue(protoRaw) ?? 'https';
  if (proto !== 'http' && proto !== 'https') return null;
  return normalizeOrigin(`${proto}://${host}`);
}

function staffReturnPath(raw: string | undefined | null): string {
  if (!raw) return '/';
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const parsed = new URL(value, 'https://cmc.local');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function redirectUriForStaffOrigin(cfg: { redirectUri: string }, origin: string): string {
  const canonical = normalizeOrigin(erpOrigin());
  if (canonical && origin === canonical) return cfg.redirectUri;
  const base = new URL(cfg.redirectUri);
  return `${origin}${base.pathname}${base.search}`;
}

app.get('/auth/sso/login', async (c) => {
  const cfg = ssoConfigFromEnv();
  if (!cfg) return c.text('SSO chưa được cấu hình', 503);
  const returnOrigin = staffReturnOrigin(
    c.req.query('returnOrigin') ??
      originFromHeader(c.req.header('origin')) ??
      originFromHeader(c.req.header('referer')) ??
      originFromForwardedHost(c.req.header('x-forwarded-proto'), c.req.header('x-forwarded-host') ?? c.req.header('host')),
  );
  const returnPath = staffReturnPath(c.req.query('returnPath'));
  const redirectUri = redirectUriForStaffOrigin(cfg, returnOrigin);
  const { url, tx } = await buildAuthUrl({ ...cfg, redirectUri });
  const cookieTx: StaffSsoTx = { ...tx, returnOrigin, returnPath, redirectUri };
  setCookie(c, SSO_TX_COOKIE, JSON.stringify(cookieTx), {
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
  const code = c.req.query('code');
  const state = c.req.query('state');
  const raw = getCookie(c, SSO_TX_COOKIE);
  deleteCookie(c, SSO_TX_COOKIE, { path: '/' });

  let tx: StaffSsoTx | null = null;
  if (raw) {
    try {
      tx = JSON.parse(raw);
    } catch {
      tx = null;
    }
  }
  const returnOrigin = staffReturnOrigin(tx?.returnOrigin);
  const fail = (reason: string) => c.redirect(`${returnOrigin}/login?sso_error=${encodeURIComponent(reason)}`);

  if (c.req.query('error')) return fail('denied');
  if (!code || !state || !tx) return fail('state');
  if (tx.state !== state) return fail('state'); // CSRF guard

  const email = await redeemCode({ ...cfg, redirectUri: tx.redirectUri ?? cfg.redirectUri }, code, tx.verifier).catch(() => null);
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
  return c.redirect(`${returnOrigin}${staffReturnPath(tx.returnPath)}`);
});

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, c) =>
      createContext(c) as unknown as Promise<Record<string, unknown>>,
  }),
);

// Skip binding a real port under Vitest (NODE_ENV=test by default) so integration tests can
// import `app` and drive routes via `app.request(...)` without starting a listener.
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.API_PORT ?? 4000);
  serve({ fetch: app.fetch, port });
  logger.info({ port }, '✓ CMCnew API listening');
}

// Embedded reminder cron (docs/specs/parent-meeting.md): every 30 min, remind parents of
// meetings within T-1 day. Idempotent via parent_meeting.remindedAt — re-ticks never double-send.
// Set DISABLE_CRON=1 in tests/CI to keep the process side-effect-free.
if (process.env.DISABLE_CRON !== '1') {
  cron.schedule('*/30 * * * *', () => {
    runParentMeetingReminders()
      .then((r) => {
        if (r.meetingsReminded) logger.info({ meetings: r.meetingsReminded, notifications: r.notificationsCreated }, 'parent-meeting reminders');
      })
      .catch((e) => logger.error({ err: e }, 'parent-meeting reminder tick failed'));
  });

  // Auto-cadence generation (charter §4): daily at 02:00, generate per-program meetings for running
  // classes. Idempotent via the (classBatchId, scheduledAt) unique constraint — re-ticks add nothing new.
  cron.schedule('0 2 * * *', () => {
    generateParentMeetings()
      .then((r) => {
        if (r.meetingsCreated) logger.info({ created: r.meetingsCreated, classesScanned: r.classesScanned }, 'parent-meeting cadence');
      })
      .catch((e) => logger.error({ err: e }, 'parent-meeting cadence tick failed'));
  });

  // Email outbox drain (decision: email-graph-integration): every minute, send up to 20 queued
  // emails via Microsoft Graph (rate-limited under Exchange's 30/min cap). No-op when GRAPH_* env is
  // unset — rows stay queued until the tenant is configured, so this is safe to run in production.
  cron.schedule('* * * * *', () => {
    runEmailOutbox()
      .then((r) => {
        if (!r.disabled && (r.sent || r.failed)) logger.info({ sent: r.sent, failed: r.failed, rescheduled: r.rescheduled }, 'email outbox tick');
      })
      .catch((e) => logger.error({ err: e }, 'email outbox tick failed'));
  });

  // Exercise-open notification, Trigger B: every 30 min, catch the reverse ordering where a
  // published exercise already existed and a session has just ended.
  // Trigger A (exercise.upsert) covers publish-after-session-end inline; per-(student,
  // exercise) dedup makes tick overlap with Trigger A free of duplicates.
  cron.schedule('*/30 * * * *', () => {
    runExerciseOpenNotifications()
      .then((r) => {
        if (r.notificationsCreated) logger.info({ sessions: r.sessionsScanned, notifications: r.notificationsCreated }, 'exercise-open notifications');
      })
      .catch((e) => logger.error({ err: e }, 'exercise-open notification tick failed'));
  });
}
