/**
 * In-memory per-tenant realtime fan-out for the WebSocket live feed.
 * Single-process (one PM2 fork) pub/sub: the mobile app subscribes over
 * /ws and the server publishes lightweight events (new message, new
 * notification) so clients can refetch instead of polling.
 *
 * Pure of Fastify — the WS route (routes/realtime) wires sockets to it.
 */

export interface RealtimeClient {
    send: (data: string) => void;
}

export type RealtimeEvent =
    | { type: 'connected' }
    | { type: 'message'; conversationId: string }
    | { type: 'conversation' }
    | { type: 'notification' }
    | { type: 'booking' };

const tenants = new Map<string, Set<RealtimeClient>>();

export function registerClient(tenantId: string, client: RealtimeClient): () => void {
    let set = tenants.get(tenantId);
    if (!set) {
        set = new Set();
        tenants.set(tenantId, set);
    }
    set.add(client);

    return () => {
        const current = tenants.get(tenantId);
        if (!current) return;
        current.delete(client);
        if (current.size === 0) tenants.delete(tenantId);
    };
}

/**
 * Split deployments: background work runs in a worker process that has no
 * sockets. It installs a forwarder (background/realtime-bridge.ts) that relays
 * every publish to the API process over Redis. Unset in a single process.
 */
export type RealtimeForwarder = (tenantId: string, event: RealtimeEvent) => void;
let forwarder: RealtimeForwarder | null = null;

export function setRealtimeForwarder(fn: RealtimeForwarder | null): void {
    forwarder = fn;
}

export function publish(tenantId: string, event: RealtimeEvent): void {
    if (forwarder) {
        try {
            forwarder(tenantId, event);
        } catch {
            // Live updates are best-effort; never fail the caller's work.
        }
    }
    const set = tenants.get(tenantId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(event);
    for (const client of set) {
        try {
            client.send(payload);
        } catch {
            // A dead socket is cleaned up by its own close handler; ignore here.
        }
    }
}

// Test/introspection helper.
export function connectionCount(tenantId: string): number {
    return tenants.get(tenantId)?.size ?? 0;
}
