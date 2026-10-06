import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../crypto.js', () => ({ encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') }));

import {
    BACKOFF_MS, CLAIM_STUCK_MS, MAX_IN_FLIGHT_PER_TENANT, DEFER_MS, MAX_ATTEMPTS, PENDING_STALE_MS, PURGE_BATCH, RETENTION_MS,
    backoffMs, claimDelivery, dispatchDelivery, processDelivery, purgeEvents, sweepDeliveries,
} from './delivery.js';
import { verifySignature } from './signing.js';
import { fakeEventsPrisma, silentLog } from './testing.js';

const SECRET = 'whsec_abc';
function setup(delivery: object = {}, sub: object = {}) {
    return fakeEventsPrisma({
        subs: [{ id: 's1', tenantId: 't1', url: 'https://hooks.example.com/in', secretEnc: `enc(${SECRET})`, isActive: true, events: ['*'], ...sub }],
        events: [{ id: 'e1', tenantId: 't1', type: 'payment.succeeded', payload: { v: 1, paymentId: 'p1' }, createdAt: new Date('2026-10-06T00:00:00Z') }],
        deliveries: [{ id: 'd1', tenantId: 't1', subscriptionId: 's1', eventId: 'e1', status: 'PENDING', attempts: 0, nextAttemptAt: null, claimedAt: null, createdAt: new Date(), ...delivery }],
    });
}
const ok = (statusCode = 200) => vi.fn(async () => ({ statusCode, bodyBytes: 0 }));

beforeEach(() => { vi.clearAllMocks(); });

describe('backoff', () => {
    it('follows 30s,2m,10m,30m,1h,3h and holds', () => {
        expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000]);
        expect(backoffMs(1)).toBe(30_000);
        expect(backoffMs(6)).toBe(10_800_000);
        expect(backoffMs(8)).toBe(10_800_000);
        expect(backoffMs(0)).toBe(30_000);
    });
});

