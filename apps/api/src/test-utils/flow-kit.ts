/**
 * In-memory Prisma stand-in for the wave 2 wiring tests (flow turns, the
 * flow_payment fulfiller, external-app turns). It implements exactly the
 * surface those paths touch, with real compare-and-set on
 * Conversation.contextVersion and a real mutex behind the advisory lock, so the
 * concurrency tests are genuine.
 *
 * Not a test file: import it from a *.test.ts, after your own vi.mock calls.
 */
import { vi } from 'vitest';

type Row = Record<string, any>;

export const PAY_FLOW = {
    key: 'pay-flow',
    version: 1,
    start: 'pay',
    states: {
        pay: { type: 'payment', prompt: 'Pay here: {payment_url}', kind: 'flow_payment', amount: 25, onSuccess: 'done', onFailure: 'failed' },
        done: { type: 'end', text: 'Paid. Thanks!' },
        failed: { type: 'end', text: 'Payment failed.' },
    },
};

/** Payment, then a hand-off to a person on success. */
export const PAY_THEN_STAFF_FLOW = {
    key: 'pay-flow',
    version: 1,
    start: 'pay',
    states: {
        pay: { type: 'payment', prompt: 'Pay here: {payment_url}', kind: 'flow_payment', amount: 25, onSuccess: 'staff' },
        staff: { type: 'staff', text: 'Thanks, a person will confirm.', queue: 'dispatch', handoff: true },
    },
};

export const MENU_FLOW = {
    key: 'menu-flow',
    version: 1,
    start: 'menu',
    states: {
        menu: { type: 'menu', prompt: 'Welcome', options: [{ label: 'Talk to staff', next: 'staff' }, { label: 'Done', next: 'bye' }] },
        staff: { type: 'staff', text: 'Connecting you to the team.', handoff: true },
        bye: { type: 'end', text: 'Bye!' },
    },
};

export interface FlowKitOptions {
    tenant?: Row;
    conversation?: Row;
    definition?: Record<string, any>;
    externalApp?: Row | null;
}

