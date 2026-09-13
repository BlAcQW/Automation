import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'expo-router';
import { useAuth } from '@/auth/context';
import { getAccessToken } from '@/auth/store';
import { api } from '@/api/client';
import type { AppNotification } from '@/api/types';
import { API_BASE_URL } from '@/lib/config';
import { useNotice, type InAppNotice } from '@/components/InAppNotice';

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

/**
 * Banner presentation for each notification type. Anything unmapped (including
 * new server-side types) still shows, falling back to the generic bell and the
 * notifications list.
 */
function noticeFor(n: AppNotification): InAppNotice {
  const bookingId = typeof n.metadata?.bookingId === 'string' ? n.metadata.bookingId : undefined;
  const orderId = typeof n.metadata?.orderId === 'string' ? n.metadata.orderId : undefined;

  // Payments ride on the SYSTEM type (no enum member for them yet) and are
  // identified by metadata.kind, set in services/payment-fulfillment.ts.
  if (n.metadata?.kind === 'payment') {
    return {
      key: n.id,
      title: n.title,
      body: n.message,
      icon: 'card',
      href: orderId ? `/orders/${orderId}` : bookingId ? `/bookings/${bookingId}` : '/notifications',
    };
  }

  switch (n.type) {
    case 'NEW_BOOKING':
      return {
        key: n.id,
        title: n.title,
        body: n.message,
        icon: 'calendar',
        href: bookingId ? `/bookings/${bookingId}` : '/(tabs)/bookings',
      };
    case 'BOOKING_CANCELLED':
      return {
        key: n.id,
        title: n.title,
        body: n.message,
        icon: 'close-circle',
        href: bookingId ? `/bookings/${bookingId}` : '/(tabs)/bookings',
      };
    case 'NEW_CONVERSATION':
      return { key: n.id, title: n.title, body: n.message, icon: 'chatbubbles', href: '/(tabs)/chats' };
    default:
      return { key: n.id, title: n.title, body: n.message, icon: 'notifications', href: '/notifications' };
  }
}

export function useRealtime(): void {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const notify = useNotice();
  const pathname = usePathname();

  // Read inside the socket handler without re-subscribing on every navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
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
            // Don't interrupt someone already reading that very conversation.
            if (ev.conversationId && !pathnameRef.current.includes(ev.conversationId)) {
              notifyRef.current({
                key: `message:${ev.conversationId}`,
                title: 'New reply',
                body: 'A customer just replied to your chat.',
                icon: 'chatbubble-ellipses',
                href: `/conversations/${ev.conversationId}`,
              });
            }
            break;
          case 'notification':
            qc.invalidateQueries({ queryKey: ['notifications'] });
            qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
            qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
            // The socket event is a bare signal, so fetch the row it refers to
            // and show its real title/message.
            void (async () => {
              try {
                const data = (await api.get('/notifications')).data;
                const list: AppNotification[] = Array.isArray(data) ? data : (data?.items ?? []);
                const latest = list[0];
                if (latest) notifyRef.current(noticeFor(latest));
              } catch {
                // A banner is best-effort; the cache invalidation above already
                // refreshed the badge and list.
              }
            })();
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
