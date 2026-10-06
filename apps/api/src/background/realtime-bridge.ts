/**
 * Live-update relay for split deployments (PROCESS_ROLE=api + worker).
 *
 * services/realtime.ts fans events out to WebSocket clients held in the API
 * process's memory. Work done by the worker (inbound messages, hold expiry,
 * notifications) calls publish() there, where nobody is listening. The worker
 * installs a forwarder that PUBLISHes to Redis; the API subscribes and replays
 * into its local fan-out. In a single process neither side is installed.
 */

import type IORedis from 'ioredis';
import { publish, setRealtimeForwarder, type RealtimeEvent } from '../services/realtime.js';

export const REALTIME_CHANNEL = 'bookly:realtime';

const EVENT_TYPES = new Set(['connected', 'message', 'conversation', 'notification', 'booking']);

/** Worker side. Returns an uninstall function. */
export function installRealtimeForwarder(redis: Pick<IORedis, 'publish'>): () => void {
    setRealtimeForwarder((tenantId, event) => {
        Promise.resolve(redis.publish(REALTIME_CHANNEL, JSON.stringify({ tenantId, event }))).catch(() => undefined);
    });
    return () => setRealtimeForwarder(null);
}

function parse(raw: string): { tenantId: string; event: RealtimeEvent } | null {
    try {
        const msg = JSON.parse(raw);
        if (!msg || typeof msg.tenantId !== 'string' || !msg.tenantId) return null;
        if (!msg.event || typeof msg.event.type !== 'string' || !EVENT_TYPES.has(msg.event.type)) return null;
        return { tenantId: msg.tenantId, event: msg.event as RealtimeEvent };
    } catch {
        return null;
    }
}

/**
 * API side. `sub` must be a connection dedicated to subscribing (an ioredis
 * connection in subscriber mode cannot run other commands). Returns stop().
 */
export function startRealtimeSubscriber(
    sub: Pick<IORedis, 'subscribe' | 'on' | 'unsubscribe' | 'quit'>,
): () => Promise<void> {
    sub.on('message', (channel: string, raw: string) => {
        if (channel !== REALTIME_CHANNEL) return;
        const msg = parse(raw);
        if (msg) publish(msg.tenantId, msg.event);
    });
    void Promise.resolve(sub.subscribe(REALTIME_CHANNEL)).catch(() => undefined);
    return async () => {
        await Promise.resolve(sub.unsubscribe(REALTIME_CHANNEL)).catch(() => undefined);
        await Promise.resolve(sub.quit()).catch(() => undefined);
    };
}
