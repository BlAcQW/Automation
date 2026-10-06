import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rawPrisma } from './helpers/db.js';
import { makeFastify } from './helpers/fake-fastify.js';
import { seedConversation, seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { findInbound, insertInbound, markInboundHandled } from '../../src/routes/whatsapp/inbound-store.js';
import {
    ReplySendError, SEND_CLAIM_STALE_MS, deliverReply, resendPendingReply,
} from '../../src/routes/whatsapp/reply-outbox.js';
import { currentCycleKey } from '../../src/services/usage.js';

const inboundData = (conversationId: string, wamid: string | null) => ({
    conversationId, direction: 'INBOUND' as const, content: 'hello', messageType: 'TEXT' as const, whatsappMsgId: wamid,
});

describe('inbound store on a real database', () => {
    let tenantId: string; let conversationId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant()).id;
        conversationId = (await seedConversation(tenantId)).id;
    });

    it('(conversationId, whatsappMsgId) is unique: concurrent redeliveries store one row and share its slot', async () => {
        const prisma = (await makeFastify()).prisma;
        const { ok, failed } = await race(10, () => insertInbound(prisma, conversationId, 'wamid.A', inboundData(conversationId, 'wamid.A')));
        expect(failed).toEqual([]);
        expect(await rawPrisma().message.count({ where: { conversationId } })).toBe(1);
        expect(new Set(ok.map((s) => s.id)).size).toBe(1);
        expect(ok.every((s) => s.handled === false)).toBe(true);
    });

    it('a retried unhandled inbound reuses the row; once handled it is reported as a true duplicate', async () => {
        const prisma = (await makeFastify()).prisma;
        const first = await insertInbound(prisma, conversationId, 'wamid.B', inboundData(conversationId, 'wamid.B'));
        expect(await findInbound(prisma, conversationId, 'wamid.B')).toEqual({ id: first.id, handled: false });
        await markInboundHandled(prisma, first.id);
        await markInboundHandled(prisma, first.id); // idempotent, keeps the first timestamp
        const row = await rawPrisma().message.findUniqueOrThrow({ where: { id: first.id } });
        expect(row.handledAt).not.toBeNull();
        const again = await insertInbound(prisma, conversationId, 'wamid.B', inboundData(conversationId, 'wamid.B'));
        expect(again).toEqual({ id: first.id, handled: true });
        expect(await rawPrisma().message.count({ where: { conversationId } })).toBe(1);
    });

    it('markInboundHandled keeps the FIRST handledAt', async () => {
        const prisma = (await makeFastify()).prisma;
        const slot = await insertInbound(prisma, conversationId, 'wamid.C', inboundData(conversationId, 'wamid.C'));
        await markInboundHandled(prisma, slot.id);
        const t1 = (await rawPrisma().message.findUniqueOrThrow({ where: { id: slot.id } })).handledAt!;
        await new Promise((r) => setTimeout(r, 15));
        await markInboundHandled(prisma, slot.id);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: slot.id } })).handledAt!.getTime()).toBe(t1.getTime());
    });

    it('the same wamid in a different conversation is a different message', async () => {
        const prisma = (await makeFastify()).prisma;
        const other = (await seedConversation(tenantId)).id;
        await insertInbound(prisma, conversationId, 'wamid.D', inboundData(conversationId, 'wamid.D'));
        await insertInbound(prisma, other, 'wamid.D', inboundData(other, 'wamid.D'));
        expect(await rawPrisma().message.count({ where: { whatsappMsgId: 'wamid.D' } })).toBe(2);
    });

    it('rows with no provider id never collide (NULLs are distinct)', async () => {
        const prisma = (await makeFastify()).prisma;
        const { failed } = await race(5, () => insertInbound(prisma, conversationId, null, inboundData(conversationId, null)));
        expect(failed).toEqual([]);
        expect(await rawPrisma().message.count({ where: { conversationId } })).toBe(5);
    });

    it('a non-duplicate failure is rethrown, not swallowed', async () => {
        const prisma = (await makeFastify()).prisma;
        await expect(insertInbound(prisma, 'no-such-conversation', 'wamid.E', inboundData('no-such-conversation', 'wamid.E'))).rejects.toBeTruthy();
    });
});