describe('claim', () => {
    it('is atomic: only one of two concurrent claims wins and attempts is incremented once', async () => {
        const prisma = setup();
        const [a, b] = await Promise.all([claimDelivery(prisma, 'd1'), claimDelivery(prisma, 'd1')]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        expect(prisma.webhookDelivery.rows[0]).toMatchObject({ attempts: 1, status: 'PENDING' });
        expect(prisma.webhookDelivery.rows[0].claimedAt).toBeInstanceOf(Date);
    });
    it('does not claim before nextAttemptAt, or finished rows', async () => {
        expect(await claimDelivery(setup({ nextAttemptAt: new Date(Date.now() + 60_000) }), 'd1')).toBeNull();
        expect(await claimDelivery(setup({ status: 'SUCCEEDED' }), 'd1')).toBeNull();
    });
});

describe('processDelivery', () => {
    it('POSTs the signed envelope with the Bookly headers and marks SUCCEEDED on 2xx', async () => {
        const prisma = setup();
        const post = ok(204);
        expect(await processDelivery({ prisma, log: silentLog, post }, 'd1')).toBe('succeeded');

        const call = (post.mock.calls[0] as any[])[0];
        expect(call.url).toBe('https://hooks.example.com/in');
        expect(call.headers['X-Bookly-Event']).toBe('payment.succeeded');
        expect(call.headers['X-Bookly-Delivery']).toBe('d1');
        expect(verifySignature({ secret: SECRET, header: call.headers['X-Bookly-Signature'], rawBody: call.body })).toEqual({ ok: true });
        expect(JSON.parse(call.body)).toEqual({
            id: 'e1', type: 'payment.succeeded', tenantId: 't1', createdAt: '2026-10-06T00:00:00.000Z', data: { v: 1, paymentId: 'p1' },
        });
        expect(prisma.webhookDelivery.rows[0]).toMatchObject({ status: 'SUCCEEDED', lastStatusCode: 204, claimedAt: null, lastError: null });
        expect(prisma.webhookDelivery.rows[0].deliveredAt).toBeInstanceOf(Date);
    });

    it('does nothing for a delivery someone else claimed', async () => {
        const post = ok();
        expect(await processDelivery({ prisma: setup({ claimedAt: new Date() }), log: silentLog, post }, 'd1')).toBe('skipped');
        expect(post).not.toHaveBeenCalled();
    });

    it.each([500, 404, 302, 429])('treats HTTP %i as a retryable failure with backoff', async (code) => {
        const prisma = setup();
        const queue = { add: vi.fn(async () => ({}) as any) };
        const before = Date.now();
        expect(await processDelivery({ prisma, log: silentLog, post: ok(code), queue }, 'd1')).toBe('retry');
        const row = prisma.webhookDelivery.rows[0];
        expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastStatusCode: code, lastError: `HTTP ${code}`, claimedAt: null });
        expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
        expect(queue.add).toHaveBeenCalledWith('deliver', { id: 'd1' }, expect.objectContaining({ delay: 30_000 }));
        expect(prisma.platformAlert.upsert).not.toHaveBeenCalled();
    });

    it('records network/SSRF errors without a status code and retries', async () => {
        const prisma = setup();
        const post = vi.fn(async () => { throw new Error('Webhook host resolves to a private or reserved address'); });
        expect(await processDelivery({ prisma, log: silentLog, post, queue: { add: vi.fn() as any } }, 'd1')).toBe('retry');
        expect(prisma.webhookDelivery.rows[0]).toMatchObject({ lastStatusCode: null });
        expect(prisma.webhookDelivery.rows[0].lastError).toMatch(/private or reserved/);
    });

    it('uses a longer delay on later attempts', async () => {
        const prisma = setup({ attempts: 2 });
        const queue = { add: vi.fn(async () => ({}) as any) };
        await processDelivery({ prisma, log: silentLog, post: ok(500), queue }, 'd1');
        expect(queue.add).toHaveBeenCalledWith('deliver', { id: 'd1' }, expect.objectContaining({ delay: 600_000 }));
    });

    it('gives up after MAX_ATTEMPTS: FAILED, no retry scheduled, one deduped warning alert for the subscription', async () => {
        expect(MAX_ATTEMPTS).toBe(8);
        const prisma = setup({ attempts: MAX_ATTEMPTS - 1 });
        const queue = { add: vi.fn() };
        expect(await processDelivery({ prisma, log: silentLog, post: ok(503), queue: queue as any }, 'd1')).toBe('failed');
        expect(prisma.webhookDelivery.rows[0]).toMatchObject({ status: 'FAILED', attempts: 8, nextAttemptAt: null, claimedAt: null });
        expect(queue.add).not.toHaveBeenCalled();
        const alert = (prisma.platformAlert.upsert.mock.calls[0] as any[])[0];
        expect(alert.where.dedupeKey).toBe('webhook.delivery_failed:s1');
        expect(alert.create).toMatchObject({ kind: 'webhook.delivery_failed', severity: 'warning', tenantId: 't1' });
    });

    it('fails (no alert) when the subscription is gone or disabled', async () => {
        const prisma = setup({}, { isActive: false });
        const post = ok();
        expect(await processDelivery({ prisma, log: silentLog, post }, 'd1')).toBe('failed');
        expect(post).not.toHaveBeenCalled();
        expect(prisma.webhookDelivery.rows[0].status).toBe('FAILED');
        expect(prisma.platformAlert.upsert).not.toHaveBeenCalled();
    });

    it('survives a result-write failure (row stays claimed for the sweep)', async () => {
        const prisma = setup();
        const real = prisma.webhookDelivery.updateMany.getMockImplementation()!;
        prisma.webhookDelivery.updateMany.mockImplementationOnce(real).mockRejectedValueOnce(new Error('db down'));
        await expect(processDelivery({ prisma, log: silentLog, post: ok() }, 'd1')).resolves.toBe('succeeded');
        expect(prisma.webhookDelivery.rows[0].claimedAt).toBeInstanceOf(Date);
    });
});

describe('dispatchDelivery', () => {
    it('enqueues with the delivery id as jobId and a fresh id for delayed retries', async () => {
        const queue = { add: vi.fn(async () => ({}) as any) };
        await dispatchDelivery({ prisma: {}, log: silentLog, queue }, 'd9');
        expect(queue.add).toHaveBeenCalledWith('deliver', { id: 'd9' }, expect.objectContaining({ jobId: 'd9' }));
        await dispatchDelivery({ prisma: {}, log: silentLog, queue }, 'd9', 5000);
        expect((queue.add.mock.calls[1] as any[])[2].jobId).toMatch(/^d9-d\d+$/);
    });
});

