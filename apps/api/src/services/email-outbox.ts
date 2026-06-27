// Transactional email outbox (decision: email-graph-integration). Business code calls enqueueEmail
// inside its own txn so the email is queued atomically with the business write and is idempotent via
// dedupKey. A cron worker (runEmailOutbox) drains the queue at a controlled rate and sends through
// Microsoft Graph. When Graph is unconfigured the worker is a no-op (rows stay queued, no error), so
// the feature can ship to production inert and go live by setting GRAPH_* env only.

import { withRls, type Prisma } from '@cmc/db';
import { logEvent } from '@cmc/audit';
import {
  graphMailerFromEnv,
  sendViaGraph,
  RateLimitError,
  type SendDeps,
} from '../lib/graph-client.js';
import { renderTemplate, type EmailTemplateKind, type TemplatePayloads } from './email-templates.js';

type Tx = Prisma.TransactionClient;

/** System context for the worker: no session, super-bypass (mirrors parent-meeting-reminder). */
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

const RATE_PER_RUN = 20; // < Exchange 30/min cap
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000; // a 'sending' row older than this is considered stuck → reclaimed

export interface EnqueueInput<K extends EmailTemplateKind> {
  facilityId?: number | null;
  /** Stable idempotency key, e.g. `payslip_ready:<payslipId>`. Re-enqueue with same key is a no-op. */
  dedupKey: string;
  to: string;
  mailbox: 'notify' | 'payroll' | 'hr';
  kind: K;
  data: TemplatePayloads[K];
  attachRef?: string | null;
}

/**
 * Queue one email inside the caller's transaction. Renders subject/html now so the row is
 * self-contained. A duplicate dedupKey is swallowed (already queued/sent). Always safe to call,
 * even when Graph is unconfigured — queuing is free; the worker decides whether to send.
 */
export async function enqueueEmail<K extends EmailTemplateKind>(
  tx: Tx,
  input: EnqueueInput<K>,
): Promise<void> {
  const { subject, html } = renderTemplate(input.kind, input.data);
  try {
    await tx.emailOutbox.create({
      data: {
        facilityId: input.facilityId ?? null,
        dedupKey: input.dedupKey,
        toAddress: input.to,
        mailbox: input.mailbox,
        templateKind: input.kind,
        subject,
        bodyHtml: html,
        attachRef: input.attachRef ?? null,
      },
    });
  } catch (e) {
    // P2002 = unique violation on dedupKey → already enqueued, nothing to do.
    if (isUniqueViolation(e)) return;
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** min(2^attempts, 30) minutes, in ms. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 30) * 60_000;
}

export interface OutboxRunResult {
  sent: number;
  failed: number;
  rescheduled: number;
  /** true when Graph is unconfigured and the run was a no-op. */
  disabled: boolean;
  /** true when a previous run was still in flight and this tick was skipped. */
  skipped?: boolean;
}

// Single-instance overlap guard: node-cron does not prevent a new tick firing while the previous
// run is still sending (a batch can outlast the 1-min interval under Graph latency). Skipping the
// overlapping tick prevents the same claimed rows being sent twice. NOTE: this is only correct for
// the current single-api-instance topology (same caveat as rate-limit.ts). A second replica would
// require DB-level claiming (SELECT ... FOR UPDATE SKIP LOCKED) instead.
let workerRunning = false;

/**
 * Drain up to RATE_PER_RUN due rows and send them. Claims rows by flipping them to 'sending'
 * (lease) so an overlapping tick won't double-send; reclaims rows stuck in 'sending' past the lease.
 * Network sends happen OUTSIDE the DB transaction (short txns only). `deps` injects a mock sender for
 * tests.
 */
