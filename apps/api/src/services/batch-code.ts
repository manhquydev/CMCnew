import type { Prisma, Program } from '@cmc/db';
import { formatBatchCode, PROGRAM_ORDER_INDEX, type ClassProgram } from '@cmc/domain-academic';

/** Atomically allocate the next [FacilityCode]-[ProgramAbbrev]-[YY]-[NNNN] code
 * for (facility, program, year). Uses a transaction-scoped advisory lock so
 * concurrent creates can't collide. Lock key2 encodes program into the year
 * (`year * 10 + programIndex`) so it stays a plain 2-int advisory lock. */
export async function nextBatchCode(
  tx: Prisma.TransactionClient,
  facilityId: number,
  facilityCode: string,
  program: Program,
  year: number,
): Promise<string> {
  const lockKey2 = year * 10 + PROGRAM_ORDER_INDEX[program as ClassProgram];
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', facilityId, lockKey2);
  const counter = await tx.batchCodeCounter.upsert({
    where: { facilityId_program_year: { facilityId, program, year } },
    update: { lastSeq: { increment: 1 } },
    create: { facilityId, program, year, lastSeq: 1 },
  });
  return formatBatchCode(facilityCode, program as ClassProgram, year, counter.lastSeq);
}
