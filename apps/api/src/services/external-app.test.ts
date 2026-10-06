import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', async () => (await import('../test-utils/api-harness.js')).configMock());
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));

import { publishEvent } from './events/publish.js';
import { decrypt, encrypt } from './crypto.js';
import { getPaymentFulfiller, resetPaymentFulfillersForTests } from './payment-fulfillers.js';
import {
    EXTERNAL_APP_EVENTS,
    EXTERNAL_APP_FULFILLMENT_KIND,
    EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION,
    registerExternalAppFulfiller,
    syncExternalAppSubscription,
    newSigningSecret,
    saveExternalApp,
    rotateExternalAppSecret,
    getExternalApp,
    deleteExternalApp,
} from './external-app.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * In-memory stand-in for the DB: the DomainEvent unique (tenantId, dedupeKey)
 * raises P2002 on a second insert, so the idempotency test exercises genuine
 * concurrency against the same mechanism production uses.
 */
function memoryPrisma() {
    const events: any[] = [];
    const prisma: any = { events };
    (publishEvent as any).mockImplementation(async (_c: any, input: any) => {
        await new Promise((r) => setTimeout(r, 5)); // widen the race window
        if (input.dedupeKey && events.some((e) => e.tenantId === input.tenantId && e.dedupeKey === input.dedupeKey)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        events.push({ id: `e${events.length + 1}`, ...input });
        return { eventId: `e${events.length}` };
    });
    return prisma;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
});

describe('registerExternalAppFulfiller', () => {
    it('registers kind external_app, and is safe to call twice', () => {
        registerExternalAppFulfiller();
        registerExternalAppFulfiller();
        expect(EXTERNAL_APP_FULFILLMENT_KIND).toBe('external_app');
        expect(getPaymentFulfiller('external_app')).toBeTypeOf('function');
    });
});

describe('external_app fulfiller', () => {
    const input = (prisma: any, over: Record<string, unknown> = {}) => ({
        prisma, tenantId: 't1', entityId: 'ride-1', reference: 'bf_f_external_app_ride-1_1', amountMinor: 2500, currency: 'GHS', log, ...over,
    });
    const fulfil = (i: any) => { registerExternalAppFulfiller(); return getPaymentFulfiller('external_app')!(i); };

    it('publishes payment.succeeded with the app entity reference and Paystack\'s figures', async () => {
        const prisma = memoryPrisma();
        const out = await fulfil(input(prisma));
        expect(out).toEqual({ status: 'applied' });
        expect(publishEvent).toHaveBeenCalledTimes(1);
        const [client, ev] = (publishEvent as any).mock.calls[0];
        expect(client).toBe(prisma);
        expect(ev).toMatchObject({
            tenantId: 't1', type: 'payment.succeeded',
            payload: { v: 1, entityRef: 'ride-1', amountMinor: 2500, currency: 'GHS', reference: 'bf_f_external_app_ride-1_1' },
        });
    });

    it('also fills the catalogue field names (paymentId, amount) so catalogue-shaped consumers work', async () => {
        const prisma = memoryPrisma();
        await fulfil(input(prisma));
        expect((publishEvent as any).mock.calls[0][1].payload).toMatchObject({ paymentId: 'bf_f_external_app_ride-1_1', amount: 2500 });
    });

    it('dedupes with a unique key, not a payload scan or advisory lock', async () => {
        const prisma = memoryPrisma();
        await fulfil(input(prisma));
        expect((publishEvent as any).mock.calls[0][1].dedupeKey).toBe('payment.succeeded:reference:bf_f_external_app_ride-1_1');
        expect((publishEvent as any).mock.calls[0][1].storeOnlyIfSubscribed).toBeUndefined();
    });

    it('is idempotent per reference: a redelivery returns already_applied and publishes nothing', async () => {
        const prisma = memoryPrisma();
        expect(await fulfil(input(prisma))).toEqual({ status: 'applied' });
        expect(await fulfil(input(prisma))).toEqual({ status: 'already_applied' });
        expect(prisma.events).toHaveLength(1); // the second insert hit the unique key
    });

    it('is idempotent under concurrent redelivery: exactly one event for ten simultaneous calls', async () => {
        const prisma = memoryPrisma();
        const results = await Promise.all(Array.from({ length: 10 }, () => fulfil(input(prisma))));
        expect(results.filter((r) => r.status === 'applied')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'already_applied')).toHaveLength(9);
        expect(prisma.events).toHaveLength(1);
    });

    it('treats different references for the same entity as different payments', async () => {
        const prisma = memoryPrisma();
        await fulfil(input(prisma, { reference: 'ref-a' }));
        await fulfil(input(prisma, { reference: 'ref-b' }));
        expect(prisma.events).toHaveLength(2);
    });

    it('does not collide across tenants', async () => {
        const prisma = memoryPrisma();
        await fulfil(input(prisma, { tenantId: 't1', reference: 'same' }));
        const out = await fulfil(input(prisma, { tenantId: 't2', reference: 'same' }));
        expect(out).toEqual({ status: 'applied' });
    });

    it.each([
        ['zero amount', { amountMinor: 0 }],
        ['negative amount', { amountMinor: -1 }],
        ['non-integer amount', { amountMinor: 1.5 }],
        ['blank currency', { currency: '' }],
        ['blank entity', { entityId: '' }],
        ['blank reference', { reference: '' }],
    ])('rejects (permanent, not a retry) on %s', async (_n, over) => {
        const prisma = memoryPrisma();
        const out = await fulfil(input(prisma, over));
        expect(out.status).toBe('rejected');
        expect(publishEvent).not.toHaveBeenCalled();
    });

    it('lets a transient failure propagate so Paystack retries (and a retry then succeeds)', async () => {
        const prisma = memoryPrisma();
        (publishEvent as any).mockRejectedValueOnce(new Error('db down'));
        await expect(fulfil(input(prisma))).rejects.toThrow('db down');
        (publishEvent as any).mockImplementation(async (_c: any, i: any) => { prisma.events.push(i); return { eventId: 'e' }; });
        expect(await fulfil(input(prisma))).toEqual({ status: 'applied' });
    });
});

