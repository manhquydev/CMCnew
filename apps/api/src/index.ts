import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '../../.env') });

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { trpcServer } from '@hono/trpc-server';
import { resolveLmsSession, resolveSession } from '@cmc/auth';
import { appRouter } from './routers/index.js';
import { createContext, COOKIE_NAME, LMS_COOKIE_NAME } from './context.js';
import { onNotification } from './events.js';
import { putPdf, readPdf, pdfExists, PdfStoreError, MAX_PDF_BYTES } from './services/pdf-store.js';

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

// Serve: any authenticated principal (staff or LMS). NOTE (DEBT): coarse auth — does not yet
// check that this principal may see this specific exercise. Tighten to per-principal access
// (staff facility / student enrolled in the class) before production. Ref is content-addressed
// (sha256), so it is unguessable, but that is not an access-control substitute.
app.get('/files/exercise/:ref', async (c) => {
  const staffTok = getCookie(c, COOKIE_NAME);
  const lmsTok = getCookie(c, LMS_COOKIE_NAME);
  const authed = (staffTok && (await resolveSession(staffTok))) || (lmsTok && (await resolveLmsSession(lmsTok)));
  if (!authed) return c.text('unauthorized', 401);
  const ref = c.req.param('ref');
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
