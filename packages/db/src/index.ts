import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export * from '@prisma/client';
export { hashPassword, verifyPassword } from './password.js';

type PrismaTx = Prisma.TransactionClient;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Runtime client. Connects as the non-owner role (cmc_app) so RLS policies apply. */
export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export interface RlsContext {
  facilityIds: number[];
  isSuperAdmin: boolean;
}

/**
 * Run queries inside a transaction with the RLS GUCs set for this request.
 * Every facility-scoped read/write MUST go through here (or an equivalent tx)
 * so Postgres row-level security can isolate by facility.
 */
export function withRls<T>(ctx: RlsContext, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.facility_ids', $1, true), set_config('app.is_super_admin', $2, true)",
      ctx.facilityIds.join(','),
      ctx.isSuperAdmin ? 'true' : 'false',
    );
    return fn(tx);
  });
}
