/**
 * Idempotency for POST /v1/messages.
 *
 * GUARANTEE (for one tenant + Idempotency-Key, within 24 hours): at most one
 * message is sent to the customer, and a retry of the same request gets the
 * original outcome instead of a second send.
 *
 * HOW
 *  1. A Postgres advisory TRY-lock keyed on (tenant, key), transaction-scoped,
 *     is held from lookup through send to store. Try, not wait: a concurrent
 *     request with the same key gets 409 idempotency_in_progress immediately
 *     instead of parking a pooled connection. The client retries shortly.
 *  2. Under the lock the key is looked up among the tenant's OUTBOUND messages
 *     of the last 24h. Found with the same conversation + text: replay it.
 *     Found with different content: 409 idempotency_key_reused.
 *  3. If the send succeeded but the message row could not be stored (or the
 *     transaction failed to commit), the row is missing, so step 2 cannot see
 *     it and the lock is gone. A "sent" marker (24h TTL; Redis when configured,
 *     otherwise this process's memory) records (tenant, key, fingerprint). A
 *     retry finds the marker and answers `recorded: false` without resending.
 *
 * LIMITS (documented in docs/API.md)
 *  - Keys are honoured for 24 hours; after that the same key sends again.
 *  - The marker in step 3 is best-effort: without Redis it is per API process
 *    and lost on restart, so a retry after a store failure AND a restart (or
 *    on another instance) can send twice. This only matters when the database
 *    write failed right after a successful send.
 *  - The key is per tenant, shared across that tenant's API keys.
 */

import crypto from 'node:crypto';
import { ApiError } from './shared.js';

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MARKER_TTL_SECONDS = IDEMPOTENCY_WINDOW_MS / 1000;
const MAX_MEMORY_MARKERS = 10_000;

/** What a request is "about": same conversation and text means the same request. */
export function fingerprint(conversationId: string, text: string): string {
    return crypto.createHash('sha256').update(`${conversationId}\u0000${text}`).digest('hex');
}

export function lockKey(tenantId: string, key: string): string {
    return `v1-message-idem:${tenantId}:${key}`;
}

export function reusedError(): ApiError {
    return new ApiError(
        409,
        'idempotency_key_reused',
        'This Idempotency-Key was already used with a different request. Use a new key for a new message.',
    );
}

export function inProgressError(): ApiError {
    return new ApiError(
        409,
        'idempotency_in_progress',
        'A request with this Idempotency-Key is still being processed. Retry in a moment.',
    );
}

/** Take the per-(tenant, key) lock for the rest of the transaction; throws 409 when someone holds it. */
export async function acquireKeyLock(tx: any, tenantId: string, key: string): Promise<void> {
    const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey(tenantId, key)}, 0)) AS locked`;
    const locked = Array.isArray(rows) && rows[0]?.locked === true;
    if (!locked) throw inProgressError();
}

export interface SentMarkers {
    get(tenantId: string, key: string): Promise<string | null>;
    set(tenantId: string, key: string, fp: string): Promise<void>;
}

/** Redis when available (shared across instances), process memory otherwise. Never throws. */
export function createSentMarkers(redis: { get(k: string): Promise<string | null>; set(...a: any[]): Promise<unknown> } | null | undefined): SentMarkers {
    const memory = new Map<string, { fp: string; expiresAt: number }>();
    const k = (tenantId: string, key: string) => `v1:idem-sent:${tenantId}:${key}`;
    return {
        async get(tenantId, key) {
            if (redis) {
                try {
                    const v = await redis.get(k(tenantId, key));
                    if (v) return v;
                } catch { /* fall through to memory */ }
            }
            const m = memory.get(k(tenantId, key));
            if (!m) return null;
            if (m.expiresAt <= Date.now()) { memory.delete(k(tenantId, key)); return null; }
            return m.fp;
        },
        async set(tenantId, key, fp) {
            // Always remember locally too: it covers a Redis outage.
            if (memory.size >= MAX_MEMORY_MARKERS) {
                const oldest = memory.keys().next().value;
                if (oldest !== undefined) memory.delete(oldest);
            }
            memory.set(k(tenantId, key), { fp, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
            if (redis) {
                try { await redis.set(k(tenantId, key), fp, 'EX', MARKER_TTL_SECONDS); } catch { /* memory copy remains */ }
            }
        },
    };
}
