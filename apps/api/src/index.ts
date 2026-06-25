import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '../../.env') });

import cron from 'node-cron';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { trpcServer } from '@hono/trpc-server';
import { resolveLmsSession, resolveSession, rlsContextOf, lmsRlsContextOf } from '@cmc/auth';
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

const app = new Hono();

// Allowed origins from env (comma-separated); defaults to the dev Vite ports.
// credentials:true so the session cookie flows. In production, set CORS_ORIGINS.
const corsOrigins = (
  process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use('*', cors({ origin: corsOrigins, credentials: true }));

app.get('/health', (c) => c.json({ ok: true }));

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
      tx.student.findUnique({ where: { id: r.studentId }, select: { fullName: true, studentCode: true } }),
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
    studentName: student ? `${student.fullName} (${student.studentCode})` : r.studentId.slice(0, 8),
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
  const ownedIds = new Set(lms.studentIds);

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
      await stream.writeSSE({ event: 'ping', data: '1' });
    }
    unsubscribe();
  });
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
}
