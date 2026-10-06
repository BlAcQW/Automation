import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import v1Routes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';
import { encrypt } from '../../services/crypto.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn().mockResolvedValue({ eventId: 'e1' }) }));
vi.mock('../../services/usage.js', () => ({
    tryReserveOutbound: vi.fn(),
    rollbackOutboundReservation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/channel-send.js', async (orig) => ({
    ...(await orig<typeof import('../../services/channel-send.js')>()),
    sendChannelText: vi.fn(),
}));

import { tryReserveOutbound, rollbackOutboundReservation } from '../../services/usage.js';
import { sendChannelText } from '../../services/channel-send.js';
import { publishEvent } from '../../services/events/publish.js';

let h: Harness;
const CONV = 'ckconv00000000000000001';
const NOW = Date.now();

function tenantRow(over: Record<string, unknown> = {}) {
    return {
        id: 'tenant-a', isActive: true,
        whatsappPhoneNumberId: 'pn1', whatsappAccessToken: encrypt('wa-token'), whatsappHosted: false, whatsappNumberStatus: null,
        facebookPageId: null, facebookPageToken: null, instagramUserId: null,
        ...over,
    };
}

function conv(over: Record<string, unknown> = {}) {
    return {
        id: CONV, tenantId: 'tenant-a', channel: 'WHATSAPP', externalId: '233241234567', state: 'BOT_ACTIVE',
        lastInboundAt: new Date(NOW - 3600_000), ...over,
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    (tryReserveOutbound as any).mockResolvedValue({ ok: true, used: 1, limit: 100, planId: 'free' });
    (sendChannelText as any).mockResolvedValue({ messageId: 'wamid.OUT' });
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
    h.respond('conversation.findFirst', conv());
    h.respond('tenant.findUnique', (args: any) => (args?.select?.isActive && !args.select.whatsappPhoneNumberId ? { isActive: true } : tenantRow()));
});
afterEach(async () => { await h.close(); });