// ---------------------------------------------------------------------------

function subPrisma(opts: { app?: any; subs?: number } = {}) {
    const store = { subscriptionCount: opts.subs ?? 0 };
    const tx: any = {
        $executeRaw: vi.fn(async () => 0),
        externalApp: { findFirst: vi.fn(async () => opts.app ?? null) },
        webhookSubscription: {
            updateMany: vi.fn(async () => ({ count: store.subscriptionCount })),
            create: vi.fn(async ({ data }: any) => ({ id: 's1', ...data })),
        },
    };
    return { tx, $transaction: vi.fn(async (fn: any) => fn(tx)), ...tx };
}

describe('syncExternalAppSubscription', () => {
    const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', tenantId: 't1', name: 'TURBO', url: 'https://turbo.example/hook', signingSecretEnc: 'enc-secret', isActive: true, ...over });

    it('creates a managed subscription carrying the app url, the same secret and the delivery events', async () => {
        const prisma = subPrisma({ app: app(), subs: 0 });
        await syncExternalAppSubscription(prisma as any, 't1');
        const data = prisma.tx.webhookSubscription.create.mock.calls[0][0].data;
        expect(data).toEqual({
            tenantId: 't1', url: 'https://turbo.example/hook', secretEnc: 'enc-secret', description: EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION,
            events: [...EXTERNAL_APP_EVENTS], isActive: true,
        });
        expect(EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION).toBe('external-app');
        expect([...EXTERNAL_APP_EVENTS].sort()).toEqual([
            'conversation.handoff', 'conversation.resumed', 'flow.completed', 'message.received', 'payment.failed', 'payment.succeeded',
        ]);
        expect(prisma.tx.externalApp.findFirst.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    });

    it('updates the existing managed subscription instead of adding another', async () => {
        const prisma = subPrisma({ app: app({ url: 'https://new.example/h' }), subs: 1 });
        await syncExternalAppSubscription(prisma as any, 't1');
        expect(prisma.tx.webhookSubscription.create).not.toHaveBeenCalled();
        const args = prisma.tx.webhookSubscription.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenantId: 't1', description: 'external-app' });
        expect(args.data).toMatchObject({ url: 'https://new.example/h', secretEnc: 'enc-secret', isActive: true });
    });

    it('deactivating the app deactivates the subscription', async () => {
        const prisma = subPrisma({ app: app({ isActive: false }), subs: 1 });
        await syncExternalAppSubscription(prisma as any, 't1');
        expect(prisma.tx.webhookSubscription.updateMany.mock.calls[0][0].data.isActive).toBe(false);
    });

    it('an inactive app with no subscription yet creates it inactive', async () => {
        const prisma = subPrisma({ app: app({ isActive: false }), subs: 0 });
        await syncExternalAppSubscription(prisma as any, 't1');
        expect(prisma.tx.webhookSubscription.create.mock.calls[0][0].data.isActive).toBe(false);
    });

    it('with no external app, only switches off any managed subscription (never creates)', async () => {
        const prisma = subPrisma({ app: null, subs: 1 });
        await syncExternalAppSubscription(prisma as any, 't1');
        expect(prisma.tx.webhookSubscription.create).not.toHaveBeenCalled();
        expect(prisma.tx.webhookSubscription.updateMany.mock.calls[0][0]).toEqual({
            where: { tenantId: 't1', description: 'external-app' }, data: { isActive: false },
        });
    });

    it('serialises per tenant with an advisory lock', async () => {
        const prisma = subPrisma({ app: app() });
        await syncExternalAppSubscription(prisma as any, 't1');
        expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
    });
});