export async function runEmailOutbox(now: Date = new Date(), deps: SendDeps = {}): Promise<OutboxRunResult> {
  const cfg = graphMailerFromEnv();
  if (!cfg) {
    return { sent: 0, failed: 0, rescheduled: 0, disabled: true };
  }
  if (workerRunning) {
    return { sent: 0, failed: 0, rescheduled: 0, disabled: false, skipped: true };
  }
  workerRunning = true;
  try {
    return await drainOutbox(cfg, now, deps);
  } finally {
    workerRunning = false;
  }
}

async function drainOutbox(
  cfg: NonNullable<ReturnType<typeof graphMailerFromEnv>>,
  now: Date,
  deps: SendDeps,
): Promise<OutboxRunResult> {
  // 1) Claim a batch atomically.
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  const claimed = await withRls(SYSTEM_CTX, async (tx) => {
    const due = await tx.emailOutbox.findMany({
      where: {
        OR: [
          { status: 'queued', scheduledFor: { lte: now } },
          { status: 'sending', scheduledFor: { lte: staleBefore } },
        ],
      },
      orderBy: { scheduledFor: 'asc' },
      take: RATE_PER_RUN,
    });
    if (due.length) {
      await tx.emailOutbox.updateMany({
        where: { id: { in: due.map((r) => r.id) } },
        data: { status: 'sending', scheduledFor: now },
      });
    }
    return due;
  });

  let sent = 0;
  let failed = 0;
  let rescheduled = 0;

  // 2) Send each claimed row outside the transaction, then record the outcome in a short txn.
  for (let i = 0; i < claimed.length; i++) {
    const row = claimed[i]!;
    try {
      await sendViaGraph(
        cfg,
        { mailbox: row.mailbox, to: row.toAddress, subject: row.subject, html: row.bodyHtml },
        deps,
      );
      await withRls(SYSTEM_CTX, async (tx) => {
        // Scrub the rendered body once delivered: some templates (lms_account_ready, otp_login) render
        // a plaintext one-time secret into bodyHtml. The subject + templateKind + audit log preserve
        // traceability; the credential must not linger in the outbox after it has been sent.
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'sent', sentAt: now, lastError: null, bodyHtml: '' },
        });
        await logEvent(tx, {
          facilityId: row.facilityId,
          entityType: 'email_outbox',
          entityId: row.id,
          type: 'status_changed',
          body: `Đã gửi email "${row.templateKind}" tới ${row.toAddress}`,
          actorId: null,
        });
      });
      sent++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        // Back off the whole remaining batch: return this row AND the rest of the claimed (still
        // 'sending') rows to 'queued' with a future schedule, so they retry on the next due tick
        // instead of waiting out the 5-min lease. No attempt is counted.
        const retryAt = new Date(now.getTime() + e.retryAfterSec * 1000);
        const remainingIds = claimed.slice(i).map((r) => r.id);
        await withRls(SYSTEM_CTX, (tx) =>
          tx.emailOutbox.updateMany({
            where: { id: { in: remainingIds } },
            data: { status: 'queued', scheduledFor: retryAt },
          }),
        );
        rescheduled += remainingIds.length;
        break; // stop the batch on rate-limit; next tick resumes
      }
      const attempts = row.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      const terminal = attempts >= MAX_ATTEMPTS;
      await withRls(SYSTEM_CTX, async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: terminal
            ? { status: 'failed', attempts, lastError: message, bodyHtml: '' } // scrub any rendered secret on terminal fail
            : { status: 'queued', attempts, lastError: message, scheduledFor: new Date(now.getTime() + backoffMs(attempts)) },
        });
        if (terminal) {
          await logEvent(tx, {
            facilityId: row.facilityId,
            entityType: 'email_outbox',
            entityId: row.id,
            type: 'status_changed',
            body: `Email "${row.templateKind}" tới ${row.toAddress} thất bại sau ${attempts} lần: ${message.slice(0, 200)}`,
            actorId: null,
          });
        }
      });
      if (terminal) failed++;
      else rescheduled++;
    }
  }

  return { sent, failed, rescheduled, disabled: false };
}