const auth = (k: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${k}`, ...extra });
const send = (k: string, payload: unknown, headers: Record<string, string> = {}) =>
    h.app.inject({ method: 'POST', url: '/v1/messages', headers: auth(k, headers), payload: payload as any });

describe('POST /v1/messages', () => {
    it('sends text inside the 24h window and stores an OUTBOUND message tagged as api', async () => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'Your ride is on the way' });
        expect(res.statusCode).toBe(201);

        expect(h.find('conversation', 'findFirst')[0].args.where).toEqual({ id: CONV, tenantId: 'tenant-a' });
        expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        expect((tryReserveOutbound as any).mock.calls[0][1]).toBe('tenant-a');
        expect(sendChannelText).toHaveBeenCalledWith(expect.objectContaining({
            channel: 'WHATSAPP', recipientId: '233241234567', text: 'Your ride is on the way',
            credentials: { senderId: 'pn1', accessToken: 'wa-token' },
        }));
        const created = h.find('message', 'create')[0].args.data;
        expect(created).toMatchObject({
            conversationId: CONV, direction: 'OUTBOUND', content: 'Your ride is on the way', messageType: 'TEXT',
            whatsappMsgId: 'wamid.OUT',
            metadata: expect.objectContaining({ source: 'api', apiKeyPrefix: expect.stringMatching(/^[A-Za-z0-9]{10}$/) }),
        });
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
        expect(res.json().data).toMatchObject({ conversationId: CONV, direction: 'OUTBOUND', content: 'Your ride is on the way', source: 'api' });
        expect(publishEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            tenantId: 'tenant-a', type: 'message.sent', payload: expect.objectContaining({ conversationId: CONV, sentBy: 'APP' }),
        }));
        expect(h.violations).toEqual([]);
    });

    it('does not change who handles the conversation', async () => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        await send(k, { conversationId: CONV, text: 'hi' });
        const touches = h.find('conversation', 'updateMany');
        for (const t of touches) {
            expect(t.args.data).not.toHaveProperty('state');
            expect(t.args.where.tenantId).toBe('tenant-a');
        }
    });

    it.each([
        ['never messaged us', null],
        ['25 hours ago', new Date(NOW - 25 * 3600_000)],
        ['exactly 24 hours ago', new Date(NOW - 24 * 3600_000)],
    ])('422 window_closed when the customer last wrote %s, without reserving or sending', async (_n, lastInboundAt) => {
        h.respond('conversation.findFirst', conv({ lastInboundAt }));
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('window_closed');
        expect(res.json().error.message).toMatch(/template/i);
        expect(tryReserveOutbound).not.toHaveBeenCalled();
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('402 quota_exceeded when the atomic reservation fails; nothing is sent or rolled back', async () => {
        (tryReserveOutbound as any).mockResolvedValue({ ok: false, used: 100, limit: 100, planId: 'free' });
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(402);
        expect(res.json().error.code).toBe('quota_exceeded');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
        expect(h.find('message', 'create')).toHaveLength(0);
    });

    it('423 outbound_paused (not quota_exceeded) when support has paused messaging; nothing sent, stored or rolled back', async () => {
        (tryReserveOutbound as any).mockResolvedValue({ ok: false, used: 0, limit: 100, planId: 'free', reason: 'paused', pauseReason: 'internal abuse note' });
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(423);
        expect(res.json().error.code).toBe('outbound_paused');
        expect(res.json().error.message).toMatch(/paused/i);
        expect(res.json().error.message).not.toMatch(/quota|upgrade/i);
        expect(res.body).not.toContain('internal abuse note');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
        expect(h.find('message', 'create')).toHaveLength(0);
    });

    it('rolls the reservation back and returns 502 when the provider send fails; no message is stored', async () => {
        (sendChannelText as any).mockRejectedValue(new Error('meta 500'));
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(502);
        expect(res.json().error.code).toBe('send_failed');
        expect(res.body).not.toContain('meta 500'); // provider detail stays server-side
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
        expect(h.find('message', 'create')).toHaveLength(0);
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it('422 channel_not_connected when the tenant cannot send on that channel; no quota is taken', async () => {
        h.respond('tenant.findUnique', (args: any) => (args?.select?.isActive && !args.select.whatsappPhoneNumberId ? { isActive: true } : tenantRow({ whatsappPhoneNumberId: null })));
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('channel_not_connected');
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });

    it('uses the Page credentials for Messenger conversations', async () => {
        h.respond('conversation.findFirst', conv({ channel: 'MESSENGER', externalId: 'psid-9' }));
        h.respond('tenant.findUnique', (args: any) => (args?.select?.isActive && !args.select.whatsappPhoneNumberId ? { isActive: true } : tenantRow({ facebookPageId: 'page1', facebookPageToken: encrypt('page-token') })));
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(201);
        expect(sendChannelText).toHaveBeenCalledWith(expect.objectContaining({
            channel: 'MESSENGER', recipientId: 'psid-9', credentials: { senderId: 'page1', accessToken: 'page-token' },
        }));
    });

    it('404 for a conversation that is not this tenant\'s', async () => {
        h.respond('conversation.findFirst', null);
        const k = h.makeKey({ scopes: ['messages:write'], tenantId: 'tenant-b' });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(404);
        expect(h.find('conversation', 'findFirst')[0].args.where).toEqual({ id: CONV, tenantId: 'tenant-b' });
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });

    it('403 without messages:write', async () => {
        const k = h.makeKey({ scopes: ['conversations:read'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(403);
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it.each([
        ['missing conversationId', { text: 'x' }],
        ['empty text', { conversationId: CONV, text: '' }],
        ['whitespace text', { conversationId: CONV, text: '   \n ' }],
        ['text over 4096', { conversationId: CONV, text: 'x'.repeat(4097) }],
        ['text not a string', { conversationId: CONV, text: 42 }],
        ['unknown field', { conversationId: CONV, text: 'x', templateName: 'y' }],
        ['empty body', {}],
    ])('400 for %s', async (_n, payload) => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('validation_error');
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });

    it('accepts text of exactly 4096 characters and unicode/emoji', async () => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        expect((await send(k, { conversationId: CONV, text: 'x'.repeat(4096) })).statusCode).toBe(201);
        expect((await send(k, { conversationId: CONV, text: 'Akwaaba 🚗 é中' })).statusCode).toBe(201);
    });

    it('still answers 201 (recorded:false) when the send succeeded but storing it failed, so a retry cannot double-send', async () => {
        h.respond('message.create', () => { throw new Error('db down'); });
        const k = h.makeKey({ scopes: ['messages:write'] });
        const res = await send(k, { conversationId: CONV, text: 'hello' });
        expect(res.statusCode).toBe(201);
        expect(res.json().data).toMatchObject({ id: null, recorded: false, content: 'hello' });
        expect(rollbackOutboundReservation).not.toHaveBeenCalled(); // it WAS sent
    });

    describe('Idempotency-Key', () => {
        const KEY = 'ride-42-pickup';
        const prior = (over: Record<string, unknown> = {}) => ({
            id: 'm-old', conversationId: CONV, direction: 'OUTBOUND', content: 'hello', messageType: 'TEXT', status: null,
            createdAt: new Date(), metadata: { source: 'api', idempotencyKey: KEY }, ...over,
        });
        const withKey = (k: string, payload: unknown, key = KEY) => send(k, payload, { 'idempotency-key': key });

        it('stores the key in metadata on first use', async () => {
            const k = h.makeKey({ scopes: ['messages:write'] });
            await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(h.find('message', 'create')[0].args.data.metadata).toMatchObject({ idempotencyKey: KEY });
        });

        it('takes a NON-blocking per-(tenant, key) advisory lock and does lookup, send and store under it', async () => {
            const k = h.makeKey({ scopes: ['messages:write'] });
            await withKey(k, { conversationId: CONV, text: 'hello' });
            const raw = h.find('$raw', '$queryRaw');
            expect(raw).toHaveLength(1);
            const [strings, ...values] = raw[0].args as [string[], ...unknown[]];
            expect(strings.join('?')).toContain('pg_try_advisory_xact_lock');
            expect(values.join('|')).toContain('tenant-a');
            expect(values.join('|')).toContain(KEY);
            // Ordering: lock first, then lookup, then send.
            const order = h.queries.map((q) => `${q.model}.${q.op}`);
            expect(order.indexOf('$raw.$queryRaw')).toBeLessThan(order.lastIndexOf('message.findFirst'));
        });

        it('requests without a key take no lock', async () => {
            const k = h.makeKey({ scopes: ['messages:write'] });
            await send(k, { conversationId: CONV, text: 'hello' });
            expect(h.find('$raw', '$queryRaw')).toHaveLength(0);
        });

        it('409 idempotency_in_progress, without sending, when another request holds the key', async () => {
            h.respond('$queryRaw', () => [{ locked: false }]);
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(res.statusCode).toBe(409);
            expect(res.json().error.code).toBe('idempotency_in_progress');
            expect(sendChannelText).not.toHaveBeenCalled();
            expect(tryReserveOutbound).not.toHaveBeenCalled();
        });

        it('two parallel requests with one key send exactly once', async () => {
            let held = false;
            h.respond('$queryRaw', () => { if (held) return [{ locked: false }]; held = true; return [{ locked: true }]; });
            let release!: () => void;
            (sendChannelText as any).mockImplementation(() => new Promise((r) => { release = () => r({ messageId: 'wamid.OUT' }); }));
            const k = h.makeKey({ scopes: ['messages:write'] });
            const first = withKey(k, { conversationId: CONV, text: 'hello' });
            await vi.waitFor(() => expect(sendChannelText).toHaveBeenCalledTimes(1));
            const second = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(second.statusCode).toBe(409);
            release();
            expect((await first).statusCode).toBe(201);
            expect(sendChannelText).toHaveBeenCalledTimes(1);
        });

        it('replays the original message without sending or reserving again', async () => {
            h.respond('message.findFirst', prior());
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(res.statusCode).toBe(200);
            expect(res.json().data).toMatchObject({ id: 'm-old' });
            expect(res.headers['idempotent-replayed']).toBe('true');
            expect(sendChannelText).not.toHaveBeenCalled();
            expect(tryReserveOutbound).not.toHaveBeenCalled();
        });

        it('looks the key up across the tenant (not just this conversation), bounded to the last 24h', async () => {
            h.respond('message.findFirst', prior());
            const k = h.makeKey({ scopes: ['messages:write'] });
            await withKey(k, { conversationId: CONV, text: 'hello' });
            const where = h.find('message', 'findFirst')[0].args.where;
            expect(where).toMatchObject({ direction: 'OUTBOUND', conversation: { tenantId: 'tenant-a' }, metadata: { path: ['idempotencyKey'], equals: KEY } });
            expect(where).not.toHaveProperty('conversationId');
            expect(where.createdAt.gte).toBeInstanceOf(Date);
            expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThan(23 * 3600_000);
        });

        it('409 idempotency_key_reused when the same key arrives with a different text', async () => {
            h.respond('message.findFirst', prior({ content: 'a different message' }));
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(res.statusCode).toBe(409);
            expect(res.json().error.code).toBe('idempotency_key_reused');
            expect(sendChannelText).not.toHaveBeenCalled();
        });

        it('409 idempotency_key_reused when the same key arrives for a different conversation', async () => {
            h.respond('message.findFirst', prior({ conversationId: 'ckother0000000000000002' }));
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(res.statusCode).toBe(409);
            expect(res.json().error.code).toBe('idempotency_key_reused');
        });

        it('keys are per tenant: the lookup is always scoped to the caller tenant', async () => {
            const k = h.makeKey({ scopes: ['messages:write'], tenantId: 'tenant-b' });
            h.respond('conversation.findFirst', conv({ tenantId: 'tenant-b' }));
            await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(h.find('message', 'findFirst')[0].args.where.conversation).toEqual({ tenantId: 'tenant-b' });
            expect(h.violations).toEqual([]);
        });

        it('send ok but store failed: 201 recorded:false, and an immediate retry does NOT resend', async () => {
            h.respond('message.create', () => { throw new Error('db down'); });
            const k = h.makeKey({ scopes: ['messages:write'] });
            const first = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(first.statusCode).toBe(201);
            expect(first.json().data).toMatchObject({ id: null, recorded: false });
            expect(sendChannelText).toHaveBeenCalledTimes(1);

            const retry = await withKey(k, { conversationId: CONV, text: 'hello' });
            expect(retry.statusCode).toBe(200);
            expect(retry.json().data).toMatchObject({ id: null, recorded: false });
            expect(retry.headers['idempotent-replayed']).toBe('true');
            expect(sendChannelText).toHaveBeenCalledTimes(1);
            expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        });

        it('after a store failure the same key with a different body is still rejected', async () => {
            h.respond('message.create', () => { throw new Error('db down'); });
            const k = h.makeKey({ scopes: ['messages:write'] });
            await withKey(k, { conversationId: CONV, text: 'hello' }, 'k-store-fail');
            const res = await withKey(k, { conversationId: CONV, text: 'something else' }, 'k-store-fail');
            expect(res.statusCode).toBe(409);
            expect(res.json().error.code).toBe('idempotency_key_reused');
            expect(sendChannelText).toHaveBeenCalledTimes(1);
        });

        it('a failed send leaves no marker: the retry sends', async () => {
            (sendChannelText as any).mockRejectedValueOnce(new Error('meta 500'));
            const k = h.makeKey({ scopes: ['messages:write'] });
            expect((await withKey(k, { conversationId: CONV, text: 'hello' }, 'k-retry')).statusCode).toBe(502);
            expect((await withKey(k, { conversationId: CONV, text: 'hello' }, 'k-retry')).statusCode).toBe(201);
            expect(sendChannelText).toHaveBeenCalledTimes(2);
        });

        it('a commit failure after a successful send is treated like a store failure (no 500, no resend)', async () => {
            const realTx = (h.app as any).prisma.$transaction;
            let calls = 0;
            // Simulate the connection dying at COMMIT: run the callback, then throw.
            (h.app as any).prisma = new Proxy((h.app as any).prisma, {
                get: (t, p) => (p === '$transaction' ? async (fn: any, o: any) => { calls++; await realTx(fn, o); throw new Error('commit failed'); } : t[p]),
            });
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' }, 'k-commit');
            expect(calls).toBe(1);
            expect(res.statusCode).toBe(201);
            expect(res.json().data.recorded).toBe(false);
        });

        it('rejects a malformed key with 400', async () => {
            const k = h.makeKey({ scopes: ['messages:write'] });
            const res = await withKey(k, { conversationId: CONV, text: 'hello' }, 'x'.repeat(201));
            expect(res.statusCode).toBe(400);
        });
    });
});
