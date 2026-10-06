import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import v1Routes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn().mockResolvedValue({ eventId: 'e1' }) }));

import { publishEvent } from '../../services/events/publish.js';

let h: Harness;
beforeEach(async () => {
    vi.clearAllMocks();
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
});
afterEach(async () => { await h.close(); });

const auth = (k: string) => ({ authorization: `Bearer ${k}` });
const NOW = Date.now();

function convRow(over: Record<string, unknown> = {}) {
    return {
        id: 'ckconv00000000000000001', tenantId: 'tenant-a', channel: 'WHATSAPP', externalId: '233241234567',
        customerPhone: '+233241234567', customerHandle: null, customerName: 'Ama', state: 'BOT_ACTIVE',
        customerId: 'cust1', lastInboundAt: new Date(NOW - 60_000), createdAt: new Date(NOW - 1e6), updatedAt: new Date(NOW),
        botContext: { secret: 'internal' }, assignedUserId: 'u1', takeoverReason: null, botFailureCount: 2, contextVersion: 4,
        ...over,
    };
}

describe('envelope and auth', () => {
    it('401 uses the { error: { code, message } } envelope', async () => {
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: { code: 'unauthorized', message: expect.any(String) } });
    });

    it('403 when the key lacks conversations:read', async () => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations', headers: auth(k) });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe('forbidden');
    });

    it('unknown routes under /v1 get the envelope too', async () => {
        const res = await h.app.inject({ method: 'GET', url: '/v1/nope' });
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('not_found');
    });
});

describe('GET /v1/conversations', () => {
    const scopes = ['conversations:read' as const];

    it('is scoped to the key tenant, newest first, and hides bot internals', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        h.respond('conversation.findMany', [convRow({ tenantId: 'tenant-b' })]);
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations', headers: auth(k) });
        expect(res.statusCode).toBe(200);
        const q = h.find('conversation', 'findMany')[0].args;
        expect(q.where).toEqual({ tenantId: 'tenant-b' });
        expect(q.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
        const body = res.json();
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({ id: 'ckconv00000000000000001', channel: 'WHATSAPP', state: 'BOT_ACTIVE', customerPhone: '+233241234567', windowOpen: true });
        for (const hidden of ['botContext', 'assignedUserId', 'botFailureCount', 'contextVersion', 'tenantId', 'externalId']) {
            expect(body.data[0]).not.toHaveProperty(hidden);
        }
        expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
        expect(h.violations).toEqual([]);
    });

    it('applies state and customerId filters', async () => {
        const k = h.makeKey({ scopes });
        await h.app.inject({ method: 'GET', url: '/v1/conversations?state=HUMAN_ACTIVE&customerId=cust1', headers: auth(k) });
        expect(h.find('conversation', 'findMany')[0].args.where).toEqual({ tenantId: 'tenant-a', state: 'HUMAN_ACTIVE', customerId: 'cust1' });
    });

    it('paginates by cursor: fetches limit+1 and returns an opaque next cursor', async () => {
        const k = h.makeKey({ scopes });
        const rows = [convRow({ id: 'ckconv0000000000000000a' }), convRow({ id: 'ckconv0000000000000000b' }), convRow({ id: 'ckconv0000000000000000c' })];
        h.respond('conversation.findMany', rows);
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations?limit=2', headers: auth(k) });
        expect(h.find('conversation', 'findMany')[0].args.take).toBe(3);
        const body = res.json();
        expect(body.data.map((c: any) => c.id)).toEqual(['ckconv0000000000000000a', 'ckconv0000000000000000b']);
        expect(body.pagination.hasMore).toBe(true);
        expect(body.pagination.nextCursor).toBeTypeOf('string');
        expect(body.pagination.nextCursor).not.toContain('ckconv'); // opaque

        h.respond('conversation.findMany', []);
        await h.app.inject({ method: 'GET', url: `/v1/conversations?limit=2&cursor=${body.pagination.nextCursor}`, headers: auth(k) });
        const q2 = h.find('conversation', 'findMany')[1].args;
        expect(q2.cursor).toEqual({ id: 'ckconv0000000000000000b' });
        expect(q2.skip).toBe(1);
        expect(q2.where.tenantId).toBe('tenant-a');
    });

    it.each(['limit=0', 'limit=101', 'limit=abc', 'state=NOPE', 'cursor=!!!', 'cursor=' + 'a'.repeat(300)])('rejects bad query %s with 400', async (qs) => {
        const k = h.makeKey({ scopes });
        const res = await h.app.inject({ method: 'GET', url: `/v1/conversations?${qs}`, headers: auth(k) });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('validation_error');
    });

    it('reports windowOpen=false past 24h or with no inbound message', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findMany', [
            convRow({ id: 'ckconv0000000000000000a', lastInboundAt: new Date(NOW - 25 * 3600_000) }),
            convRow({ id: 'ckconv0000000000000000b', lastInboundAt: null }),
        ]);
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations', headers: auth(k) });
        expect(res.json().data.map((c: any) => c.windowOpen)).toEqual([false, false]);
    });
});

