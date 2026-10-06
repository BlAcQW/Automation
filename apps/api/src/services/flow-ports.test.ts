import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
const createFulfillmentPaymentLink = vi.fn();
vi.mock('./payment-link.js', () => ({ createFulfillmentPaymentLink: (...a: unknown[]) => createFulfillmentPaymentLink(...a) }));
const triggerTakeover = vi.fn();
vi.mock('./human-takeover.js', () => ({ triggerTakeover: (...a: unknown[]) => triggerTakeover(...a) }));
const createNotification = vi.fn();
vi.mock('./notifications.js', () => ({ createNotification: (...a: unknown[]) => createNotification(...a) }));

import { createFlowPorts, parseIdempotencyKey, whatsappReturnUrl } from './flow-ports.js';
import { decodeFlowEntityId } from './flow-entity-id.js';
import { registerFlowAction, resetFlowActionsForTests } from './flows/index.js';

const log = { warn: vi.fn(), error: vi.fn() };
const tenant = { id: 't1', paystackSecretKey: 'enc-key', whatsappDisplayNumber: '+233 20 000 0000' };

function prismaWith(botContext: unknown) {
    return { conversation: { findFirst: vi.fn(async () => ({ botContext })) } };
}

const payReq = (over: Record<string, unknown> = {}) => ({
    tenantId: 't1', conversationId: 'c1', customerPhone: '233241234567', kind: 'flow_payment', amount: 25.5, currency: 'GHS',
    vars: {}, idempotencyKey: 'c1:wamid.IN1:pay', ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    resetFlowActionsForTests();
    createFulfillmentPaymentLink.mockImplementation(async (a: any) => {
        await a.onCreated({ reference: 'bf_f_ref', authorizationUrl: 'https://paystack/x', collectionRoute: 'OWN_GATEWAY' });
        return 'https://paystack/x';
    });
});

describe('parseIdempotencyKey', () => {
    it('splits conversation, inbound and state (inbound ids may contain colons and dots)', () => {
        expect(parseIdempotencyKey('c1:wamid.A:B:pay', 'c1')).toEqual({ inboundId: 'wamid.A:B', state: 'pay' });
    });
    it.each(['', 'c1:pay', 'other:in:pay', 'c1::pay', 'c1:in:'])('rejects %j', (k) => {
        expect(parseIdempotencyKey(k, 'c1')).toBeNull();
    });
});

describe('whatsappReturnUrl', () => {
    it('builds a wa.me link from the business number', () => {
        expect(whatsappReturnUrl('+233 20 000 0000')).toBe('https://wa.me/233200000000');
    });
    it('is undefined when the number is unknown or implausible', () => {
        expect(whatsappReturnUrl(null)).toBeUndefined();
        expect(whatsappReturnUrl('')).toBeUndefined();
        expect(whatsappReturnUrl('12')).toBeUndefined();
    });
});

describe('createPaymentLink', () => {
    it('creates an own-gateway fulfillment link for the step and returns url + reference', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        const link = await ports.createPaymentLink(payReq());

        expect(link).toEqual({ url: 'https://paystack/x', reference: 'bf_f_ref' });
        const args = (createFulfillmentPaymentLink.mock.calls[0] as any)[0];
        expect(args).toMatchObject({
            tenantId: 't1', paystackSecretKeyEncrypted: 'enc-key', currency: 'GHS', kind: 'flow_payment',
            amount: 25.5, customerPhone: '233241234567', callbackUrl: 'https://wa.me/233200000000',
        });
        expect(decodeFlowEntityId(args.entityId)).toEqual({ conversationId: 'c1', state: 'pay', amountMinor: 2550, currency: 'GHS' });
        expect(args.onCreated).toBeTypeOf('function');
    });

    it.each([
        ['more than 12 minor digits', 10_000_000_000.01],
        ['zero', 0],
        ['negative', -5],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('refuses an amount the entity id cannot carry (%s) BEFORE creating the Paystack link', async (_n, amount) => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq({ amount }))).toBeNull();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalled();
    });

    it('refuses a state or currency the entity id cannot carry', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq({ idempotencyKey: 'c1:in1:Bad-State' }))).toBeNull();
        expect(await ports.createPaymentLink(payReq({ currency: 'ghs' }))).toBeNull();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });

    it('still carries the largest encodable amount (999,999,999,999 minor units)', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq({ amount: 9_999_999_999.99 }))).not.toBeNull();
    });

    it('returns null when no link can be made', async () => {
        createFulfillmentPaymentLink.mockResolvedValue(null);
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq())).toBeNull();
    });

    it('works for a channel with no phone (Instagram/Messenger)', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        await ports.createPaymentLink(payReq({ customerPhone: null }));
        expect((createFulfillmentPaymentLink.mock.calls[0] as any)[0].customerPhone).toBe('');
    });

    it('omits the return url when the business number is unknown', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant: { ...tenant, whatsappDisplayNumber: null }, log });
        await ports.createPaymentLink(payReq());
        expect((createFulfillmentPaymentLink.mock.calls[0] as any)[0].callbackUrl).toBeUndefined();
    });

    describe('idempotency on the provided key', () => {
        const waiting = (over: Record<string, unknown> = {}) => ({
            flow: {
                flowKey: 'f', flowVersion: 1, current: 'pay', status: 'waiting',
                vars: { payment_url: 'https://paystack/held', payment_reference: 'held_ref' },
                misses: 0, lastInboundId: 'wamid.IN1', lastEventId: null, ...over,
            },
        });

        it('returns the link the flow state already holds for that inbound and step, without calling Paystack', async () => {
            const ports = createFlowPorts({ prisma: prismaWith(waiting()), tenant, log });
            expect(await ports.createPaymentLink(payReq())).toEqual({ url: 'https://paystack/held', reference: 'held_ref' });
            expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
        });

        it('creates a new link for a different inbound message', async () => {
            const ports = createFlowPorts({ prisma: prismaWith(waiting({ lastInboundId: 'wamid.OLD' })), tenant, log });
            await ports.createPaymentLink(payReq());
            expect(createFulfillmentPaymentLink).toHaveBeenCalledTimes(1);
        });

        it('creates a new link for a different payment step', async () => {
            const ports = createFlowPorts({ prisma: prismaWith(waiting({ current: 'pay2' })), tenant, log });
            await ports.createPaymentLink(payReq());
            expect(createFulfillmentPaymentLink).toHaveBeenCalledTimes(1);
        });

        it('creates a new link when the flow is no longer waiting', async () => {
            const ports = createFlowPorts({ prisma: prismaWith(waiting({ status: 'active' })), tenant, log });
            await ports.createPaymentLink(payReq());
            expect(createFulfillmentPaymentLink).toHaveBeenCalledTimes(1);
        });

        it('reads the conversation scoped by tenant', async () => {
            const prisma = prismaWith(null);
            await createFlowPorts({ prisma, tenant, log }).createPaymentLink(payReq());
            expect((prisma.conversation.findFirst.mock.calls[0] as any)[0].where).toEqual({ id: 'c1', tenantId: 't1' });
        });
    });

    it('refuses a request for another tenant', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq({ tenantId: 't2' }))).toBeNull();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });

    it('refuses an unusable idempotency key', async () => {
        const ports = createFlowPorts({ prisma: prismaWith(null), tenant, log });
        expect(await ports.createPaymentLink(payReq({ idempotencyKey: 'junk' }))).toBeNull();
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });
});

