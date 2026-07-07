import type { Prisma } from '@cmc/db';

export function formatStudentCode(year: number, seq: number): string {
  return `HS-${year}-${String(seq).padStart(4, '0')}`;
}

export function currentSaigonYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(now));
}

/** Allocate the next free HS-YYYY-NNNN code for a facility without relying on receipt codes. */
export async function nextDirectStudentCode(
  tx: Prisma.TransactionClient,
  facilityId: number,
  year = currentSaigonYear(),
): Promise<string> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock($1::int, $2::int)', facilityId, year + 73000);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const counter = await tx.studentCodeCounter.upsert({
      where: { facilityId_year: { facilityId, year } },
      update: { lastSeq: { increment: 1 } },
      create: { facilityId, year, lastSeq: 1 },
    });
    const code = formatStudentCode(year, counter.lastSeq);
    const existing = await tx.student.findUnique({
      where: { facilityId_studentCode: { facilityId, studentCode: code } },
      select: { id: true },
    });
    if (!existing) return code;
  }

  throw new Error(`Could not allocate a free student code for facility ${facilityId} in ${year}`);
}
