import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';

vi.mock('../../config/index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../config/index.js')>();
    return {
        ...actual,
        config: { ...actual.config, whatsapp: { ...actual.config.whatsapp, appSecret: 'test-secret' } },
    };
});

import whatsappRoutes from './index.js';

const SECRET = 'test-secret';
const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

async function build(opts: { createImpl?: () => Promise<{ id: string }>; events?: string[] } = {}) {
    const events = opts.events ?? [];
    const webhookInbox = {
        create: vi.fn(opts.createImpl ?? (async () => { events.push('persisted'); return { id: 'inbox-1' }; })),
        updateMany: vi.fn(async ({ data }: any) => {
            events.push(`update:${data.status}`);
            return { count: 1 };
        }),
        findUnique: vi.fn(async () => ({ id: 'inbox-1', payload: { object: 'unknown_object' }, attempts: 1 })),
    };
    const app = Fastify({ logger: false });
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        (req as any).rawBody = body;
        try { done(null, JSON.parse((body as Buffer).toString('utf8'))); } catch (e) { done(e as Error, undefined); }
    });
    await app.register(sensible);
    app.decorate('prisma', { webhookInbox } as any);
    app.decorate('redis', null);
    app.decorate('queues', { notifications: null, reminders: null, calendarSync: null, inbound: null } as any);
    app.decorate('authenticate', async () => undefined);
    await app.register(whatsappRoutes, { prefix: '/whatsapp' });
    return { app, webhookInbox, events };
}

const post = (app: any, body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    return app.inject({
        method: 'POST',
        url: '/whatsapp/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(raw) },
        payload: raw,
    });
};

describe('POST /whatsapp/webhook durability', () => {
    let ctx: Awaited<ReturnType<typeof build>>;
    beforeEach(async () => { ctx = await build(); });

    it('persists the payload as PENDING before replying 200', async () => {
        const events: string[] = [];
        const slow = await build({
            events,
            createImpl: async () => {
                await new Promise((r) => setTimeout(r, 30));
                events.push('persisted');
                return { id: 'inbox-1' };
            },
        });
        const body = { object: 'unknown_object', entry: [] };
        const res = await post(slow.app, body);
        events.push('replied');
        expect(res.statusCode).toBe(200);
        expect(events.indexOf('persisted')).toBeLessThan(events.indexOf('replied'));
        expect(slow.webhookInbox.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ payload: body, status: 'PENDING' }) }),
        );
    });

    it('replies 5xx and does not process when the insert fails (Meta will retry)', async () => {
        const failing = await build({ createImpl: async () => { throw new Error('db down'); } });
        const res = await post(failing.app, { object: 'whatsapp_business_account', entry: [] });
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        await new Promise((r) => setTimeout(r, 20));
        expect(failing.webhookInbox.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a bad signature without persisting anything', async () => {
        const res = await post(ctx.app, { object: 'x' }, 'sha256=deadbeef');
        expect(res.statusCode).toBe(401);
        expect(ctx.webhookInbox.create).not.toHaveBeenCalled();
    });

    it('processes the stored row after the ack and marks it DONE (no Redis)', async () => {
        const res = await post(ctx.app, { object: 'unknown_object' });
        expect(res.statusCode).toBe(200);
        await vi.waitFor(() => expect(ctx.events).toContain('update:DONE'));
        expect(ctx.events.indexOf('persisted')).toBeLessThan(ctx.events.indexOf('update:PROCESSING'));
    });
});
