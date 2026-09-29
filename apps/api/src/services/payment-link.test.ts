import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real Paystack call is ever made from this file.
vi.mock('./paystack.js', () => ({ initializeTransaction: vi.fn() }));
vi.mock('./crypto.js', () => ({ decrypt: (v: string) => `dec(${v})` }));
vi.mock('../config/index.js', () => ({ config: { paystack: { callbackUrl: 'https://cb.example/paid' }, frontendUrl: 'https://app.example', platformPaystack: { secretKey: 'sk_platform' } } }));

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
            data: {
                paymentReference: 'bf_bk1_1',
                paymentAuthorizationUrl: 'https://pay/x',
                // The security boundary: which account collected this is
                // persisted server-side here, and is the ONLY thing allowed to
                // decide later whether a wallet may be credited.
                collectionRoute: 'OWN_GATEWAY',
            },
        });
    });

    it('collects into the platform account when the tenant has no key of their own', async () => {
        // The product promise: a salon owner never creates a Paystack account.
        (initializeTransaction as any).mockResolvedValue({ authorizationUrl: 'https://pay/p', reference: 'bf_p_bk1_1', accessCode: 'ac' });

        const url = await createPaymentLink({ ...base, paystackSecretKeyEncrypted: null });

        expect(url).toBe('https://pay/p');
        const call = (initializeTransaction as any).mock.calls[0][0];
        expect(call.secretKey).toBe('sk_platform');
        expect(call.metadata).toMatchObject({ collectionRoute: 'PLATFORM' });
        // Persisted, not merely stamped on the provider payload — metadata is
        // attacker-controlled once a tenant connects their own key.
        expect(prisma.booking.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ collectionRoute: 'PLATFORM' }) }),
        );
        // The reference carries the route, so the webhook can tell whether
        // this money is in our balance before crediting any wallet.
        expect(call.reference).toMatch(/^bf_p_/);
    });

    it('keeps using the tenant gateway when they already connected one', async () => {
        // Money a tenant is already collecting must never silently start
        // landing in someone else's account.
        (initializeTransaction as any).mockResolvedValue({ authorizationUrl: 'https://pay/o', reference: 'bf_o_bk1_1', accessCode: 'ac' });

        await createPaymentLink(base);

        const call = (initializeTransaction as any).mock.calls[0][0];
        expect(call.secretKey).toBe('dec(enc)');
        expect(call.metadata).toMatchObject({ collectionRoute: 'OWN_GATEWAY' });
        expect(call.reference).toMatch(/^bf_o_/);
    });

    it('returns null without calling Paystack when no account is available at all', async () => {
        const { config } = await import('../config/index.js') as any;
        const saved = config.platformPaystack.secretKey;
        config.platformPaystack.secretKey = undefined;
        expect(await createPaymentLink({ ...base, paystackSecretKeyEncrypted: null })).toBeNull();
        expect(initializeTransaction).not.toHaveBeenCalled();
        config.platformPaystack.secretKey = saved;
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
