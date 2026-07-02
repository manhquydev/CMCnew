/**
 * One-off backfill for the email_outbox.transport migration (20260702200510_email_outbox_transport).
 * Reclassifies every still-queued/sending row via decideTransport (the exact same routing logic
 * enqueueEmail now uses) instead of leaving them pinned to the migration's DEFAULT 'graph' — a row
 * already failing against Graph's 550 5.7.708 block gets a real shot at Brevo instead of retrying
 * the broken path to terminal failure (which would scrub OTP/temp-password bodies on secret-bearing
 * templates). Resets attempts/lastError for any row reclassified from graph→brevo so it gets a
 * fresh backoff window, not a stale attempt count from the broken path.
 *
 * Run once, right after the migration, as part of the same deploy step:
 *   tsx backfill-email-outbox-transport.ts
 */
import { withRls } from '@cmc/db';
import { decideTransport } from './src/lib/email-routing.js';

const SYSTEM_CTX = { facilityIds: [] as number[], isSuperAdmin: true };

/** Exported so the test suite exercises the real implementation, not a hand-copied duplicate. */
export async function backfillEmailOutboxTransport(): Promise<{ scanned: number; reclassified: number }> {
  return withRls(SYSTEM_CTX, async (tx) => {
    const rows = await tx.emailOutbox.findMany({
      where: { status: { in: ['queued', 'sending'] } },
      select: { id: true, toAddress: true, transport: true },
    });

    let reclassified = 0;
    for (const row of rows) {
      const decided = decideTransport(row.toAddress);
      if (decided === row.transport) continue;
      await tx.emailOutbox.update({
        where: { id: row.id },
        data: { transport: decided, attempts: 0, lastError: null },
      });
      reclassified++;
    }
    return { scanned: rows.length, reclassified };
  });
}

async function main() {
  const result = await backfillEmailOutboxTransport();
  console.log(`Scanned ${result.scanned} in-flight row(s), reclassified ${result.reclassified}.`);
}

// Only run as a CLI entrypoint (tsx backfill-email-outbox-transport.ts), not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('backfill-email-outbox-transport.ts')) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('backfill-email-outbox-transport failed:', e);
      process.exit(1);
    });
}
