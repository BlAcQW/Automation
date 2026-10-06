import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/paystack.js', () => ({
    verifyTransaction: vi.fn(),
    PaystackError: class extends Error {},
}));
vi.mock('../../services/crypto.js', () => ({ encrypt: (v: string) => v, decrypt: () => 'sk_tenant' }));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../../services/booking-cancel.js', () => ({ cancelBooking: vi.fn() }));
vi.mock('../../services/payment-fulfillment.js', () => ({
    fulfillBookingCharge: vi.fn(),
    fulfillOrderCharge: vi.fn(),
    ensurePaymentSucceededOnReturn: vi.fn(async () => undefined),
}));

import { verifyTransaction } from '../../services/paystack.js';
import { ensurePaymentSucceededOnReturn } from '../../services/payment-fulfillment.js';
import publicRoutes from './index.js';

const tenant = { name: 'Salon', paystackSecretKey: 'enc', paymentCurrency: 'GHS' };
const prisma: any = {
    order: { findUnique: vi.fn() },
    booking: { findUnique: vi.fn() },
};

async function verify() {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    await app.register(publicRoutes);
    const res = await app.inject({ method: 'GET', url: '/payments/verify?reference=ref1' });
    await app.close();
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    prisma.order.findUnique.mockResolvedValue(null);
    prisma.booking.findUnique.mockResolvedValue(null);
});

describe('verify-on-return for an already-PAID row', () => {
    it('booking: re-records payment.succeeded (verifying lazily) and answers PAID as before', async () => {
        prisma.booking.findUnique.mockResolvedValue({
            id: 'b1', tenantId: 't1', bookingReference: 'BK-1', depositAmount: 50, paymentStatus: 'PAID',
            collectionRoute: null, startTime: new Date('2030-01-01T10:00:00Z'), tenant,
        });
        const res = await verify();
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'PAID', kind: 'booking', ref: 'BK-1' });
        expect(ensurePaymentSucceededOnReturn).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', reference: 'ref1', extra: { bookingId: 'b1' },
        }));
        // The verify is handed over lazily, not called on every refresh.
        expect(verifyTransaction).not.toHaveBeenCalled();
        const verifyFn = (ensurePaymentSucceededOnReturn as any).mock.calls[0][0].verify;
        (verifyTransaction as any).mockResolvedValue({ status: 'success' });
        await verifyFn();
        expect(verifyTransaction).toHaveBeenCalledWith('sk_tenant', 'ref1');
    });

    it('order: re-records with the orderId and answers PAID as before', async () => {
        prisma.order.findUnique.mockResolvedValue({
            id: 'o1', tenantId: 't1', orderRef: 'ORD-1', totalAmount: 50, paymentStatus: 'PAID',
            collectionRoute: null, publicToken: 'tok', tenant,
        });
        const res = await verify();
        expect(res.json()).toMatchObject({ status: 'PAID', kind: 'order', ref: 'ORD-1' });
        expect(ensurePaymentSucceededOnReturn).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', reference: 'ref1', extra: { orderId: 'o1' },
        }));
    });
});
