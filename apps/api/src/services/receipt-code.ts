import type { Prisma } from '@cmc/db';
import { formatReceiptCode } from '@cmc/domain-finance';

/** Atomically allocate the next PT-YYYY-NNNN receipt code for (facility, year).
 * Transaction-scoped advisory lock so concurrent approvals can't collide. */
export async function nextReceiptCode(
  tx: Prisma.TransactionClient,
  facilityId: number,
  year: number,
): Promise<string> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', facilityId, year);
  const counter = await tx.receiptCodeCounter.upsert({
    where: { facilityId_year: { facilityId, year } },
    update: { lastSeq: { increment: 1 } },
    create: { facilityId, year, lastSeq: 1 },
  });
  return formatReceiptCode(year, counter.lastSeq);
}
