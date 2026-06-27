import { EventEmitter } from 'node:events';

/** Payload pushed to connected SSE clients for staff notifications. */
export interface StaffNotifEvent {
  recipientId: string;
  notification: {
    id: string;
    event: string;
    title: string;
    body: string;
    data: unknown;
    createdAt: string;
  };
}

// In-process fan-out bus for staff real-time notifications.
// setMaxListeners(0) — one listener per SSE connection.
const staffBus = new EventEmitter();
staffBus.setMaxListeners(0);

export function emitStaffNotification(evt: StaffNotifEvent): void {
  staffBus.emit('staff_notification', evt);
}

export function onStaffNotification(fn: (evt: StaffNotifEvent) => void): () => void {
  staffBus.on('staff_notification', fn);
  return () => staffBus.off('staff_notification', fn);
}
