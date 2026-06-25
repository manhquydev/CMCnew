import type { Prisma, StaffNotifEvent } from '@cmc/db';
import { emitStaffNotification } from '../staff-notification.js';

type PrismaTx = Prisma.TransactionClient;

export interface StaffNotifPayload {
  recipientIds: string[];
  event: StaffNotifEvent;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  facilityId: number;
}

/**
 * Persist StaffNotification rows inside an active transaction and fan-out to
 * SSE clients. Call this AFTER the primary mutation has been written so the
 * SSE push is coherent with DB state.
 *
 * No-op when recipientIds is empty.
 */
export async function emitStaffNotif(tx: PrismaTx, payload: StaffNotifPayload): Promise<void> {
  if (payload.recipientIds.length === 0) return;

  const rows = await Promise.all(
    payload.recipientIds.map((recipientId) =>
      tx.staffNotification.create({
        data: {
          recipientId,
          event: payload.event,
          title: payload.title,
          body: payload.body,
          data: (payload.data ?? {}) as object,
          facilityId: payload.facilityId,
        },
        select: { id: true, recipientId: true, event: true, title: true, body: true, data: true, createdAt: true },
      }),
    ),
  );

  // Fan-out to connected SSE clients after all rows are committed.
  for (const row of rows) {
    emitStaffNotification({
      recipientId: row.recipientId,
      notification: {
        id: row.id,
        event: row.event,
        title: row.title,
        body: row.body,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
      },
    });
  }
}