describe('sweep', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    it('re-dispatches due retries and stale never-picked-up rows, leaves fresh and in-flight ones', async () => {
        const prisma = fakeEventsPrisma({
            deliveries: [
                { id: 'due', status: 'PENDING', claimedAt: null, nextAttemptAt: new Date(now.getTime() - 1000), createdAt: now },
                { id: 'future', status: 'PENDING', claimedAt: null, nextAttemptAt: new Date(now.getTime() + 60_000), createdAt: now },
                { id: 'stale', status: 'PENDING', claimedAt: null, nextAttemptAt: null, createdAt: new Date(now.getTime() - PENDING_STALE_MS - 1) },
                { id: 'fresh', status: 'PENDING', claimedAt: null, nextAttemptAt: null, createdAt: new Date(now.getTime() - 1000) },
                { id: 'inflight', status: 'PENDING', claimedAt: new Date(now.getTime() - 1000), nextAttemptAt: null, createdAt: new Date(0) },
                { id: 'done', status: 'SUCCEEDED', claimedAt: null, nextAttemptAt: null, createdAt: new Date(0) },
            ],
        });
        const dispatch = vi.fn(async () => undefined);
        const res = await sweepDeliveries({ prisma, log: silentLog, dispatch }, now);
        expect(dispatch.mock.calls.map((c) => (c as any[])[0]).sort()).toEqual(['due', 'stale']);
        expect(res.requeued).toBe(2);
    });

    it('recovers rows orphaned mid-delivery, failing + alerting those out of attempts', async () => {
        const old = new Date(now.getTime() - CLAIM_STUCK_MS - 1);
        const prisma = fakeEventsPrisma({
            deliveries: [
                { id: 'orph', tenantId: 't1', subscriptionId: 's1', status: 'PENDING', claimedAt: old, attempts: 2, createdAt: now },
                { id: 'spent', tenantId: 't1', subscriptionId: 's2', status: 'PENDING', claimedAt: old, attempts: MAX_ATTEMPTS, createdAt: now },
            ],
        });
        const dispatch = vi.fn(async () => undefined);
        const res = await sweepDeliveries({ prisma, log: silentLog, dispatch }, now);
        expect(res.recovered).toBe(1);
        const rows = Object.fromEntries(prisma.webhookDelivery.rows.map((r: any) => [r.id, r]));
        expect(rows.orph).toMatchObject({ status: 'PENDING', claimedAt: null });
        expect(rows.spent.status).toBe('FAILED');
        expect((prisma.platformAlert.upsert.mock.calls[0] as any[])[0].where.dedupeKey).toBe('webhook.delivery_failed:s2');
        expect(dispatch).toHaveBeenCalledWith('orph'); // picked up in the same sweep (nextAttemptAt = now)
    });
});

describe('retention purge', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const old = new Date(now.getTime() - RETENTION_MS - 1000);
    it('deletes old SUCCEEDED deliveries and old events; keeps recent ones', async () => {
        const prisma = fakeEventsPrisma({
            deliveries: [
                { id: 'old-ok', status: 'SUCCEEDED', createdAt: old },
                { id: 'new-ok', status: 'SUCCEEDED', createdAt: now },
                { id: 'old-failed', status: 'FAILED', createdAt: old },
            ],
            events: [{ id: 'e-old', createdAt: old }, { id: 'e-new', createdAt: now }],
        });
        const res = await purgeEvents({ prisma, log: silentLog }, now);
        expect(res).toEqual({ deliveries: 1, events: 1 });
        expect(prisma.webhookDelivery.rows.map((r: any) => r.id).sort()).toEqual(['new-ok', 'old-failed']);
        expect(prisma.domainEvent.rows.map((r: any) => r.id)).toEqual(['e-new']);
    });
    it('is bounded per batch', async () => {
        const prisma = fakeEventsPrisma({ deliveries: Array.from({ length: PURGE_BATCH + 5 }, (_, i) => ({ id: `x${i}`, status: 'SUCCEEDED', createdAt: old })) });
        await purgeEvents({ prisma, log: silentLog }, now);
        const takes = prisma.webhookDelivery.findMany.mock.calls.map((c: any[]) => c[0].take);
        expect(takes.every((t: number) => t === PURGE_BATCH)).toBe(true);
        expect(prisma.webhookDelivery.rows).toHaveLength(0);
    });
});

