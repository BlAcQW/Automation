import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../services/paystack.js', () => ({
    initializeTransaction: vi.fn(),
    verifyTransaction: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    PaystackError: class extends Error {},
}));
vi.mock('../../services/crypto.js', () => ({ encrypt: (v: string) => v, decrypt: () => 'sk_tenant' }));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: vi.fn() }));
vi.mock('../../services/payment-fulfillment.js', () => ({ fulfillBookingCharge: vi.fn(), fulfillOrderCharge: vi.fn(), republishPaymentSucceeded: vi.fn(async () => null) }));
vi.mock('../../services/payout-transfer.js', () => ({ markPayoutFailed: vi.fn(), markPayoutPaid: vi.fn() }));

import { verifyTransaction, verifyWebhookSignature } from '../../services/paystack.js';
import { audit } from '../../services/audit.js';
import { raiseAlert } from '../../services/alerts.js';
import { fulfillOrderCharge, republishPaymentSucceeded } from '../../services/payment-fulfillment.js';
import { registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../../services/payment-fulfillers.js';
import paymentsRoutes from './index.js';

const prisma: any = {
    tenant: { findUnique: vi.fn() },
    booking: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
};

async function post(metadata: Record<string, unknown>, event = 'charge.success') {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async () => {});
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
        (req as any).rawBody = body;
        done(null, JSON.parse((body as Buffer).toString('utf8')));
    });
    await app.register(paymentsRoutes);
    const res = await app.inject({
        method: 'POST', url: '/webhook', headers: { 'content-type': 'application/json', 'x-paystack-signature': 'sig' },
        payload: { event, data: { reference: 'ref1', amount: 5000, currency: 'GHS', metadata: { tenantId: 't1', ...metadata } } },
    });
    await app.close();
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', paystackSecretKey: 'enc' });
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(null);
    (verifyWebhookSignature as any).mockReturnValue(true);
    (verifyTransaction as any).mockResolvedValue({
        status: 'success', amountKobo: 5000, currency: 'GHS', metadata: { fulfillmentKind: 'ride_package', entityId: 'e1', tenantId: 't1' },
    });
});

describe('webhook fulfillment dispatch', () => {
    it('dispatches a registered kind with the verified amount, using the tenant key', async () => {
        const f = vi.fn().mockResolvedValue({ status: 'applied' });
        registerPaymentFulfiller('ride_package', f);
        const res = await post({ fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, entity: 'ride_package' });
        expect(verifyTransaction).toHaveBeenCalledWith('sk_tenant', 'ref1');
        expect(f).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', entityId: 'e1', reference: 'ref1', amountMinor: 5000, currency: 'GHS',
        }));
        expect(audit).not.toHaveBeenCalled();
    });

    it('rejects a bad signature before any dispatch', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        (verifyWebhookSignature as any).mockReturnValue(false);
        const res = await post({ fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.statusCode).toBe(401);
        expect(f).not.toHaveBeenCalled();
    });

    it('reports an unregistered kind as unattributed with a distinct reason, still 200', async () => {
        const res = await post({ fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'payment.unattributed',
            metadata: expect.objectContaining({ reason: 'fulfillment_kind_unregistered' }),
        }));
    });

    it('raises a critical alert deduped per reference for an unattributed charge', async () => {
        const res = await post({ fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.statusCode).toBe(200);
        expect(raiseAlert).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'payment.unattributed',
            severity: 'critical',
            tenantId: 't1',
            dedupeKey: 'payment.unattributed:t1:ref1',
        }));
    });

    it('reports a missing entityId as unattributed, still 200', async () => {
        registerPaymentFulfiller('ride_package', vi.fn());
        const res = await post({ fulfillmentKind: 'ride_package' });
        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ reason: 'fulfillment_entity_missing' }),
        }));
    });

    it('lets the order path win when orderId is present (fulfillmentKind ignored)', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        prisma.order.findFirst.mockResolvedValue({ id: 'o1', paymentStatus: 'UNPAID', collectionRoute: 'OWN_GATEWAY' });
        (verifyTransaction as any).mockResolvedValue({ status: 'success', amountKobo: 5000, currency: 'GHS' });
        (fulfillOrderCharge as any).mockResolvedValue({ applied: true });
        const res = await post({ orderId: 'o1', fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.json()).toEqual({ ok: true, entity: 'order' });
        expect(f).not.toHaveBeenCalled();
    });

    it('still reports no_entity_metadata when nothing identifies the charge', async () => {
        const res = await post({});
        expect(res.statusCode).toBe(200);
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({ reason: 'no_entity_metadata' }),
        }));
    });

    it('returns 5xx when a fulfiller throws so Paystack retries', async () => {
        registerPaymentFulfiller('ride_package', vi.fn().mockRejectedValue(new Error('db down')));
        const res = await post({ fulfillmentKind: 'ride_package', entityId: 'e1' });
        expect(res.statusCode).toBe(500);
    });
});

describe('webhook on an already-PAID row re-records payment.succeeded', () => {
    const paidBooking = { id: 'b1', paymentStatus: 'PAID' };
    const paidOrder = { id: 'o1', paymentStatus: 'PAID' };

    it('booking: republishes from the signed event data, then answers idempotent', async () => {
        prisma.booking.findFirst.mockResolvedValue(paidBooking);
        const res = await post({ bookingId: 'b1' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, idempotent: true });
        expect(republishPaymentSucceeded).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', reference: 'ref1', amountMinor: 5000, currency: 'GHS', extra: { bookingId: 'b1' },
        }));
        expect(verifyTransaction).not.toHaveBeenCalled();
    });

    it('booking: a failed republish answers non-2xx so Paystack redelivers (nothing is re-applied: the row is PAID)', async () => {
        prisma.booking.findFirst.mockResolvedValue(paidBooking);
        (republishPaymentSucceeded as any).mockResolvedValueOnce(new Error('events down'));
        const res = await post({ bookingId: 'b1' });
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        expect(fulfillOrderCharge).not.toHaveBeenCalled();
    });

    it('order: republishes, and a failure is non-2xx', async () => {
        prisma.order.findFirst.mockResolvedValue(paidOrder);
        const ok = await post({ orderId: 'o1' });
        expect(ok.statusCode).toBe(200);
        expect(republishPaymentSucceeded).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', reference: 'ref1', amountMinor: 5000, currency: 'GHS', extra: { orderId: 'o1' },
        }));
        (republishPaymentSucceeded as any).mockResolvedValueOnce(new Error('events down'));
        const bad = await post({ orderId: 'o1' });
        expect(bad.statusCode).toBeGreaterThanOrEqual(500);
    });
});
