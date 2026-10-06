import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';

vi.mock('../../services/crypto.js', () => ({ encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, '$1') }));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async () => undefined) }));
// Real validateWebhookUrl, but DNS is faked: names resolve to a public address unless they start with "internal".
vi.mock('../../services/events/ssrf.js', async (orig) => {
    const real = await orig<typeof import('../../services/events/ssrf.js')>();
    const resolver = async (h: string) => [{ address: h.startsWith('internal') ? '10.1.2.3' : '93.184.216.34', family: 4 }];
    return { ...real, validateWebhookUrl: (u: string) => real.validateWebhookUrl(u, resolver) };
});

import { fakeEventsPrisma } from '../../services/events/testing.js';
import { MAX_SUBSCRIPTIONS_PER_TENANT } from './index.js';

let app: FastifyInstance;
let prisma: ReturnType<typeof fakeEventsPrisma>;
let user: { userId: string; tenantId: string; role: 'OWNER' | 'STAFF' };
const URL_OK = 'https://hooks.example.com/in';

beforeAll(async () => {
    const { default: routes } = await import('./index.js');
    app = Fastify({ logger: false });
    await app.register(sensible);
    app.setErrorHandler((err, _req, reply) => {
        if (err instanceof ZodError) return reply.code(400).send({ error: 'validation' });
        reply.code((err as any).statusCode ?? 500).send({ error: err.message });
    });
    prisma = fakeEventsPrisma();
    app.decorate('prisma', new Proxy({}, { get: (_t, k) => (prisma as any)[k] }) as never);
    app.decorate('authenticate', async (request: any) => { request.user = user; });
    await app.register(routes as any, { prefix: '/webhooks' });
    await app.ready();
});
afterAll(async () => { await app?.close(); });
beforeEach(() => {
    prisma = fakeEventsPrisma();
    user = { userId: 'u1', tenantId: 't1', role: 'OWNER' };
});

const call = (method: string, url: string, payload?: unknown) => app.inject({ method: method as any, url, payload: payload as any });
const create = async (body: object = { url: URL_OK, events: ['booking.created'] }) => (await call('POST', '/webhooks', body));