describe('per-tenant fairness', () => {
    const row = (id: string, tenantId: string, over: object = {}) => ({
        id, tenantId, subscriptionId: `s-${tenantId}`, eventId: `e-${tenantId}`, status: 'PENDING', attempts: 0,
        nextAttemptAt: null, claimedAt: null, createdAt: new Date(), ...over,
    });
    const fixture = (deliveries: object[]) => fakeEventsPrisma({
        subs: ['t1', 't2'].map((t) => ({ id: `s-${t}`, tenantId: t, url: 'https://hooks.example.com/in', secretEnc: `enc(${SECRET})`, isActive: true, events: ['*'] })),
        events: ['t1', 't2'].map((t) => ({ id: `e-${t}`, tenantId: t, type: 'booking.created', payload: { v: 1 }, createdAt: new Date() })),
        deliveries: deliveries as any[],
    });
    const inFlight = (n: number, tenantId = 't1') => Array.from({ length: n }, (_, i) => row(`busy-${tenantId}-${i}`, tenantId, { claimedAt: new Date(), attempts: 1 }));

    it('caps in-flight deliveries per tenant at a small number', () => {
        expect(MAX_IN_FLIGHT_PER_TENANT).toBe(3);
    });

    it('defers (does not drop, does not burn an attempt) a delivery when the tenant is at its cap', async () => {
        const prisma = fixture([...inFlight(MAX_IN_FLIGHT_PER_TENANT), row('d-new', 't1')]);
        const post = ok();
        const queue = { add: vi.fn(async () => ({}) as any) };
        expect(await processDelivery({ prisma, log: silentLog, post, queue }, 'd-new')).toBe('deferred');
        expect(post).not.toHaveBeenCalled();
        const d = prisma.webhookDelivery.rows.find((r: any) => r.id === 'd-new');
        expect(d).toMatchObject({ status: 'PENDING', attempts: 0, claimedAt: null });
        expect(d.nextAttemptAt).toBeInstanceOf(Date);
        expect(queue.add).toHaveBeenCalledWith('deliver', { id: 'd-new' }, expect.objectContaining({ delay: expect.any(Number) }));
        const delay = (queue.add.mock.calls[0] as any[])[2].delay;
        expect(delay).toBeGreaterThanOrEqual(DEFER_MS);
        expect(delay).toBeLessThan(DEFER_MS * 2);
    });

    it('delivers while the tenant is under its cap', async () => {
        const prisma = fixture([...inFlight(MAX_IN_FLIGHT_PER_TENANT - 1), row('d-new', 't1')]);
        expect(await processDelivery({ prisma, log: silentLog, post: ok() }, 'd-new')).toBe('succeeded');
    });

    it('one tenant saturating its cap does not stop another tenant', async () => {
        const prisma = fixture([...inFlight(MAX_IN_FLIGHT_PER_TENANT + 2), row('d-t2', 't2')]);
        expect(await processDelivery({ prisma, log: silentLog, post: ok() }, 'd-t2')).toBe('succeeded');
    });

    it('ignores orphaned claims older than the stuck threshold when counting', async () => {
        const stale = new Date(Date.now() - CLAIM_STUCK_MS - 1000);
        const orphans = Array.from({ length: 5 }, (_, i) => row(`orphan-${i}`, 't1', { claimedAt: stale, attempts: 1 }));
        const prisma = fixture([...orphans, row('d-new', 't1')]);
        expect(await processDelivery({ prisma, log: silentLog, post: ok() }, 'd-new')).toBe('succeeded');
    });

    it('a deferred delivery is delivered later once capacity frees up (sweep picks it up)', async () => {
        const prisma = fixture([...inFlight(MAX_IN_FLIGHT_PER_TENANT), row('d-new', 't1')]);
        await processDelivery({ prisma, log: silentLog, post: ok() }, 'd-new');
        prisma.webhookDelivery.rows.splice(0, MAX_IN_FLIGHT_PER_TENANT); // the busy ones finish
        const dispatched: string[] = [];
        await sweepDeliveries({ prisma, log: silentLog, dispatch: (id) => { dispatched.push(id); } }, new Date(Date.now() + 60_000));
        expect(dispatched).toContain('d-new');
        prisma.webhookDelivery.rows.find((r: any) => r.id === 'd-new').nextAttemptAt = new Date(0); // the deferral has elapsed
        expect(await processDelivery({ prisma, log: silentLog, post: ok() }, 'd-new')).toBe('succeeded');
    });
});
