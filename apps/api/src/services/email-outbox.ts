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
import { brevoMailerFromEnv, sendViaBrevo, type BrevoMailerConfig } from '../lib/brevo-client.js';
import { decideTransport, isValidEmailFormat, type EmailTransport } from '../lib/email-routing.js';
import { renderTemplate, type EmailTemplateKind, type TemplatePayloads } from './email-templates.js';

type Tx = Prisma.TransactionClient;

/** System context for the worker: no session, super-bypass (mirrors parent-meeting-reminder). */
const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

const GRAPH_RATE_PER_RUN = 20; // < Exchange 30/min cap
const BREVO_RATE_PER_RUN = 20; // starting value; raise once the real provisioned Brevo tier limit is confirmed
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000; // a 'sending' row older than this is considered stuck → reclaimed

// Only these templates render a plaintext one-time secret (OTP / temp password) into bodyHtml, so
// only these get their body scrubbed once terminal. Non-secret templates keep their body so a
// terminally-failed row can still be re-sent (requeued) with its content intact — without this,
// retrying a failed email delivered a BLANK message.
export const SECRET_KINDS = new Set<EmailTemplateKind>(['otp_login', 'lms_account_ready']);
/** Returns the bodyHtml patch for a terminal row: '' for secret templates, untouched otherwise. */
function scrubPatch(templateKind: string): { bodyHtml: string } | Record<string, never> {
  return SECRET_KINDS.has(templateKind as EmailTemplateKind) ? { bodyHtml: '' } : {};
}

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
 *
 * Returns true when a new row was inserted, false when the dedupKey collided (no-op). A collision
 * aborts the underlying Postgres transaction (unique-violation), so the caller MUST NOT run any
 * further query in the same transaction after a `false` return — only COMMIT/ROLLBACK are valid
 * once a statement has errored, even though the JS exception was caught here.
 */
export async function enqueueEmail<K extends EmailTemplateKind>(
  tx: Tx,
  input: EnqueueInput<K>,
): Promise<boolean> {
  if (!isValidEmailFormat(input.to)) {
    throw new Error(`enqueueEmail: malformed recipient address "${input.to}"`);
  }
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
        transport: decideTransport(input.to),
      },
    });
    return true;
  } catch (e) {
    // P2002 = unique violation on dedupKey → already enqueued, nothing to do.
    if (isUniqueViolation(e)) return false;
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
  const graphCfg = graphMailerFromEnv();
  const brevoCfg = brevoMailerFromEnv();
  if (!graphCfg && !brevoCfg) {
    return { sent: 0, failed: 0, rescheduled: 0, disabled: true };
  }
  if (workerRunning) {
    return { sent: 0, failed: 0, rescheduled: 0, disabled: false, skipped: true };
  }
  workerRunning = true;
  try {
    return await drainOutbox(graphCfg, brevoCfg, now, deps);
  } finally {
    workerRunning = false;
  }
}

async function drainOutbox(
  graphCfg: ReturnType<typeof graphMailerFromEnv>,
  brevoCfg: BrevoMailerConfig | null,
  now: Date,
  deps: SendDeps,
): Promise<OutboxRunResult> {
  const staleBefore = new Date(now.getTime() - LEASE_MS);
  const configured: EmailTransport[] = [];
  if (graphCfg) configured.push('graph');
  if (brevoCfg) configured.push('brevo');

  let sent = 0;
  let failed = 0;
  let rescheduled = 0;

  // Claim + send each configured transport's slice separately, so a rate-limit on one transport
  // can never reschedule the other transport's already-claimed batch.
  for (const transport of configured) {
    const take = transport === 'graph' ? GRAPH_RATE_PER_RUN : BREVO_RATE_PER_RUN;

    // 1) Claim a batch atomically.
    const claimed = await withRls(SYSTEM_CTX, async (tx) => {
      const due = await tx.emailOutbox.findMany({
        where: {
          transport,
          OR: [
            { status: 'queued', scheduledFor: { lte: now } },
            { status: 'sending', scheduledFor: { lte: staleBefore } },
          ],
        },
        orderBy: { scheduledFor: 'asc' },
        take,
      });
      if (due.length) {
        await tx.emailOutbox.updateMany({
          where: { id: { in: due.map((r) => r.id) } },
          data: { status: 'sending', scheduledFor: now },
        });
      }
      return due;
    });

    // 2) Send each claimed row outside the transaction, then record the outcome in a short txn.
    for (let i = 0; i < claimed.length; i++) {
      const row = claimed[i]!;
      try {
        const msg = { mailbox: row.mailbox, to: row.toAddress, subject: row.subject, html: row.bodyHtml };
        if (transport === 'brevo') await sendViaBrevo(brevoCfg!, msg, deps);
        else await sendViaGraph(graphCfg!, msg, deps);
        await withRls(SYSTEM_CTX, async (tx) => {
          // Scrub the rendered body once delivered ONLY for secret-bearing templates (their plaintext
          // one-time secret must not linger in the outbox). Non-secret templates keep their body for
          // auditability + the ability to re-send. Subject + templateKind + audit log preserve traceability.
          await tx.emailOutbox.update({
            where: { id: row.id },
            data: { status: 'sent', sentAt: now, lastError: null, ...scrubPatch(row.templateKind) },
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
          // Back off the rest of THIS transport's claimed (still 'sending') rows — the other
          // transport's batch is unaffected since it was claimed/sent in its own loop iteration.
          const retryAt = new Date(now.getTime() + e.retryAfterSec * 1000);
          const remainingIds = claimed.slice(i).map((r) => r.id);
          await withRls(SYSTEM_CTX, (tx) =>
            tx.emailOutbox.updateMany({
              where: { id: { in: remainingIds } },
              data: { status: 'queued', scheduledFor: retryAt },
            }),
          );
          rescheduled += remainingIds.length;
          break; // stop this transport's batch on rate-limit; next tick resumes
        }
        const attempts = row.attempts + 1;
        const message = e instanceof Error ? e.message : String(e);
        const terminal = attempts >= MAX_ATTEMPTS;
        await withRls(SYSTEM_CTX, async (tx) => {
          await tx.emailOutbox.update({
            where: { id: row.id },
            data: terminal
              ? { status: 'failed', attempts, lastError: message, ...scrubPatch(row.templateKind) } // scrub secret-bearing bodies only; keep others so a failed row stays re-sendable
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
  }

  return { sent, failed, rescheduled, disabled: false };
}