describe('external app management', () => {
    it('newSigningSecret is whsec_ + 64 hex and random', () => {
        expect(newSigningSecret()).toMatch(/^whsec_[0-9a-f]{64}$/);
        expect(newSigningSecret()).not.toBe(newSigningSecret());
    });

    function mgmtPrisma(existing: any = null) {
        const tx: any = {
            $executeRaw: vi.fn(async () => 0),
            externalApp: { findFirst: vi.fn(async () => existing) },
            webhookSubscription: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
        };
        return {
            tx,
            $transaction: vi.fn(async (fn: any) => fn(tx)),
            $executeRaw: tx.$executeRaw,
            externalApp: {
                findFirst: vi.fn(async () => existing),
                create: vi.fn(async ({ data }: any) => ({ id: 'a1', createdAt: new Date(), updatedAt: new Date(), ...data })),
                updateMany: vi.fn(async () => ({ count: existing ? 1 : 0 })),
                deleteMany: vi.fn(async () => ({ count: 1 })),
            },
            webhookSubscription: tx.webhookSubscription,
        } as any;
    }

    it('saveExternalApp creates with an encrypted secret and returns it once', async () => {
        const prisma = mgmtPrisma(null);
        const out = await saveExternalApp(prisma, 't1', { name: 'TURBO', url: 'https://turbo.example/h', isActive: true });
        expect(out.signingSecret).toMatch(/^whsec_/);
        const data = prisma.externalApp.create.mock.calls[0][0].data;
        expect(data.signingSecretEnc).not.toContain(out.signingSecret);
        expect(decrypt(data.signingSecretEnc)).toBe(out.signingSecret);
        expect(out.app).not.toHaveProperty('signingSecretEnc');
        expect(prisma.tx.webhookSubscription.updateMany).toHaveBeenCalled(); // synced
    });

    it('saveExternalApp on an existing app updates without exposing or changing the secret', async () => {
        const prisma = mgmtPrisma({ id: 'a1', tenantId: 't1', name: 'Old', url: 'https://old.example', signingSecretEnc: encrypt('whsec_x'), isActive: true, createdAt: new Date(), updatedAt: new Date() });
        const out = await saveExternalApp(prisma, 't1', { name: 'New', url: 'https://new.example/h', isActive: false });
        expect(out.signingSecret).toBeUndefined();
        const args = prisma.externalApp.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenantId: 't1' });
        expect(args.data).toEqual({ name: 'New', url: 'https://new.example/h', isActive: false });
    });

    it('getExternalApp never returns the secret', async () => {
        const prisma = mgmtPrisma({ id: 'a1', tenantId: 't1', name: 'x', url: 'u', signingSecretEnc: 'enc', isActive: true, createdAt: new Date(), updatedAt: new Date() });
        const app = await getExternalApp(prisma, 't1');
        expect(app).not.toHaveProperty('signingSecretEnc');
        expect(app).not.toHaveProperty('tenantId');
    });

    it('rotateExternalAppSecret stores the new secret encrypted, returns it once, re-syncs; null when no app', async () => {
        const prisma = mgmtPrisma({ id: 'a1', tenantId: 't1', name: 'x', url: 'u', signingSecretEnc: 'enc', isActive: true });
        const secret = await rotateExternalAppSecret(prisma, 't1');
        expect(secret).toMatch(/^whsec_/);
        const args = prisma.externalApp.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenantId: 't1' });
        expect(decrypt(args.data.signingSecretEnc)).toBe(secret);

        const none = mgmtPrisma(null);
        expect(await rotateExternalAppSecret(none, 't1')).toBeNull();
    });

    it('deleteExternalApp removes the app and switches the managed subscription off', async () => {
        const prisma = mgmtPrisma(null);
        await deleteExternalApp(prisma, 't1');
        expect(prisma.externalApp.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
        expect(prisma.tx.webhookSubscription.updateMany.mock.calls[0][0].data).toEqual({ isActive: false });
    });
});
