import { notifications } from '@mantine/notifications';

/** Pull a human-readable message out of a tRPC error, Error, or anything thrown. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; shape?: { message?: unknown } };
    if (typeof e.shape?.message === 'string' && e.shape.message) return e.shape.message;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}

/** Red toast for a caught error. Use inside `.catch(notifyError)` or `catch (e) { notifyError(e) }`. */
export function notifyError(err: unknown, title = 'Lỗi'): void {
  notifications.show({ color: 'cmcRed', title, message: errorMessage(err) });
}

/** Green toast confirming an action succeeded. */
export function notifySuccess(message: string, title = 'Thành công'): void {
  notifications.show({ color: 'cmcGreen', title, message });
}

/** Neutral informational toast. */
export function notifyInfo(message: string, title?: string): void {
  notifications.show({ color: 'cmc', title, message });
}
