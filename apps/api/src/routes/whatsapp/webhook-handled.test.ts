import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveConversation = vi.fn();
vi.mock('../../services/conversation-resolver.js', () => ({ resolveConversation: (...a: unknown[]) => resolveConversation(...a) }));

import { processWebhook } from './index.js';
import { withConversationLock, LockTimeoutError } from '../../services/conversation-lock.js';

type Msg = { id: string; conversationId: string; direction: string; whatsappMsgId: string | null; handledAt: Date | null };

/** Stateful Message store: enough prisma surface for the inbound path. */
function build(opts: { convUpdateFailsOnce?: boolean; raceOnCreate?: boolean } = {}) {
    const messages: Msg[] = [];
    let convFail = opts.convUpdateFailsOnce ?? false;
    let race = opts.raceOnCreate ?? false;
    const message = {
        findFirst: vi.fn(async ({ where }: any) =>
            messages.find((m) => m.conversationId === where.conversationId && m.whatsappMsgId === where.whatsappMsgId) ?? null),
        create: vi.fn(async ({ data }: any) => {
            if (race) {
                race = false;
                // A concurrent delivery inserted it between our check and insert.
                messages.push({ id: 'raced', conversationId: data.conversationId, direction: 'INBOUND', whatsappMsgId: data.whatsappMsgId, handledAt: null });
                throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['conversationId', 'whatsappMsgId'] } });
            }
            const row: Msg = { id: `m${messages.length}`, conversationId: data.conversationId, direction: data.direction, whatsappMsgId: data.whatsappMsgId, handledAt: null };
            messages.push(row);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const m of messages.filter((x) => x.id === where.id)) { Object.assign(m, data); count++; }
            return { count };
        }),
        update: vi.fn(async ({ where, data }: any) => {
            const m = messages.find((x) => x.id === where.id);
            if (m) Object.assign(m, data);
            return m;
        }),
    };
    const conversation = {
        update: vi.fn(async () => {
            if (convFail) { convFail = false; throw new Error('db blip mid-turn'); }
            return {};
        }),
    };
    const fastify: any = {
        redis: null,
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        prisma: { tenant: { findFirst: vi.fn(async () => ({ id: 't1' })) }, message, conversation },
    };
    return { fastify, messages, message, conversation };
}

const channelPayload = (mid = 'm-1'): any => ({
    object: 'page',
    entry: [{ id: 'p1', messaging: [{ sender: { id: 's1' }, message: { mid, text: 'hi' } }] }],
});
const waPayload = (id = 'wamid-1'): any => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'b', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'ph1', display_phone_number: '1' },
        contacts: [{ profile: { name: 'N' }, wa_id: '2' }],
        messages: [{ from: '2', id, timestamp: '1', type: 'text', text: { body: 'hi' } }],
    } }] }],
});

beforeEach(() => {
    resolveConversation.mockReset();
    resolveConversation.mockResolvedValue({ id: 'c1', state: 'HUMAN_ACTIVE', botFailureCount: 0 });
});

