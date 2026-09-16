import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real Paystack call is ever made from this file.
vi.mock('./paystack.js', () => ({ initializeTransaction: vi.fn() }));
vi.mock('./crypto.js', () => ({ decrypt: (v: string) => `dec(${v})` }));
vi.mock('../config/index.js', () => ({ config: { paystack: { callbackUrl: 'https://cb.example/paid' }, frontendUrl: 'https://app.example' } }));

import { initializeTransaction } from './paystack.js';
import { createPaymentLink } from './payment-link.js';

const prisma: any = { booking: { update: vi.fn() }, order: { update: vi.fn() } };
const base = {
    prisma, tenantId: 't1', paystackSecretKeyEncrypted: 'enc', currency: 'GHS',
    entity: 'booking' as const, id: 'bk1', amount: 25, customerPhone: '+233 24 000 0000',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('createPaymentLink', () => {
    it('initialises Paystack in subunits with the tenant currency and stores the link on the booking', async () => {
        (initializeTransaction as any).mockResolvedValue({ authorizationUrl: 'https://pay/x', reference: 'bf_bk1_1', accessCode: 'ac' });

        const url = await createPaymentLink(base);

        expect(url).toBe('https://pay/x');
        const call = (initializeTransaction as any).mock.calls[0][0];
        expect(call.amountKobo).toBe(2500);              // 25.00 GHS -> 2500 pesewas
        expect(call.currency).toBe('GHS');
        expect(call.secretKey).toBe('dec(enc)');          // decrypted, never the stored value
        expect(call.email).toBe('233240000000@customer.bookingflow.app');
        expect(call.metadata).toMatchObject({ tenantId: 't1', bookingId: 'bk1' });
        expect(prisma.booking.update).toHaveBeenCalledWith({
            where: { id: 'bk1' },
            data: { paymentReference: 'bf_bk1_1', paymentAuthorizationUrl: 'https://pay/x' },
        });
    });

    it('returns null without calling Paystack when the tenant has no key', async () => {
        expect(await createPaymentLink({ ...base, paystackSecretKeyEncrypted: null })).toBeNull();
        expect(initializeTransaction).not.toHaveBeenCalled();
    });

    it('returns null instead of throwing when Paystack fails — the booking must survive', async () => {
        (initializeTransaction as any).mockRejectedValue(new Error('paystack down'));
        expect(await createPaymentLink(base)).toBeNull();
        expect(prisma.booking.update).not.toHaveBeenCalled();
    });

    it('updates the order row for order payments', async () => {
        (initializeTransaction as any).mockResolvedValue({ authorizationUrl: 'https://pay/o', reference: 'r', accessCode: 'a' });
        await createPaymentLink({ ...base, entity: 'order', id: 'or1' });
        expect(prisma.order.update).toHaveBeenCalled();
        expect(prisma.booking.update).not.toHaveBeenCalled();
        expect((initializeTransaction as any).mock.calls[0][0].metadata).toMatchObject({ orderId: 'or1' });
    });
});
