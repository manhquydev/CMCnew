import { useEffect, useRef, useState } from 'react';
import { API_URL } from './client.js';

/** A realtime notification pushed over SSE (mirror of the server's NotificationEvent.notification). */
export interface LiveNotification {
  id: string;
  type: string;
  payload: {
    submissionId?: string;
    score?: number;
    exercise?: string;
    starsEarned?: number;
    badgeId?: string;
    badge?: string;
  };
  createdAt: string;
}

/**
 * Subscribe to the LMS realtime notification stream. The browser EventSource sends the LMS
 * session cookie (withCredentials); the server filters to the principal's own students.
 * `onNotify` fires for each event — use it to refetch grades/stars so they appear live.
 */
export function useNotificationStream(onNotify: (n: LiveNotification) => void): {
  latest: LiveNotification | null;
  connected: boolean;
} {
  const [latest, setLatest] = useState<LiveNotification | null>(null);
  const [connected, setConnected] = useState(false);
  // Keep the callback fresh without re-opening the stream on every render.
  const cb = useRef(onNotify);
  cb.current = onNotify;

  useEffect(() => {
    const es = new EventSource(`${API_URL}/sse/notifications`, { withCredentials: true });
    es.addEventListener('ready', () => setConnected(true));
    es.addEventListener('notification', (e) => {
      try {
        const n = JSON.parse((e as MessageEvent).data) as LiveNotification;
        setLatest(n);
        cb.current(n);
      } catch {
        /* ignore malformed frame */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return { latest, connected };
}
