import { EventEmitter } from 'node:events';

/** One realtime notification, already resolved to its owning student. */
export interface NotificationEvent {
  /** Student the notification belongs to; SSE handlers filter on the principal's owned ids. */
  studentId: string;
  notification: {
    id: string;
    type: string;
    payload: unknown;
    createdAt: string;
  };
}

// In-process fan-out bus: mutations emit after commit, the SSE route subscribes per
// connection. setMaxListeners(0) — one listener per live SSE client, so the default
// cap of 10 would warn under normal load; connections are cleaned up on abort.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitNotification(evt: NotificationEvent): void {
  bus.emit('notification', evt);
}

export function onNotification(fn: (evt: NotificationEvent) => void): () => void {
  bus.on('notification', fn);
  return () => bus.off('notification', fn);
}