describe('webhook routes', () => {
    it('is OWNER only', async () => {
        user = { ...user, role: 'STAFF' };
        for (const [m, u] of [['GET', '/webhooks'], ['POST', '/webhooks'], ['GET', '/webhooks/event-types'], ['PATCH', '/webhooks/x'], ['DELETE', '/webhooks/x'], ['POST', '/webhooks/x/test'], ['POST', '/webhooks/x/rotate-secret'], ['GET', '/webhooks/x/deliveries']]) {
            expect((await call(m, u, {})).statusCode, `${m} ${u}`).toBe(403);
        }
    });

    it('create returns the secret once, stores it encrypted, and never exposes it again', async () => {
        const res = await create();
        expect(res.statusCode).toBe(201);
        const { subscription, secret } = res.json();
        expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
        expect(subscription).not.toHaveProperty('secretEnc');
        expect(prisma.webhookSubscription.rows[0].secretEnc).toBe(`enc(${secret})`);

        const list = await call('GET', '/webhooks');
        expect(JSON.stringify(list.json())).not.toContain(secret);
        expect(JSON.stringify(list.json())).not.toContain('secretEnc');
        expect(list.json().subscriptions).toHaveLength(1);
    });

    it('rotate returns a new secret once and replaces the stored one', async () => {
        const { subscription, secret } = (await create()).json();
        const res = await call('POST', `/webhooks/${subscription.id}/rotate-secret`);
        expect(res.statusCode).toBe(200);
        expect(res.json().secret).not.toBe(secret);
        expect(prisma.webhookSubscription.rows[0].secretEnc).toBe(`enc(${res.json().secret})`);
        expect(res.json().subscription).not.toHaveProperty('secretEnc');
    });

    it('is scoped to the tenant: other tenants cannot see, change, delete, test or read deliveries', async () => {
        const { subscription } = (await create()).json();
        user = { ...user, tenantId: 't2' };
        expect((await call('GET', '/webhooks')).json().subscriptions).toHaveLength(0);
        for (const [m, u, b] of [
            ['PATCH', `/webhooks/${subscription.id}`, { isActive: false }], ['DELETE', `/webhooks/${subscription.id}`], ['POST', `/webhooks/${subscription.id}/test`],
            ['POST', `/webhooks/${subscription.id}/rotate-secret`], ['GET', `/webhooks/${subscription.id}/deliveries`],
        ] as const) {
            expect((await call(m, u, b)).statusCode, `${m} ${u}`).toBe(404);
        }
        expect(prisma.webhookSubscription.rows).toHaveLength(1);
        expect(prisma.webhookSubscription.rows[0].isActive).toBe(true);
        // every write/read was filtered by the caller's tenant
        for (const c of [...prisma.webhookSubscription.updateMany.mock.calls, ...prisma.webhookSubscription.deleteMany.mock.calls]) {
            expect((c[0] as any).where.tenantId).toBe('t2');
        }
    });

    it('rejects SSRF targets and bad schemes at create and update', async () => {
        for (const url of ['https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://internal.example.com/x', 'ftp://example.com', 'https://u:p@example.com/']) {
            const res = await create({ url, events: ['*'] });
            expect(res.statusCode, url).toBe(400);
        }
        expect(prisma.webhookSubscription.rows).toHaveLength(0);
        const { subscription } = (await create()).json();
        expect((await call('PATCH', `/webhooks/${subscription.id}`, { url: 'https://10.0.0.1/x' })).statusCode).toBe(400);
        expect(prisma.webhookSubscription.rows[0].url).toBe(URL_OK);
    });

    it('validates strictly: unknown events, empty events, extra keys, wrong types', async () => {
        for (const body of [
            { url: URL_OK, events: ['nope.event'] }, { url: URL_OK, events: [] }, { url: URL_OK }, { events: ['*'] },
            { url: URL_OK, events: ['*'], tenantId: 'other' }, { url: URL_OK, events: ['*'], secretEnc: 'x' },
            { url: 42, events: ['*'] }, { url: URL_OK, events: '*' }, { url: URL_OK, events: ['*'], description: 'x'.repeat(201) },
        ]) {
            expect((await create(body as any)).statusCode, JSON.stringify(body)).toBe(400);
        }
        const { subscription } = (await create()).json();
        expect((await call('PATCH', `/webhooks/${subscription.id}`, {})).statusCode).toBe(400);
        expect((await call('PATCH', `/webhooks/${subscription.id}`, { tenantId: 't2' })).statusCode).toBe(400);
    });

    it('accepts the wildcard and de-duplicates events', async () => {
        const res = await create({ url: URL_OK, events: ['*', 'booking.created', 'booking.created'] });
        expect(res.json().subscription.events).toEqual(['*', 'booking.created']);
    });

    it('caps subscriptions per tenant', async () => {
        for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_TENANT; i++) expect((await create()).statusCode).toBe(201);
        expect((await create()).statusCode).toBe(409);
        user = { ...user, tenantId: 't2' };
        expect((await create()).statusCode).toBe(201);
    });

    it('updates url/events/isActive and deletes', async () => {
        const { subscription } = (await create()).json();
        const res = await call('PATCH', `/webhooks/${subscription.id}`, { url: 'https://other.example.com/h', events: ['order.created'], isActive: false, description: null });
        expect(res.statusCode).toBe(200);
        expect(res.json().subscription).toMatchObject({ url: 'https://other.example.com/h', events: ['order.created'], isActive: false });
        expect((await call('DELETE', `/webhooks/${subscription.id}`)).statusCode).toBe(204);
        expect(prisma.webhookSubscription.rows).toHaveLength(0);
        expect((await call('DELETE', `/webhooks/${subscription.id}`)).statusCode).toBe(404);
    });

    it('send test queues a webhook.test delivery for that subscription only; refuses a disabled one', async () => {
        const { subscription } = (await create()).json();
        const res = await call('POST', `/webhooks/${subscription.id}/test`);
        expect(res.statusCode).toBe(202);
        expect(prisma.domainEvent.rows[0]).toMatchObject({ type: 'webhook.test', tenantId: 't1' });
        expect(prisma.webhookDelivery.rows).toHaveLength(1);
        expect(prisma.webhookDelivery.rows[0]).toMatchObject({ subscriptionId: subscription.id, tenantId: 't1', status: 'PENDING' });
        await call('PATCH', `/webhooks/${subscription.id}`, { isActive: false });
        expect((await call('POST', `/webhooks/${subscription.id}/test`)).statusCode).toBe(409);
    });

    it('lists recent deliveries for a subscription (tenant-filtered, bounded)', async () => {
        const { subscription } = (await create()).json();
        prisma.webhookDelivery.rows.push({ id: 'd1', tenantId: 't1', subscriptionId: subscription.id, status: 'FAILED' });
        prisma.webhookDelivery.rows.push({ id: 'd2', tenantId: 't2', subscriptionId: subscription.id, status: 'FAILED' });
        const res = await call('GET', `/webhooks/${subscription.id}/deliveries?limit=5`);
        expect(res.statusCode).toBe(200);
        expect(res.json().deliveries.map((d: any) => d.id)).toEqual(['d1']);
        expect((prisma.webhookDelivery.findMany.mock.calls[0][0] as any).take).toBe(5);
        expect((await call('GET', `/webhooks/${subscription.id}/deliveries?limit=1000`)).statusCode).toBe(400);
    });

    it('lists the event catalogue', async () => {
        const res = await call('GET', '/webhooks/event-types');
        expect(res.json().eventTypes.map((e: any) => e.type)).toContain('payment.succeeded');
    });
});