describe('reply outbox on a real database', () => {
    let tenant: { id: string }; let conversationId: string; let inboundId: string;
    const creds = { senderId: 'phone-1', accessToken: 'tok' };
    let fetchCalls: number;
    let fetchImpl: () => Promise<Response>;

    const respond = (status: number, body: unknown = { messages: [{ id: 'wamid.OUT' }] }) =>
        new Response(JSON.stringify(body), { status });

    beforeEach(async () => {
        tenant = await seedTenant({ monthlyMessageQuotaOverride: 100 });
        conversationId = (await seedConversation(tenant.id)).id;
        inboundId = (await rawPrisma().message.create({ data: inboundData(conversationId, 'wamid.IN') })).id;
        fetchCalls = 0;
        fetchImpl = async () => { await new Promise((r) => setTimeout(r, 150)); return respond(200); };
        vi.stubGlobal('fetch', vi.fn(async () => { fetchCalls++; return fetchImpl(); }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const pendingReply = (over: Record<string, unknown> = {}) => rawPrisma().message.create({
        data: {
            conversationId, direction: 'OUTBOUND', content: 'reply text', messageType: 'TEXT', replyToId: inboundId,
            sendState: 'PENDING', metadata: { source: 'flow' }, ...over,
        },
    });
    const args = (humanActive = false) => ({ conversationId, inboundId, channel: 'WHATSAPP' as const, creds, recipientId: '233241234567', humanActive });
    const usageCount = async () => {
        const t = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenant.id } });
        return (await rawPrisma().tenantUsage.findUnique({ where: { tenantId_month: { tenantId: tenant.id, month: currentCycleKey(t) } } }))?.messageCount ?? 0;
    };

    it('two concurrent resends of one PENDING reply send exactly once', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply();
        const { ok, failed } = await race(2, () => resendPendingReply(fastify, tenant, args()));
        expect(fetchCalls).toBe(1);
        expect(ok).toEqual([true]);
        expect(failed).toHaveLength(1);
        expect(failed[0]).toBeInstanceOf(ReplySendError);
        const after = await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.sendState).toBe('SENT');
        expect(after.whatsappMsgId).toBe('wamid.OUT');
        expect(after.sendClaimedAt).toBeNull();
        expect(await usageCount()).toBe(1);
        expect(await rawPrisma().message.count({ where: { conversationId, direction: 'OUTBOUND' } })).toBe(1);
    });

    it('many concurrent resends still send once', async () => {
        const fastify = await makeFastify();
        await pendingReply();
        const { ok } = await race(8, () => resendPendingReply(fastify, tenant, args()));
        expect(fetchCalls).toBe(1);
        expect(ok).toHaveLength(1);
    });

    it('a resend after SENT does not send again but reports the turn accounted for', async () => {
        const fastify = await makeFastify();
        await pendingReply();
        expect(await resendPendingReply(fastify, tenant, args())).toBe(true);
        expect(await resendPendingReply(fastify, tenant, args())).toBe(true);
        expect(fetchCalls).toBe(1);
    });

    it('a fresh SENDING claim belongs to someone else; a stale one is taken over', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply({ sendState: 'SENDING', sendClaimedAt: new Date() });
        await expect(resendPendingReply(fastify, tenant, args())).rejects.toBeInstanceOf(ReplySendError);
        expect(fetchCalls).toBe(0);
        await rawPrisma().message.update({ where: { id: row.id }, data: { sendClaimedAt: new Date(Date.now() - SEND_CLAIM_STALE_MS - 1000) } });
        expect(await resendPendingReply(fastify, tenant, args())).toBe(true);
        expect(fetchCalls).toBe(1);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } })).sendState).toBe('SENT');
    });

    it('a retryable send failure leaves the row PENDING, releases the claim and rolls the quota back', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply();
        fetchImpl = async () => respond(503, { error: 'down' });
        await expect(resendPendingReply(fastify, tenant, args())).rejects.toBeInstanceOf(ReplySendError);
        const after = await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.sendState).toBe('PENDING');
        expect(after.sendClaimedAt).toBeNull();
        expect(await usageCount()).toBe(0);
        // and the next attempt succeeds
        fetchImpl = async () => respond(200);
        expect(await resendPendingReply(fastify, tenant, args())).toBe(true);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } })).sendState).toBe('SENT');
    });

    it('a permanent 4xx suppresses the reply and raises one alert', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply();
        fetchImpl = async () => respond(400, { error: 'closed window' });
        expect(await resendPendingReply(fastify, tenant, args())).toBe(true);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } })).sendState).toBe('SUPPRESSED');
        const alerts = await rawPrisma().platformAlert.findMany({ where: { kind: 'outbound.undeliverable' } });
        expect(alerts).toHaveLength(1);
        expect(await usageCount()).toBe(0);
    });

    it('staff takeover suppresses a stale bot reply instead of sending it', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply();
        expect(await resendPendingReply(fastify, tenant, args(true))).toBe(true);
        expect(fetchCalls).toBe(0);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } })).sendState).toBe('SUPPRESSED');
    });

    it('no stored reply -> returns false so the agent turn runs', async () => {
        const fastify = await makeFastify();
        expect(await resendPendingReply(fastify, tenant, args())).toBe(false);
    });

    it('deliverReply stores the row as SENDING, sends, and marks SENT with the provider id', async () => {
        const fastify = await makeFastify();
        const outcome = await deliverReply(fastify, tenant, {
            conversationId, channel: 'WHATSAPP', creds, recipientId: '233241234567', text: 'hi there', inboundId, metadata: { source: 'flow' },
        });
        expect(outcome).toBe('sent');
        const row = await rawPrisma().message.findFirstOrThrow({ where: { conversationId, direction: 'OUTBOUND' } });
        expect(row).toMatchObject({ sendState: 'SENT', whatsappMsgId: 'wamid.OUT', replyToId: inboundId, content: 'hi there' });
        expect(await usageCount()).toBe(1);
    });

    it('with no channel credentials the reply is suppressed with an alert and nothing is sent', async () => {
        const fastify = await makeFastify();
        const row = await pendingReply({ sendState: 'SENDING', sendClaimedAt: new Date() });
        const outcome = await deliverReply(fastify, tenant, {
            conversationId, channel: 'WHATSAPP', creds: null, recipientId: 'x', text: 't', metadata: {}, existingRowId: row.id,
        });
        expect(outcome).toBe('no_channel');
        expect(fetchCalls).toBe(0);
        expect((await rawPrisma().message.findUniqueOrThrow({ where: { id: row.id } })).sendState).toBe('SUPPRESSED');
        expect(await rawPrisma().platformAlert.count({ where: { kind: 'outbound.no_channel' } })).toBe(1);
    });

    it('a full quota suppresses without sending', async () => {
        const fastify = await makeFastify();
        const t = await seedTenant({ monthlyMessageQuotaOverride: 1 });
        const conv = (await seedConversation(t.id)).id;
        const send = () => deliverReply(fastify, t, { conversationId: conv, channel: 'WHATSAPP', creds, recipientId: 'x', text: 't', metadata: {} });
        expect(await send()).toBe('sent');
        expect(await send()).toBe('suppressed');
        expect(fetchCalls).toBe(1);
    });
});