describe('GET /v1/conversations/:id', () => {
    const scopes = ['conversations:read' as const];

    it('looks up by id AND tenant; another tenant\'s id is a 404', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-b' });
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations/ckconv00000000000000001', headers: auth(k) });
        expect(res.statusCode).toBe(404);
        expect(h.find('conversation', 'findFirst')[0].args.where).toEqual({ id: 'ckconv00000000000000001', tenantId: 'tenant-b' });
        expect(res.json().error.code).toBe('not_found');
    });

    it('returns { data } for an owned conversation', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow());
        const res = await h.app.inject({ method: 'GET', url: '/v1/conversations/ckconv00000000000000001', headers: auth(k) });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.id).toBe('ckconv00000000000000001');
        expect(res.json().data).not.toHaveProperty('botContext');
    });
});

describe('GET /v1/conversations/:id/messages', () => {
    const scopes = ['conversations:read' as const];
    const id = 'ckconv00000000000000001';

    it('404s without reading messages when the conversation is not the tenant\'s', async () => {
        const k = h.makeKey({ scopes });
        const res = await h.app.inject({ method: 'GET', url: `/v1/conversations/${id}/messages`, headers: auth(k) });
        expect(res.statusCode).toBe(404);
        expect(h.find('message', 'findMany')).toHaveLength(0);
    });

    it('lists messages scoped through the conversation, newest first, with cursor pagination', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow());
        const m = (i: string) => ({
            id: `ckmsg0000000000000000${i}`, conversationId: id, direction: 'INBOUND', content: 'hi', messageType: 'TEXT',
            status: null, createdAt: new Date(NOW), metadata: { source: 'api', apiKeyPrefix: 'abc' }, whatsappMsgId: 'wamid.X', handledAt: null,
        });
        h.respond('message.findMany', [m('a'), m('b'), m('c')]);
        const res = await h.app.inject({ method: 'GET', url: `/v1/conversations/${id}/messages?limit=2`, headers: auth(k) });
        expect(res.statusCode).toBe(200);
        const q = h.find('message', 'findMany')[0].args;
        expect(q.where).toEqual({ conversationId: id, conversation: { tenantId: 'tenant-a' } });
        expect(q.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
        expect(q.take).toBe(3);
        const body = res.json();
        expect(body.data).toHaveLength(2);
        expect(body.data[0]).toMatchObject({ direction: 'INBOUND', content: 'hi', source: 'api' });
        expect(body.data[0]).not.toHaveProperty('whatsappMsgId');
        expect(body.data[0]).not.toHaveProperty('handledAt');
        expect(body.pagination.hasMore).toBe(true);
    });
});

