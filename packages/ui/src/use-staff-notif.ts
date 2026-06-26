import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from './client.js';
import { notifyError } from './notify.js';

/**
 * Minimal UI-facing shape of a staff notification.
 * Dates are ISO strings after JSON serialisation through tRPC's httpBatchLink.
 */
export interface StaffNotifItem {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * Polls unread count every 30 s; fetches full list on demand (call `fetchList`
 * when opening the popover so the first poll is deferred until needed).
 *
 * @param facilityId - Scope notifications to this facility. Pass `null` to skip
 *   all network calls (e.g. super-admin accounts with no facility assignment).
 */
export function useStaffNotif(facilityId: number | null) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<StaffNotifItem[]>([]);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track when markAllRead last completed so stale fetchList responses don't
  // re-show notifications the user already dismissed (race condition guard).
  const lastMarkedAtRef = useRef<number>(0);

  const fetchUnread = useCallback(() => {
    if (!facilityId) return;
    void trpc.staffNotif.unreadCount
      .query({ facilityId })
      .then(setUnreadCount)
      .catch(() => {
        /* keep stale count on transient network error */
      });
  }, [facilityId]);

  const fetchList = useCallback(() => {
    if (!facilityId) return;
    const fetchedAt = Date.now();
    // Cast via unknown: the Prisma `data: Json` field creates a recursive type that
    // overflows TS's instantiation depth when inferred through the tRPC client type.
    void (trpc.staffNotif.list.query({ facilityId }) as unknown as Promise<StaffNotifItem[]>)
      .then((data) => {
        // Discard if markAllRead completed after this fetch started — would re-show cleared items.
        if (fetchedAt >= lastMarkedAtRef.current) {
          setNotifications(data);
        }
      })
      .catch(() => {
        /* keep stale list on transient network error */
      });
  }, [facilityId]);

  useEffect(() => {
    fetchUnread();
    intervalRef.current = setInterval(fetchUnread, 30_000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchUnread]);

  const markAllRead = useCallback(() => {
    if (!facilityId) return;
    setIsMarkingAll(true);
    void trpc.staffNotif.markAllRead
      .mutate({ facilityId })
      .then(() => {
        lastMarkedAtRef.current = Date.now();
        setUnreadCount(0);
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
        );
      })
      .catch((err: unknown) => {
        notifyError(err instanceof Error ? err.message : 'Không thể đánh dấu đã đọc. Thử lại sau.');
      })
      .finally(() => setIsMarkingAll(false));
  }, [facilityId]);

  return {
    unreadCount,
    notifications,
    fetchList,
    markAllRead,
    isMarkingAll,
  };
}