describe('enqueueStaff', () => {
    const req = (over: Record<string, unknown> = {}) => ({
        tenantId: 't1', conversationId: 'c1', queue: 'dispatch', handoff: true, vars: {}, idempotencyKey: 'c1:in:staff', ...over,
    });

    it('hands off to a person with the queue name as the reason', async () => {
        const prisma = prismaWith(null);
        await createFlowPorts({ prisma, tenant, log }).enqueueStaff(req());
        expect(triggerTakeover).toHaveBeenCalledWith(prisma, 'c1', 'dispatch');
        expect(createNotification).not.toHaveBeenCalled();
    });

    it('uses a default reason when the step names no queue', async () => {
        await createFlowPorts({ prisma: prismaWith(null), tenant, log }).enqueueStaff(req({ queue: null }));
        expect(triggerTakeover).toHaveBeenCalledWith(expect.anything(), 'c1', 'flow_staff');
    });

    it('a "queue and carry on" step notifies staff and leaves the bot in charge', async () => {
        await createFlowPorts({ prisma: prismaWith(null), tenant, log }).enqueueStaff(req({ handoff: false }));
        expect(triggerTakeover).not.toHaveBeenCalled();
        expect(createNotification).toHaveBeenCalledTimes(1);
        expect((createNotification.mock.calls[0] as any)[1]).toMatchObject({
            tenantId: 't1', metadata: { kind: 'flow_staff_queue', conversationId: 'c1', queue: 'dispatch' },
        });
    });

    it('lets a failure propagate so the engine alerts and hands off', async () => {
        triggerTakeover.mockRejectedValue(new Error('db'));
        await expect(createFlowPorts({ prisma: prismaWith(null), tenant, log }).enqueueStaff(req())).rejects.toThrow('db');
    });

    it('refuses another tenant', async () => {
        await expect(createFlowPorts({ prisma: prismaWith(null), tenant, log }).enqueueStaff(req({ tenantId: 't2' }))).rejects.toThrow();
        expect(triggerTakeover).not.toHaveBeenCalled();
    });
});

describe('runAction', () => {
    it('dispatches to the registered pack action, key included', async () => {
        const fn = vi.fn(async () => ({ ok: true, vars: { rides_left: 3 } }));
        registerFlowAction('turbo_balance', fn);
        const r = { tenantId: 't1', conversationId: 'c1', customerPhone: null, name: 'turbo_balance', args: {}, vars: {}, idempotencyKey: 'k' };
        expect(await createFlowPorts({ prisma: prismaWith(null), tenant, log }).runAction(r)).toEqual({ ok: true, vars: { rides_left: 3 } });
        expect(fn).toHaveBeenCalledWith(r);
    });

    it('an unregistered action is a failure, not a crash', async () => {
        const r = { tenantId: 't1', conversationId: 'c1', customerPhone: null, name: 'nope', args: {}, vars: {}, idempotencyKey: 'k' };
        expect(await createFlowPorts({ prisma: prismaWith(null), tenant, log }).runAction(r)).toEqual({ ok: false });
    });
});
