import type { Prisma } from '@cmc/db';

/** Atomically allocate the next CMC0001… employee code from the global
 * single-row counter. Shared by payroll.profileUpsert (existing profile edits)
 * and user.create (mandatory profile at staff-creation time). */
export async function nextEmployeeCode(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.$queryRawUnsafe<{ next: number }[]>(
    `INSERT INTO employee_code_counter (id, last_seq) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET last_seq = employee_code_counter.last_seq + 1
     RETURNING last_seq AS next`,
  );
  return `CMC${String(counter[0]?.next ?? 1).padStart(4, '0')}`;
}
