import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

beforeEach(() => {
    // Test-mode config defaults from config/index.ts don't include the
    // platform Paystack keys — set them here so paystack-platform calls
    // pass the config guard.
    process.env.BOOKINGFLOW_PAYSTACK_SECRET_KEY = 'sk_test_platform_secret';
    process.env.PAYSTACK_PLAN_STARTER_CODE = 'PLN_starter';
    process.env.PAYSTACK_PLAN_PRO_CODE = 'PLN_pro';
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ensurePaystackCustomer', () => {
    it('POSTs to /customer with Bearer auth and returns customer_code', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({ status: true, data: { customer_code: 'CUS_xyz' } }),
                { status: 200 },
            ),
        );

        const { ensurePaystackCustomer } = await import('./paystack-platform.js');
        const result = await ensurePaystackCustomer({
            email: 'owner@example.com',
            metadata: { tenantId: 't1' },
        });

        expect(result.customerCode).toBe('CUS_xyz');
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toBe('https://api.paystack.co/customer');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk_test_platform_secret');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.email).toBe('owner@example.com');
        expect(body.metadata).toEqual({ tenantId: 't1' });
    });
});

describe('initializeSubscriptionTransaction', () => {
    it('sends amount + plan code + metadata to /transaction/initialize', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    status: true,
                    data: {
                        authorization_url: 'https://checkout.paystack.com/xyz',
                        access_code: 'access_xyz',
                        reference: 'bf_sub_t1_99',
                    },
                }),
                { status: 200 },
            ),
        );

        const { initializeSubscriptionTransaction } = await import('./paystack-platform.js');
        const result = await initializeSubscriptionTransaction({
            email: 'owner@example.com',
            amountKobo: 4900,
            planCode: 'PLN_pro',
            reference: 'bf_sub_t1_99',
            metadata: { tenantId: 't1', planId: 'pro', purpose: 'saas_subscription' },
        });

        expect(result.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
        const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
        expect(body.amount).toBe(4900);
        expect(body.plan).toBe('PLN_pro');
        expect(body.metadata).toMatchObject({ tenantId: 't1', planId: 'pro', purpose: 'saas_subscription' });
    });

    it('rejects non-positive amounts before calling Paystack', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const { initializeSubscriptionTransaction, PlatformPaystackError } = await import(
            './paystack-platform.js'
        );
        await expect(
            initializeSubscriptionTransaction({
                email: 'a@b.com',
                amountKobo: 0,
                planCode: 'PLN_pro',
                reference: 'r',
                metadata: {},
            }),
        ).rejects.toBeInstanceOf(PlatformPaystackError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('surfaces Paystack 4xx as PlatformPaystackError', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: false, message: 'bad plan' }), { status: 400 }),
        );
        const { initializeSubscriptionTransaction } = await import('./paystack-platform.js');
        await expect(
            initializeSubscriptionTransaction({
                email: 'a@b.com',
                amountKobo: 1000,
                planCode: 'PLN_x',
                reference: 'r',
                metadata: {},
            }),
        ).rejects.toMatchObject({ step: 'initialize' });
    });
});

describe('disableSubscription', () => {
    it('POSTs code + token to /subscription/disable', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: true, data: {} }), { status: 200 }),
        );
        const { disableSubscription } = await import('./paystack-platform.js');
        await disableSubscription({ code: 'SUB_abc', token: 'tok_abc' });
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toBe('https://api.paystack.co/subscription/disable');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body).toEqual({ code: 'SUB_abc', token: 'tok_abc' });
    });

    it('rejects missing code / token without calling Paystack', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const { disableSubscription, PlatformPaystackError } = await import('./paystack-platform.js');
        await expect(
            disableSubscription({ code: '', token: 'tok' }),
        ).rejects.toBeInstanceOf(PlatformPaystackError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('verifyPlatformWebhookSignature', () => {
    it('returns true for an HMAC-SHA512 match using the platform secret', async () => {
        const body = Buffer.from('{"event":"charge.success"}');
        const sig = crypto.createHmac('sha512', 'sk_test_platform_secret').update(body).digest('hex');
        const { verifyPlatformWebhookSignature } = await import('./paystack-platform.js');
        expect(verifyPlatformWebhookSignature(body, sig)).toBe(true);
    });

    it('returns false on body tampering', async () => {
        const body = Buffer.from('{"event":"charge.success"}');
        const sig = crypto.createHmac('sha512', 'sk_test_platform_secret').update(body).digest('hex');
        const tampered = Buffer.from('{"event":"charge.evil"}');
        const { verifyPlatformWebhookSignature } = await import('./paystack-platform.js');
        expect(verifyPlatformWebhookSignature(tampered, sig)).toBe(false);
    });

    it('returns false when signature header is missing', async () => {
        const { verifyPlatformWebhookSignature } = await import('./paystack-platform.js');
        expect(verifyPlatformWebhookSignature(Buffer.from('{}'), undefined)).toBe(false);
    });

    it('returns false on length mismatch (no timingSafeEqual crash)', async () => {
        const { verifyPlatformWebhookSignature } = await import('./paystack-platform.js');
        expect(verifyPlatformWebhookSignature(Buffer.from('{}'), 'short')).toBe(false);
    });
});
