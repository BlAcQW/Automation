import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../config/index.js', async (orig) => {
    const real = await orig<typeof import('../../config/index.js')>();
    return { ...real, config: { ...real.config, nodeEnv: 'test', platformPaystack: { secretKey: 'sk_platform' } } };
});
vi.mock('../../services/paystack.js', () => ({
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    PaystackError: class extends Error {},
}));
vi.mock('../../services/crypto.js', () => ({ encrypt: (v: string) => v, decrypt: () => 'sk_tenant' }));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: vi.fn() }));
vi.mock('../../services/payment-fulfillment.js', () => ({
    fulfillBookingCharge: vi.fn(), fulfillOrderCharge: vi.fn(), republishPaymentSucceeded: vi.fn(async () => null),
}));
vi.mock('../../services/payout-transfer.js', () => ({
    markPayoutFailed: vi.fn(async () => ({ applied: true })),
    markPayoutPaid: vi.fn(async () => ({ applied: true })),
    markPayoutReversed: vi.fn(async () => ({ applied: true })),
}));

import { verifyTransaction, verifyWebhookSignature } from '../../services/paystack.js';
import { fulfillBookingCharge, fulfillOrderCharge } from '../../services/payment-fulfillment.js';
import { markPayoutFailed, markPayoutPaid, markPayoutReversed } from '../../services/payout-transfer.js';
import paymentsRoutes from './index.js';

const prisma: any = {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
};

async function build(user?: { role: string }) {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (req: any) => { if (user) req.user = { userId: 'u1', tenantId: 't1', ...user }; });
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        (req as any).rawBody = body;
        done(null, JSON.parse((body as Buffer).toString('utf8')));
    });
    await app.register(paymentsRoutes);
    return app;
}

async function webhook(payload: unknown) {
    const app = await build();
    const res = await app.inject({
        method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json', 'x-paystack-signature': 'sig' }, payload: payload as any,
    });
    await app.close();
    return res;
}

const charge = (metadata: Record<string, unknown> = {}) => ({
    event: 'charge.success',
    data: { reference: 'ref1', amount: 5000, currency: 'GHS', metadata: { tenantId: 't1', ...metadata } },
});

beforeEach(() => {
    vi.clearAllMocks();
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', paystackSecretKey: 'enc' });
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(null);
    (verifyWebhookSignature as any).mockReturnValue(true);
});

describe('webhook does not reveal which tenants exist', () => {
    it('an unknown tenant is answered exactly like a known tenant with a bad signature', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);
        const unknown = await webhook(charge());

        prisma.tenant.findUnique.mockResolvedValue({ id: 't1', paystackSecretKey: 'enc' });
        (verifyWebhookSignature as any).mockReturnValue(false);
        const knownBadSig = await webhook(charge());

        expect(unknown.statusCode).toBe(401);
        expect(knownBadSig.statusCode).toBe(401);
        expect(unknown.json()).toEqual(knownBadSig.json());
    });

    it('a known tenant with no key to verify against is answered the same way too', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ id: 't1', paystackSecretKey: null });
        const noKey = await webhook(charge());
        (verifyWebhookSignature as any).mockReturnValue(false);
        prisma.tenant.findUnique.mockResolvedValue({ id: 't1', paystackSecretKey: 'enc' });
        const badSig = await webhook(charge());
        expect(noKey.statusCode).toBe(401);
        expect(noKey.json()).toEqual(badSig.json());
    });

    it('neither response carries an "ignored" reason that names the cause', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);
        const res = await webhook(charge());
        expect(JSON.stringify(res.json())).not.toMatch(/unknown_tenant|no_verifying_key|ignored/);
    });
});

describe('webhook transfer events', () => {
    const transfer = (event: string) => ({ event, data: { reference: 'po_1' } });

    it('transfer.success settles', async () => {
        await webhook(transfer('transfer.success'));
        expect(markPayoutPaid).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'po_1' }));
    });

    it('transfer.failed returns the money', async () => {
        await webhook(transfer('transfer.failed'));
        expect(markPayoutFailed).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'po_1' }));
        expect(markPayoutReversed).not.toHaveBeenCalled();
    });

    it('transfer.reversed goes to the reversal handler (which also covers a payout that already settled)', async () => {
        const res = await webhook(transfer('transfer.reversed'));
        expect(res.statusCode).toBe(200);
        expect(markPayoutReversed).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'po_1' }));
        expect(markPayoutFailed).not.toHaveBeenCalled();
    });

    it('a handler that throws answers 5xx so Paystack redelivers', async () => {
        (markPayoutReversed as any).mockRejectedValueOnce(new Error('db down'));
        const res = await webhook(transfer('transfer.reversed'));
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
    });
});

describe('a refused charge (underpaid / wrong currency) still answers 200', () => {
    beforeEach(() => {
        (verifyTransaction as any).mockResolvedValue({ status: 'success', amountKobo: 100, currency: 'GHS' });
    });

    it('booking: 200 with the reason, so Paystack stops retrying a deterministic outcome', async () => {
        prisma.booking.findFirst.mockResolvedValue({ id: 'b1', paymentStatus: 'UNPAID', collectionRoute: 'PLATFORM' });
        (fulfillBookingCharge as any).mockResolvedValue({ applied: false, rejected: 'underpaid' });
        const res = await webhook(charge({ bookingId: 'b1' }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, rejected: 'underpaid' });
    });

    it('order: same', async () => {
        prisma.order.findFirst.mockResolvedValue({ id: 'o1', paymentStatus: 'UNPAID', collectionRoute: 'PLATFORM' });
        (fulfillOrderCharge as any).mockResolvedValue({ applied: false, rejected: 'currency_mismatch' });
        const res = await webhook(charge({ orderId: 'o1' }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, rejected: 'currency_mismatch' });
    });

    it('but a failure to RECORD the rejection throws, so the retry is what writes it', async () => {
        prisma.booking.findFirst.mockResolvedValue({ id: 'b1', paymentStatus: 'UNPAID', collectionRoute: 'PLATFORM' });
        (fulfillBookingCharge as any).mockRejectedValue(new Error('events down'));
        const res = await webhook(charge({ bookingId: 'b1' }));
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
    });
});

describe('connect uses the single currency source', () => {
    it('defaults to GHS, not NGN', async () => {
        const app = await build({ role: 'OWNER' });
        vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
        const res = await app.inject({ method: 'POST', url: '/connect', payload: { publicKey: 'pk_test_x', secretKey: 'sk_test_x' } });
        vi.unstubAllGlobals();
        expect(res.statusCode).toBe(200);
        expect(res.json().currency).toBe('GHS');
        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ paymentCurrency: 'GHS' }),
        }));
        await app.close();
    });

    it('/status falls back to GHS', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);
        const app = await build({ role: 'OWNER' });
        const res = await app.inject({ method: 'GET', url: '/status' });
        expect(res.json().currency).toBe('GHS');
        await app.close();
    });
});
