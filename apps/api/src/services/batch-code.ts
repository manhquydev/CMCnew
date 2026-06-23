import type { Prisma } from '@cmc/db';
import { formatBatchCode } from '@cmc/domain-academic';

/** Atomically allocate the next B-YYYY-NNNN code for (facility, year).
 * Uses a transaction-scoped advisory lock so concurrent creates can't collide. */
export async function nextBatchCode(
  tx: Prisma.TransactionClient,
  facilityId: number,
  year: number,
): Promise<string> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', facilityId, year);
  const counter = await tx.batchCodeCounter.upsert({
    where: { facilityId_year: { facilityId, year } },
    update: { lastSeq: { increment: 1 } },
    create: { facilityId, year, lastSeq: 1 },
  });
  return formatBatchCode(year, counter.lastSeq);
}