describe('POST /v1/conversations/:id/handoff', () => {
    const scopes = ['conversations:write' as const];
    const id = 'ckconv00000000000000001';

    it('requires conversations:write', async () => {
        const k = h.makeKey({ scopes: ['conversations:read'] });
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: {} });
        expect(res.statusCode).toBe(403);
    });

    it('moves a bot conversation to HUMAN_ACTIVE with a tenant-scoped, state-guarded update', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-a' });
        h.respond('conversation.findFirst', convRow({ state: 'BOT_ACTIVE' }));
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: { reason: 'Needs a refund' } });
        expect(res.statusCode).toBe(200);
        const upd = h.find('conversation', 'updateMany')[0].args;
        expect(upd.where).toEqual({ id, tenantId: 'tenant-a', state: 'BOT_ACTIVE' });
        expect(upd.data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverReason: 'Needs a refund', takeoverAt: expect.any(Date) });
        expect(res.json().data).toMatchObject({ id, state: 'HUMAN_ACTIVE', changed: true });
        expect(publishEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            tenantId: 'tenant-a', type: 'conversation.handoff', payload: expect.objectContaining({ conversationId: id, to: 'HUMAN', reason: 'Needs a refund' }),
        }));
    });

    it('is idempotent when already with a human: no write, no event', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow({ state: 'HUMAN_ACTIVE' }));
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: {} });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ state: 'HUMAN_ACTIVE', changed: false });
        expect(h.find('conversation', 'updateMany')).toHaveLength(0);
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it('does not publish when a concurrent writer won (count 0)', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow({ state: 'BOT_ACTIVE' }));
        h.respond('conversation.updateMany', { count: 0 });
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: {} });
        expect(res.json().data.changed).toBe(false);
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it('404 for an unknown or foreign conversation; 400 for an over-long reason', async () => {
        const k = h.makeKey({ scopes });
        expect((await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: {} })).statusCode).toBe(404);
        const bad = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: { reason: 'x'.repeat(201) } });
        expect(bad.statusCode).toBe(400);
        expect(h.find('conversation', 'updateMany')).toHaveLength(0);
    });

    it('still succeeds when event publishing fails', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow({ state: 'BOT_ACTIVE' }));
        (publishEvent as any).mockRejectedValueOnce(new Error('queue down'));
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/handoff`, headers: auth(k), payload: {} });
        expect(res.statusCode).toBe(200);
    });
});

describe('POST /v1/conversations/:id/resume', () => {
    const scopes = ['conversations:write' as const];
    const id = 'ckconv00000000000000001';

    it('hands a human conversation back to the bot, clearing takeover fields and the failure count but keeping flow state', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-a' });
        h.respond('conversation.findFirst', convRow({ state: 'HUMAN_ACTIVE' }));
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/resume`, headers: auth(k) });
        expect(res.statusCode).toBe(200);
        const upd = h.find('conversation', 'updateMany')[0].args;
        expect(upd.where).toEqual({ id, tenantId: 'tenant-a', state: 'HUMAN_ACTIVE' });
        expect(upd.data).toMatchObject({ state: 'BOT_ACTIVE', botFailureCount: 0, assignedUserId: null, takeoverReason: null, takeoverAt: null });
        // In-flight flow state must survive: dropping it strands a later payment as unmatched.
        expect(upd.data).not.toHaveProperty('botContext');
        expect(res.json().data).toMatchObject({ state: 'BOT_ACTIVE', changed: true });
        expect(publishEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'conversation.resumed', payload: expect.objectContaining({ conversationId: id }) }));
    });

    it('is idempotent when the bot is already active', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow({ state: 'BOT_ACTIVE' }));
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/resume`, headers: auth(k) });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.changed).toBe(false);
        expect(h.find('conversation', 'updateMany')).toHaveLength(0);
    });

    it('does not publish when a concurrent writer already resumed it, and reports the real state', async () => {
        const k = h.makeKey({ scopes });
        h.respond('conversation.findFirst', convRow({ state: 'HUMAN_ACTIVE' }));
        h.respond('conversation.updateMany', { count: 0 });
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/resume`, headers: auth(k) });
        expect(res.json().data.changed).toBe(false);
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it('404 for a foreign conversation', async () => {
        const k = h.makeKey({ scopes });
        const res = await h.app.inject({ method: 'POST', url: `/v1/conversations/${id}/resume`, headers: auth(k) });
        expect(res.statusCode).toBe(404);
    });
});
