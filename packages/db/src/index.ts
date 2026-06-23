import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export * from '@prisma/client';
export { hashPassword, verifyPassword } from './password.js';

type PrismaTx = Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Runtime client. Connects as the non-owner role (cmc_app) so RLS policies apply. */
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RlsContext {
  facilityIds: number[];
  isSuperAdmin: boolean;
  /** 'staff' (default) keeps Phase-1 facility behaviour; 'parent'/'student' scope by ownership. */
  principalKind?: 'staff' | 'parent' | 'student';
  /** Students the principal owns (child set for a parent, self for a student). */
  studentIds?: string[];
}

/**
 * Run queries inside a transaction with the RLS GUCs set for this request.
 * Every facility-scoped read/write MUST go through here (or an equivalent tx)
 * so Postgres row-level security can isolate by facility (and, for LMS principals,
 * by student ownership — see the principal_aware_rls migration).
 */
export function withRls<T>(ctx: RlsContext, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  // Defence: facility ids flow into a SQL int[] cast; never let a non-int through.
  if (!ctx.facilityIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error('withRls: facilityIds must be positive integers');
  }
  // student ids flow into a SQL uuid[] cast; reject anything that is not a uuid.
  const studentIds = ctx.studentIds ?? [];
  if (!studentIds.every((id) => UUID_RE.test(id))) {
    throw new Error('withRls: studentIds must be uuids');
  }
  const principalKind = ctx.principalKind ?? 'staff';
  // set_config(...,true) is transaction-local: Postgres resets it at COMMIT/ROLLBACK,
  // and Prisma holds one dedicated connection for the interactive transaction — so the
  // GUC cannot leak to another request even under connection pooling.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.facility_ids', $1, true), set_config('app.is_super_admin', $2, true), set_config('app.principal_kind', $3, true), set_config('app.student_ids', $4, true)",
      ctx.facilityIds.join(','),
      ctx.isSuperAdmin ? 'true' : 'false',
      principalKind,
      studentIds.join(','),
    );
    return fn(tx);
  });
}
