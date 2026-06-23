import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '../../.env') });

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { trpcServer } from '@hono/trpc-server';
import { resolveLmsSession } from '@cmc/auth';
import { appRouter } from './routers/index.js';
import { createContext, LMS_COOKIE_NAME } from './context.js';
import { onNotification } from './events.js';

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
