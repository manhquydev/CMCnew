import { notifications } from '@mantine/notifications';

// tRPC falls back to the bare code name as the error message when a procedure throws
// `new TRPCError({ code })` with no custom `message` — that raw code (e.g. "FORBIDDEN") would
// otherwise reach a non-technical end user verbatim. Translate the common ones.
const TRPC_CODE_FALLBACK: Record<string, string> = {
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  UNAUTHORIZED: 'Vui lòng đăng nhập lại để tiếp tục.',
  NOT_FOUND: 'Không tìm thấy dữ liệu.',
  BAD_REQUEST: 'Yêu cầu không hợp lệ.',
  CONFLICT: 'Dữ liệu đã thay đổi, vui lòng tải lại trang.',
  PRECONDITION_FAILED: 'Không thể thực hiện — thiếu điều kiện cần thiết.',
  INTERNAL_SERVER_ERROR: 'Lỗi hệ thống. Vui lòng thử lại sau.',
  TOO_MANY_REQUESTS: 'Thao tác quá nhanh, vui lòng thử lại sau ít phút.',
};

/** Pull a human-readable message out of a tRPC error, Error, or anything thrown. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; shape?: { message?: unknown; data?: { code?: unknown } } };
    const rawMessage = (typeof e.shape?.message === 'string' && e.shape.message) || (typeof e.message === 'string' && e.message) || '';
    const code = e.shape?.data?.code;
    // A message that IS the bare code name (trpc's own no-custom-message fallback) is not
    // actually human-readable — prefer the translated code over echoing it verbatim.
    if (typeof code === 'string' && (rawMessage === code || !rawMessage) && TRPC_CODE_FALLBACK[code]) {
      return TRPC_CODE_FALLBACK[code];
    }
    if (rawMessage) return rawMessage;
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