export function makeFlowKit(opts: FlowKitOptions = {}) {
    const tenant: Row = {
        id: 't1',
        name: 'TURBO',
        vertical: 'RIDES',
        conversationMode: null,
        activeFlowKey: (opts.definition ?? PAY_FLOW).key,
        paymentCurrency: 'GHS',
        paystackSecretKey: 'enc-paystack',
        whatsappPhoneNumberId: 'ph1',
        whatsappAccessToken: 'tok',
        whatsappDisplayNumber: '+233 20 000 0000',
        ...opts.tenant,
    };
    const conv: Row = {
        id: 'c1',
        tenantId: 't1',
        channel: 'WHATSAPP',
        externalId: '233241234567',
        customerPhone: '233241234567',
        customerId: null,
        state: 'BOT_ACTIVE',
        botContext: null,
        botFailureCount: 0,
        contextVersion: 0,
        takeoverReason: null,
        ...opts.conversation,
    };
    const def = opts.definition ?? PAY_FLOW;
    const messages: Row[] = [];
    const events: Row[] = [];
    const notifications: Row[] = [];
    let chain: Promise<unknown> = Promise.resolve();

    const apply = (r: Row, data: Row) => {
        for (const [k, v] of Object.entries(data)) {
            r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] ?? 0) + v.increment : v;
        }
    };
    const matchMsg = (m: Row, w: Row) =>
        Object.entries(w).every(([k, v]) => k === 'metadata' || k === 'createdAt' || m[k] === v);

    const message = {
        findFirst: vi.fn(async ({ where }: any) => messages.find((m) => matchMsg(m, where)) ?? null),
        create: vi.fn(async ({ data }: any) => {
            const r = { id: `m${messages.length}`, handledAt: null, ...data };
            messages.push(r);
            return r;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const m of messages.filter((x) => x.id === where.id)) { apply(m, data); count++; }
            return { count };
        }),
        update: vi.fn(async ({ where, data }: any) => {
            const m = messages.find((x) => x.id === where.id)!;
            apply(m, data);
            return m;
        }),
    };

    const conversation = {
        findFirst: vi.fn(async ({ where }: any) =>
            where.id === conv.id && (where.tenantId === undefined || where.tenantId === conv.tenantId) ? { ...conv } : null),
        findUnique: vi.fn(async ({ where }: any) => (where.id === conv.id ? { ...conv } : null)),
        updateMany: vi.fn(async ({ where, data }: any) => {
            if (where.id !== conv.id) return { count: 0 };
            if (where.tenantId !== undefined && where.tenantId !== conv.tenantId) return { count: 0 };
            if (where.contextVersion !== undefined && where.contextVersion !== conv.contextVersion) return { count: 0 };
            apply(conv, data);
            return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: any) => {
            if (where.id !== conv.id) throw new Error('not found');
            apply(conv, data);
            return { ...conv };
        }),
    };

    const tx: any = {
        $executeRaw: vi.fn(async () => 0),
        domainEvent: {
            findFirst: vi.fn(async ({ where }: any) =>
                events.find(
                    (e) =>
                        e.tenantId === where.tenantId &&
                        e.type === where.type &&
                        e.payload[where.payload.path[0]] === where.payload.equals,
                ) ?? null),
        },
    };

    const prisma: any = {
        tenant: {
            findFirst: vi.fn(async () => ({ ...tenant })),
            findUnique: vi.fn(async ({ where }: any) => (where.id === tenant.id ? { ...tenant } : null)),
        },
        conversation,
        message,
        flowDefinition: {
            findFirst: vi.fn(async ({ where }: any) => {
                if (where.tenantId !== null) return null; // platform default rows only
                if (where.key !== undefined && where.key !== def.key) return null;
                if (where.version !== undefined && where.version !== def.version) return null;
                return { key: def.key, version: def.version, definition: def };
            }),
        },
        externalApp: { findFirst: vi.fn(async () => (opts.externalApp === undefined ? null : opts.externalApp)) },
        notification: { create: vi.fn(async ({ data }: any) => { notifications.push(data); return data; }) },
        $transaction: vi.fn((fn: any) => {
            const run = chain.then(() => fn(tx));
            chain = run.catch(() => undefined);
            return run;
        }),
    };

    return {
        prisma,
        tenant,
        conv,
        messages,
        events,
        notifications,
        /** Wire a mocked publishEvent so published events land in `events`. */
        installPublish(publishMock: ReturnType<typeof vi.fn>) {
            publishMock.mockImplementation(async (_client: any, input: any) => {
                await new Promise((r) => setTimeout(r, 2)); // widen race windows
                // DomainEvent @@unique([tenantId, dedupeKey]): a repeated key is a P2002, which publishEventOnce reports as 'duplicate'.
                if (input.dedupeKey && events.some((e) => e.tenantId === input.tenantId && e.dedupeKey === input.dedupeKey)) {
                    throw Object.assign(new Error('Unique constraint failed on dedupeKey'), { code: 'P2002' });
                }
                events.push({ id: `e${events.length + 1}`, ...input });
                return { eventId: `e${events.length}` };
            });
        },
        eventsOfType: (type: string) => events.filter((e) => e.type === type),
        outbound: () => messages.filter((m) => m.direction === 'OUTBOUND'),
        /** Seed a conversation that is already waiting on the pay step. */
        seedWaiting(state: Partial<Row> = {}) {
            conv.botContext = {
                flow: {
                    flowKey: def.key, flowVersion: def.version, current: 'pay', status: 'waiting',
                    vars: { payment_url: 'https://pay.test/x', payment_reference: 'bf_f_old' },
                    misses: 0, lastInboundId: 'in-0', lastEventId: null, ...state,
                },
            };
            conv.contextVersion = 1;
        },
    };
}
