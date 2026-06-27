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
 * Persist StaffNotification rows inside an active transaction and return a
 * push function to fan-out to SSE clients.
 *
 * IMPORTANT: Call the returned `push()` function OUTSIDE the withRls callback
 * (i.e. after the transaction commits). Calling it inside the tx would push
 * ghost notifications to clients if the tx later rolls back.
 *
 * No-op when recipientIds is empty — returns a no-op push function.
 *
 * Usage:
 *   const push = await emitStaffNotif(tx, payload);
 *   return primaryResult;           // withRls commits here
 *   // then after withRls resolves:
 *   push();
 */
export async function emitStaffNotif(tx: PrismaTx, payload: StaffNotifPayload): Promise<() => void> {
  if (payload.recipientIds.length === 0) return () => {};

  // Persist rows sequentially to avoid concurrent writes on the same Prisma tx connection.
  const rows: Array<{
    id: string;
    recipientId: string;
    event: StaffNotifEvent;
    title: string;
    body: string;
    data: Prisma.JsonValue;
    createdAt: Date;
  }> = [];

  for (const recipientId of payload.recipientIds) {
    const row = await tx.staffNotification.create({
      data: {
        recipientId,
        event: payload.event,
        title: payload.title,
        body: payload.body,
        data: (payload.data ?? {}) as object,
        facilityId: payload.facilityId,
      },
      select: { id: true, recipientId: true, event: true, title: true, body: true, data: true, createdAt: true },
    });
    rows.push(row);
  }

  // Return a push function to be called after the transaction commits.
  return () => {
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
  };
}
