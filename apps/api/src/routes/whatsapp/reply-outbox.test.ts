import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendChannelText = vi.fn();
vi.mock('../../services/channel-send.js', async (orig) => {
    const real = await orig<typeof import('../../services/channel-send.js')>();
    return { ...real, sendChannelText: (...a: unknown[]) => sendChannelText(...a) };
});
const tryReserveOutbound = vi.fn();
const rollbackOutboundReservation = vi.fn();
vi.mock('../../services/usage.js', () => ({
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: (...a: unknown[]) => rollbackOutboundReservation(...a),
}));
const raiseAlert = vi.fn();
vi.mock('../../services/alerts.js', () => ({ raiseAlert: (...a: unknown[]) => raiseAlert(...a) }));

import { deliverReply, resendPendingReply, ReplySendError, SEND_CLAIM_STALE_MS } from './reply-outbox.js';
import { ChannelSendError } from '../../services/channel-send.js';

type Row = Record<string, any>;

/** Minimal in-memory Message table that honours the where clauses the outbox uses. */
function build() {
    const rows: Row[] = [];
    const matches = (r: Row, w: any): boolean => {
        if (!w) return true;
        if (w.OR) return w.OR.some((o: any) => matches(r, { ...w, OR: undefined, ...o }));
        return Object.entries(w).every(([k, v]: [string, any]) => {
            if (k === 'OR' || v === undefined) return true;
            if (v && typeof v === 'object' && !(v instanceof Date)) {
                if ('in' in v) return v.in.includes(r[k]);
                if ('lt' in v) return r[k] != null && r[k] < v.lt;
            }
            return r[k] === v;
        });
    };
    const message = {
        create: vi.fn(async ({ data }: any) => { const r = { id: `o${rows.length}`, ...data }; rows.push(r); return r; }),
        update: vi.fn(async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const hit = rows.filter((r) => matches(r, where));
            hit.forEach((r) => Object.assign(r, data));
            return { count: hit.length };
        }),
        // orderBy createdAt desc → latest pushed first.
        findFirst: vi.fn(async ({ where }: any) => [...rows].reverse().find((r) => matches(r, where)) ?? null),
    };
    const fastify: any = {
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: { message },
    };
    return { fastify, rows, message };
}
const tenant = { id: 't1' };
const creds = { senderId: 's', accessToken: 'a' };
const args = (over: Record<string, unknown> = {}) => ({
    conversationId: 'c1', channel: 'MESSENGER' as const, creds, recipientId: 'r1',
    text: 'Hello there', inboundId: 'in1', metadata: { source: 'llm' }, ...over,
});
const resend = (fastify: any, over: Record<string, unknown> = {}) =>
    resendPendingReply(fastify, tenant, { conversationId: 'c1', inboundId: 'in1', channel: 'MESSENGER', creds, recipientId: 'r1', ...over } as any);
const stored = (over: Row = {}): Row => ({
    id: 'p1', conversationId: 'c1', replyToId: 'in1', direction: 'OUTBOUND', sendState: 'PENDING', content: 'stored text', ...over,
});

beforeEach(() => {
    for (const m of [sendChannelText, tryReserveOutbound, rollbackOutboundReservation, raiseAlert]) m.mockReset();
    tryReserveOutbound.mockResolvedValue({ ok: true });
    rollbackOutboundReservation.mockResolvedValue(undefined);
    sendChannelText.mockResolvedValue({ messageId: 'wamid.X' });
});

