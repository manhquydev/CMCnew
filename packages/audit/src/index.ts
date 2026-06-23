import type { Prisma } from '@cmc/db';

type Tx = Prisma.TransactionClient;

export type RecordEventType = 'created' | 'updated' | 'status_changed' | 'archived' | 'restored' | 'note';

export interface ChangeEntry {
  field: string;
  old: unknown;
  new: unknown;
}

/** Compute a tracked-field diff (Odoo-style tracking values). */
export function diffChanges<T extends Record<string, unknown>>(
  before: T | null,
  after: T,
  fields: (keyof T)[],
): ChangeEntry[] {
  const changes: ChangeEntry[] = [];
  for (const f of fields) {
    const oldVal = before ? (before[f] ?? null) : null;
    const newVal = after[f] ?? null;
    if (oldVal !== newVal) changes.push({ field: String(f), old: oldVal, new: newVal });
  }
  return changes;
}

export interface LogEventInput {
  facilityId?: number | null;
  entityType: string;
  entityId: string;
  type: RecordEventType;
  changes?: ChangeEntry[];
  body?: string | null;
  actorId?: string | null;
}

/** Append one timeline entry. MUST be called inside the same tx as the mutation. */
export async function logEvent(tx: Tx, input: LogEventInput): Promise<void> {
  await tx.recordEvent.create({
    data: {
      facilityId: input.facilityId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      type: input.type,
      changes:
        input.changes && input.changes.length
          ? (input.changes as unknown as Prisma.InputJsonValue)
          : undefined,
      body: input.body ?? undefined,
      actorId: input.actorId ?? null,
    },
  });
}

/** Convenience: log a status transition with old→new. */
export function logStatusChange(
  tx: Tx,
  base: Omit<LogEventInput, 'type' | 'changes'>,
  field: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  return logEvent(tx, {
    ...base,
    type: 'status_changed',
    changes: [{ field, old: oldStatus, new: newStatus }],
  });
}

export async function addFollower(
  tx: Tx,
  entityType: string,
  entityId: string,
  userId: string,
): Promise<void> {
  await tx.recordFollower.upsert({
    where: { entityType_entityId_userId: { entityType, entityId, userId } },
    update: {},
    create: { entityType, entityId, userId },
  });
}

export interface TimelineEntry {
  id: string;
  type: RecordEventType;
  body: string | null;
  changes: unknown; // [{ field, old, new }] — kept as `unknown` so Prisma's recursive Json type
  actorId: string | null; // doesn't leak into the tRPC client (it blows TS instantiation depth).
  createdAt: Date;
}

/** Newest-first timeline for a record. */
export async function getTimeline(
  tx: Tx,
  entityType: string,
  entityId: string,
): Promise<TimelineEntry[]> {
  const rows = await tx.recordEvent.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    body: r.body,
    changes: r.changes,
    actorId: r.actorId,
    createdAt: r.createdAt,
  }));
}

export function getFollowers(tx: Tx, entityType: string, entityId: string) {
  return tx.recordFollower.findMany({ where: { entityType, entityId } });
}
