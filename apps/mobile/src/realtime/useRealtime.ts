import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/context';
import { getAccessToken } from '@/auth/store';
import { API_BASE_URL } from '@/lib/config';

/**
 * Live updates over WebSocket (backend G3). Connects to /api/ws with the access
 * token, and on each server event invalidates the relevant React Query caches
 * so screens refetch instantly. Polling stays as a backstop if the socket drops.
 */
function toWsUrl(token: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws'); // http→ws, https→wss
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

interface ServerEvent {
  type: 'connected' | 'message' | 'conversation' | 'notification' | 'booking';
  conversationId?: string;
}

export function useRealtime(): void {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    stoppedRef.current = false;
    let attempts = 0;

    async function connect(): Promise<void> {
      const token = await getAccessToken();
      if (!token || stoppedRef.current) return;

      const ws = new WebSocket(toWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
      };

      ws.onmessage = (e) => {
        let ev: ServerEvent;
        try {
          ev = JSON.parse(typeof e.data === 'string' ? e.data : '');
        } catch {
          return;
        }
        switch (ev.type) {
          case 'message':
            qc.invalidateQueries({ queryKey: ['conversations'] });
            if (ev.conversationId) qc.invalidateQueries({ queryKey: ['messages', ev.conversationId] });
            break;
          case 'notification':
            qc.invalidateQueries({ queryKey: ['notifications'] });
            qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
            qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
            break;
          case 'conversation':
          case 'booking':
            qc.invalidateQueries({ queryKey: ['conversations'] });
            qc.invalidateQueries({ queryKey: ['bookings'] });
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        if (stoppedRef.current) return;
        attempts += 1;
        const delay = Math.min(30_000, 1000 * 2 ** attempts); // capped exponential backoff
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // onclose handles reconnect
        }
      };
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, [isAuthenticated, qc]);
}