describe('deliverReply', () => {
    it('stores the reply linked to the inbound and claimed (SENDING) before sending, then marks SENT', async () => {
        const { fastify, rows } = build();
        sendChannelText.mockImplementation(async () => {
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ sendState: 'SENDING', replyToId: 'in1', content: 'Hello there', direction: 'OUTBOUND' });
            expect(rows[0].sendClaimedAt).toBeInstanceOf(Date);
            return { messageId: 'wamid.X' };
        });
        await expect(deliverReply(fastify, tenant, args())).resolves.toBe('sent');
        expect(rows[0]).toMatchObject({ sendState: 'SENT', whatsappMsgId: 'wamid.X' });
        expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
    });

    it('retryable send failure: releases the claim back to PENDING, rolls back quota, throws ReplySendError', async () => {
        const { fastify, rows } = build();
        sendChannelText.mockRejectedValue(new ChannelSendError('MESSENGER', 'send', 'http_503: unavailable'));
        await expect(deliverReply(fastify, tenant, args())).rejects.toBeInstanceOf(ReplySendError);
        expect(rows[0].sendState).toBe('PENDING');
        expect(rows[0].whatsappMsgId).toBeNull();
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });

    it('a network error or 429 is retryable too', async () => {
        for (const details of ['network_error: timeout', 'http_429: slow down']) {
            const { fastify, rows } = build();
            sendChannelText.mockRejectedValue(new ChannelSendError('MESSENGER', 'send', details));
            await expect(deliverReply(fastify, tenant, args())).rejects.toBeInstanceOf(ReplySendError);
            expect(rows[0].sendState).toBe('PENDING');
        }
    });

    it('permanent send failure (4xx): not retried — SUPPRESSED, quota rolled back, alert, turn handled', async () => {
        // An invalid recipient or a closed 24h window will never succeed; seven
        // retries over hours would only delay telling a person.
        const { fastify, rows } = build();
        sendChannelText.mockRejectedValue(new ChannelSendError('MESSENGER', 'send', 'http_400: (#131047) re-engagement'));
        await expect(deliverReply(fastify, tenant, args())).resolves.toBe('undeliverable');
        expect(rows[0].sendState).toBe('SUPPRESSED');
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
        expect(raiseAlert).toHaveBeenCalledWith(fastify.prisma, expect.objectContaining({ kind: 'outbound.undeliverable', tenantId: 't1' }));
    });

    it('quota exhausted: nothing stored, nothing sent, suppressed', async () => {
        const { fastify, rows } = build();
        tryReserveOutbound.mockResolvedValue({ ok: false });
        await expect(deliverReply(fastify, tenant, args())).resolves.toBe('suppressed');
        expect(rows).toHaveLength(0);
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('no credentials: deliberate no-reply with a deduped per-tenant+channel warning alert', async () => {
        const { fastify, rows } = build();
        await expect(deliverReply(fastify, tenant, args({ creds: null }))).resolves.toBe('no_channel');
        expect(rows).toHaveLength(0);
        expect(tryReserveOutbound).not.toHaveBeenCalled();
        expect(raiseAlert).toHaveBeenCalledWith(fastify.prisma, expect.objectContaining({
            kind: 'outbound.no_channel', severity: 'warning', tenantId: 't1', dedupeKey: 'outbound.no_channel:t1:MESSENGER',
        }));
    });

    it('failure to store the outbox row rolls back the quota and throws without sending', async () => {
        const { fastify, message } = build();
        message.create.mockRejectedValue(new Error('db down'));
        await expect(deliverReply(fastify, tenant, args())).rejects.toThrow('db down');
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });

    it('a failure marking SENT after a successful send does not throw (the customer has the reply)', async () => {
        const { fastify, message } = build();
        message.update.mockRejectedValue(new Error('db blip'));
        await expect(deliverReply(fastify, tenant, args())).resolves.toBe('sent');
        expect(fastify.log.error).toHaveBeenCalled();
    });
});

