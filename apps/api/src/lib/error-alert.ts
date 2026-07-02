// Rolling-window error-rate alerting. Counts handler errors in a fixed 5-min window; once the
// count crosses ERROR_ALERT_THRESHOLD, enqueues one dedup'd email via the existing outbox
// (email-outbox.ts) so an ops recipient is notified without a new send path. Inert until
// OPS_ALERT_EMAIL is set — mirrors the codebase's inert-until-env convention (email-outbox,
// SSO). Topology note: module-level singleton, correct only for the current single-api-instance
// deployment (same caveat as email-outbox.ts:96-100 and rate-limit.ts).
import { withRls } from '@cmc/db';
import { enqueueEmail } from '../services/email-outbox.js';
import type { Logger } from 'pino';

const WINDOW_MS = 5 * 60_000;
const THRESHOLD = Number(process.env.ERROR_ALERT_THRESHOLD ?? 10);

// Local system-context literal — SYSTEM_CTX in email-outbox.ts is module-private (not exported);
// duplicating this trivial shape here keeps that file's ownership boundary clean (plan.md P1).
const sysCtx = { facilityIds: [] as number[], isSuperAdmin: true };

let windowStart = Date.now();
let count = 0;
let alertedForWindow = false;

function windowKey(start: number): string {
  const d = new Date(start);
  return d.toISOString().slice(0, 13); // yyyy-mm-ddThh — one alert per hour-window at most
}

/** Record one handler error. Call from app.onError. Never throws. */
export function recordError(): void {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    count = 0;
    alertedForWindow = false;
  }
  count++;
}

/**
 * Fire-and-forget: if the current window is over threshold and no alert has been sent for it yet,
 * enqueue one via the outbox. Guarded so a failure here never masks the original error.
 */
export async function maybeAlert(logger: Logger): Promise<void> {
  if (count < THRESHOLD || alertedForWindow) return;
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) return; // inert until configured
  // Latch BEFORE the await so concurrent onError calls crossing threshold around the same time
  // don't all fire enqueueEmail (dedupKey would collapse them anyway, but this avoids the churn).
  // On failure, un-latch so a later error in the same window gets another attempt — dedupKey
  // (keyed to the hour window, not the attempt) makes a retry safe even if an earlier attempt
  // partially succeeded.
  alertedForWindow = true;
  const dedupKey = `ops_error_alert:${windowKey(windowStart)}`;
  try {
    await withRls(sysCtx, (tx) =>
      enqueueEmail(tx, {
        dedupKey,
        to,
        mailbox: 'notify',
        kind: 'ops_error_alert',
        data: { windowStart: new Date(windowStart).toISOString(), count, threshold: THRESHOLD },
      }),
    );
  } catch (e) {
    alertedForWindow = false;
    logger.error({ err: e }, 'error-alert enqueue failed');
  }
}

/** Test-only: reset module state between cases. */
export function __resetErrorAlertStore(): void {
  windowStart = Date.now();
  count = 0;
  alertedForWindow = false;
}