describe('managed external-app subscription', () => {
    const managed = () => ({ id: 'ext1', tenantId: 't1', url: 'https://app.example.com/in', events: ['message.received'], isActive: true, description: 'external-app', secretEnc: 'enc(x)' });

    it('is hidden from the list', async () => {
        prisma.webhookSubscription.rows.push(managed());
        await create();
        const subs = (await call('GET', '/webhooks')).json().subscriptions;
        expect(subs.map((x: any) => x.id)).not.toContain('ext1');
        expect(subs).toHaveLength(1);
    });

    it.each([
        ['PATCH', '/webhooks/ext1', { isActive: false }],
        ['DELETE', '/webhooks/ext1', undefined],
        ['POST', '/webhooks/ext1/rotate-secret', undefined],
        ['POST', '/webhooks/ext1/test', undefined],
    ])('%s %s is refused with a pointer to /developer/external-app and changes nothing', async (method, url, payload) => {
        prisma.webhookSubscription.rows.push(managed());
        const res = await call(method, url, payload);
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatch(/external-app/);
        expect(prisma.webhookSubscription.rows[0]).toMatchObject({ isActive: true, secretEnc: 'enc(x)' });
        expect(prisma.webhookSubscription.rows).toHaveLength(1);
    });

    it('does not count toward the per-tenant cap', async () => {
        prisma.webhookSubscription.rows.push(managed());
        for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_TENANT; i++) expect((await create()).statusCode).toBe(201);
        expect((await create()).statusCode).toBe(409);
    });

    it('a user cannot create or rename a subscription into the reserved description (it would be overwritten by the sync)', async () => {
        expect((await create({ url: URL_OK, events: ['booking.created'], description: 'external-app' })).statusCode).toBe(400);
        const { subscription } = (await create()).json();
        expect((await call('PATCH', `/webhooks/${subscription.id}`, { description: 'external-app' })).statusCode).toBe(400);
    });

    it('another tenant\'s managed subscription is simply not found', async () => {
        prisma.webhookSubscription.rows.push({ ...managed(), tenantId: 't2' });
        expect((await call('DELETE', '/webhooks/ext1')).statusCode).toBe(404);
    });
});