describe.each([
    ['messaging channel', channelPayload, 'm-1'],
    ['whatsapp', waPayload, 'wamid-1'],
])('inbound handledAt (%s)', (_label, mk, wid) => {
    it('marks the inbound row handled after a deliberate no-reply outcome (HUMAN_ACTIVE)', async () => {
        const { fastify, messages } = build();
        await processWebhook(fastify, mk());
        expect(messages).toHaveLength(1);
        expect(messages[0].handledAt).toBeInstanceOf(Date);
    });

    it('skips a redelivery of a handled message entirely', async () => {
        const { fastify, messages, message, conversation } = build();
        messages.push({ id: 'old', conversationId: 'c1', direction: 'INBOUND', whatsappMsgId: wid, handledAt: new Date() });
        await processWebhook(fastify, mk());
        expect(message.create).not.toHaveBeenCalled();
        expect(conversation.update).not.toHaveBeenCalled();
        expect(message.updateMany).not.toHaveBeenCalled();
    });

    it('re-runs the turn for a stored-but-unhandled message without inserting again', async () => {
        const { fastify, messages, message, conversation } = build();
        messages.push({ id: 'old', conversationId: 'c1', direction: 'INBOUND', whatsappMsgId: wid, handledAt: null });
        await processWebhook(fastify, mk());
        expect(message.create).not.toHaveBeenCalled();
        expect(conversation.update).toHaveBeenCalled(); // the turn ran
        expect(messages[0].handledAt).toBeInstanceOf(Date);
    });

    it('a turn that throws after the insert leaves the row unhandled, and the retry completes it', async () => {
        const { fastify, messages, message } = build({ convUpdateFailsOnce: true });
        await expect(processWebhook(fastify, mk())).rejects.toThrow(/1 webhook item/);
        expect(messages).toHaveLength(1);
        expect(messages[0].handledAt).toBeNull();

        await processWebhook(fastify, mk()); // inbox retry
        expect(message.create).toHaveBeenCalledTimes(1); // reused, not re-inserted
        expect(messages).toHaveLength(1);
        expect(messages[0].handledAt).toBeInstanceOf(Date);
    });

    it('P2002 race: reuses the row the other delivery inserted when it is unhandled', async () => {
        const { fastify, messages, conversation } = build({ raceOnCreate: true });
        await processWebhook(fastify, mk());
        expect(conversation.update).toHaveBeenCalled();
        expect(messages.find((m) => m.id === 'raced')!.handledAt).toBeInstanceOf(Date);
    });

    it('P2002 race: skips when the other delivery already handled it', async () => {
        const { fastify, messages, conversation, message } = build({ raceOnCreate: true });
        // After the racer inserts, it also finishes before we re-read.
        const orig = message.create.getMockImplementation()!;
        message.create.mockImplementationOnce(async (a: any) => {
            try { return await orig(a); } finally { messages[messages.length - 1].handledAt = new Date(); }
        });
        await processWebhook(fastify, mk());
        expect(conversation.update).not.toHaveBeenCalled();
    });
});

describe('conversation lock contention surfaces as LockTimeoutError', () => {
    it('rethrows the lock error itself (not a generic wrapper) when every failure is contention', async () => {
        const { fastify } = build();
        let release!: () => void;
        const held = withConversationLock(null, 't1:MESSENGER:s1', () => new Promise<void>((r) => { release = r; }));
        await new Promise((r) => setTimeout(r, 5));
        const p = channelPayload();
        const attempt = processWebhook(fastify, p);
        await expect(attempt).rejects.toBeInstanceOf(LockTimeoutError);
        release();
        await held;
    }, 15_000);
});

describe('status updates are idempotent under batch re-run', () => {
    const statusPayload = (status: string): any => ({
        object: 'whatsapp_business_account',
        entry: [{ id: 'b', changes: [{ field: 'messages', value: {
            metadata: { phone_number_id: 'ph1', display_phone_number: '1' },
            statuses: [{ id: 'wamid-out', status, pricing: { billable: true, category: 'utility' } }],
        } }] }],
    });

    it('re-applying the same status, or an older one, writes nothing', async () => {
        const row: any = { id: 'o1', status: null, metadata: null };
        const update = vi.fn(async ({ data }: any) => { Object.assign(row, data); return row; });
        const fastify: any = {
            redis: null,
            log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
            prisma: { tenant: { findFirst: vi.fn(async () => ({ id: 't1' })) }, message: { findFirst: vi.fn(async () => row), update } },
        };
        await processWebhook(fastify, statusPayload('delivered'));
        expect(row.status).toBe('DELIVERED');
        expect(update).toHaveBeenCalledTimes(1);

        await processWebhook(fastify, statusPayload('delivered')); // batch re-run
        await processWebhook(fastify, statusPayload('sent'));      // stale/out-of-order
        expect(update).toHaveBeenCalledTimes(1);
        expect(row.status).toBe('DELIVERED');

        await processWebhook(fastify, statusPayload('read'));      // forward move still applies
        expect(row.status).toBe('READ');
        await processWebhook(fastify, statusPayload('delivered'));
        expect(row.status).toBe('READ');
    });
});
