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

export function publish(tenantId: string, event: RealtimeEvent): void {
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