describe('resendPendingReply', () => {
    it('returns false when no reply was ever stored for the inbound (run the turn)', async () => {
        const { fastify } = build();
        await expect(resend(fastify)).resolves.toBe(false);
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('a reply already SENT counts as handled: nothing is sent and the agent must not run again', async () => {
        // The reply went out but marking the inbound handled failed; re-running
        // the agent would repeat create_booking / payment links.
        const { fastify, rows } = build();
        rows.push(stored({ sendState: 'SENT' }));
        await expect(resend(fastify)).resolves.toBe(true);
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('a reply already SUPPRESSED counts as handled too', async () => {
        const { fastify, rows } = build();
        rows.push(stored({ sendState: 'SUPPRESSED' }));
        await expect(resend(fastify)).resolves.toBe(true);
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('re-sends exactly the stored text after claiming it, reserves quota again, marks SENT, creates no second row', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        sendChannelText.mockImplementation(async () => {
            expect(rows[0].sendState).toBe('SENDING');
            return { messageId: 'wamid.X' };
        });
        await expect(resend(fastify)).resolves.toBe(true);
        expect(sendChannelText).toHaveBeenCalledWith(expect.objectContaining({ text: 'stored text', recipientId: 'r1' }));
        expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sendState: 'SENT', whatsappMsgId: 'wamid.X' });
    });

    it('another worker is mid-send (fresh SENDING claim): do not send a second copy — retry later', async () => {
        const { fastify, rows } = build();
        rows.push(stored({ sendState: 'SENDING', sendClaimedAt: new Date() }));
        await expect(resend(fastify)).rejects.toBeInstanceOf(ReplySendError);
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });

    it('a stale SENDING claim (sender crashed) is taken over and sent', async () => {
        const { fastify, rows } = build();
        rows.push(stored({ sendState: 'SENDING', sendClaimedAt: new Date(Date.now() - SEND_CLAIM_STALE_MS - 1000) }));
        await expect(resend(fastify)).resolves.toBe(true);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
        expect(rows[0].sendState).toBe('SENT');
    });

    it('two concurrent re-sends of one PENDING row send it once', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        let release!: () => void;
        sendChannelText.mockImplementation(() => new Promise((res) => { release = () => res({ messageId: 'wamid.X' }); }));
        const first = resend(fastify);
        await vi.waitFor(() => expect(sendChannelText).toHaveBeenCalledTimes(1));
        await expect(resend(fastify)).rejects.toBeInstanceOf(ReplySendError);
        release();
        await expect(first).resolves.toBe(true);
        expect(sendChannelText).toHaveBeenCalledTimes(1);
    });

    it('uses the latest stored reply for the inbound', async () => {
        const { fastify, rows } = build();
        rows.push(stored({ id: 'old', sendState: 'SUPPRESSED', content: 'old' }), stored({ id: 'new', content: 'new text' }));
        await resend(fastify);
        expect(sendChannelText).toHaveBeenCalledWith(expect.objectContaining({ text: 'new text' }));
    });

    it('staff took over since the failed attempt: the stale bot reply is suppressed, not sent', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        await expect(resend(fastify, { humanActive: true })).resolves.toBe(true);
        expect(sendChannelText).not.toHaveBeenCalled();
        expect(rows[0].sendState).toBe('SUPPRESSED');
    });

    it('a failing re-send rolls back quota, releases to PENDING and throws again', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        sendChannelText.mockRejectedValue(new Error('still down'));
        await expect(resend(fastify)).rejects.toBeInstanceOf(ReplySendError);
        expect(rows[0].sendState).toBe('PENDING');
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });

    it('quota exhausted on re-send: SUPPRESSED so it is not retried forever; handled', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        tryReserveOutbound.mockResolvedValue({ ok: false });
        await expect(resend(fastify)).resolves.toBe(true);
        expect(rows[0].sendState).toBe('SUPPRESSED');
        expect(sendChannelText).not.toHaveBeenCalled();
    });

    it('channel no longer configured on re-send: SUPPRESSED + alert, handled', async () => {
        const { fastify, rows } = build();
        rows.push(stored());
        await expect(resend(fastify, { creds: null })).resolves.toBe(true);
        expect(rows[0].sendState).toBe('SUPPRESSED');
        expect(raiseAlert).toHaveBeenCalled();
    });
});
