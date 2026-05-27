import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
    initializeTransaction,
    verifyTransaction,
    verifyWebhookSignature,
    PaystackError,
} from './paystack';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('initializeTransaction', () => {
    it('POSTs to /transaction/initialize with Bearer auth + JSON body and returns the URL', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    status: true,
                    data: {
                        authorization_url: 'https://checkout.paystack.com/xyz',
                        access_code: 'access_xyz',
                        reference: 'bf_order123_111',
                    },
                }),
                { status: 200 },
            ),
        );

        const result = await initializeTransaction({
            secretKey: 'sk_test_abc',
            email: 'cust@example.com',
            amountKobo: 500000, // ₦5,000
            currency: 'NGN',
            reference: 'bf_order123_111',
            callbackUrl: 'https://app.example.com/orders/paid',
            metadata: { tenantId: 't1', orderId: 'o1' },
        });

        expect(result.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
        expect(result.reference).toBe('bf_order123_111');
        expect(result.accessCode).toBe('access_xyz');

        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toBe('https://api.paystack.co/transaction/initialize');
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer sk_test_abc');
        expect(headers['Content-Type']).toBe('application/json');

        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.email).toBe('cust@example.com');
        expect(body.amount).toBe(500000);
        expect(body.currency).toBe('NGN');
        expect(body.metadata).toEqual({ tenantId: 't1', orderId: 'o1' });
    });

    it('rejects non-positive amounts before calling Paystack', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await expect(
            initializeTransaction({
                secretKey: 'sk_test',
                email: 'x@y.com',
                amountKobo: 0,
                currency: 'NGN',
                reference: 'r',
                metadata: {},
            }),
        ).rejects.toBeInstanceOf(PaystackError);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('surfaces Paystack 401 as PaystackError("initialize")', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: false, message: 'Invalid key' }), { status: 401 }),
        );
        await expect(
            initializeTransaction({
                secretKey: 'sk_bad',
                email: 'x@y.com',
                amountKobo: 1000,
                currency: 'NGN',
                reference: 'r',
                metadata: {},
            }),
        ).rejects.toMatchObject({ step: 'initialize' });
    });

    it('wraps fetch network errors as PaystackError("initialize")', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection reset'));
        await expect(
            initializeTransaction({
                secretKey: 'sk_test',
                email: 'x@y.com',
                amountKobo: 1000,
                currency: 'NGN',
                reference: 'r',
                metadata: {},
            }),
        ).rejects.toMatchObject({
            step: 'initialize',
            message: expect.stringContaining('network_error'),
        });
    });
});

describe('verifyTransaction', () => {
    it('returns success with paidAt + amount on a successful verify', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    status: true,
                    data: {
                        status: 'success',
                        amount: 500000,
                        currency: 'NGN',
                        paid_at: '2026-05-12T10:00:00.000Z',
                        reference: 'bf_o1_1',
                        customer: { email: 'cust@example.com' },
                        channel: 'card',
                    },
                }),
                { status: 200 },
            ),
        );

        const result = await verifyTransaction('sk_test', 'bf_o1_1');
        expect(result.status).toBe('success');
        expect(result.amountKobo).toBe(500000);
        expect(result.currency).toBe('NGN');
        expect(result.paidAt).toBeInstanceOf(Date);
        expect(result.channel).toBe('card');
        expect(result.customerEmail).toBe('cust@example.com');
    });

    it('returns non-success statuses without throwing', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(
                JSON.stringify({
                    status: true,
                    data: {
                        status: 'abandoned',
                        amount: 500000,
                        currency: 'NGN',
                        paid_at: null,
                        reference: 'bf_o1_1',
                        customer: { email: 'cust@example.com' },
                    },
                }),
                { status: 200 },
            ),
        );
        const result = await verifyTransaction('sk_test', 'bf_o1_1');
        expect(result.status).toBe('abandoned');
        expect(result.paidAt).toBeNull();
    });

    it('throws PaystackError when Paystack rejects', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ status: false, message: 'Not found' }), { status: 404 }),
        );
        await expect(verifyTransaction('sk_test', 'missing')).rejects.toMatchObject({
            step: 'verify',
        });
    });
});

describe('verifyWebhookSignature', () => {
    const secret = 'sk_test_secret';
    const body = Buffer.from('{"event":"charge.success","data":{"reference":"r"}}');
    const correctSig = crypto.createHmac('sha512', secret).update(body).digest('hex');

    it('returns true on a matching signature', () => {
        expect(verifyWebhookSignature(body, correctSig, secret)).toBe(true);
    });

    it('returns false when the body is tampered', () => {
        const tampered = Buffer.from('{"event":"charge.success","data":{"reference":"evil"}}');
        expect(verifyWebhookSignature(tampered, correctSig, secret)).toBe(false);
    });

    it('returns false when the signature header is missing', () => {
        expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    });

    it('returns false (no crash) on length mismatch — timingSafeEqual would throw', () => {
        expect(verifyWebhookSignature(body, 'tooshort', secret)).toBe(false);
    });

    it('returns false when the secret is empty', () => {
        expect(verifyWebhookSignature(body, correctSig, '')).toBe(false);
    });
});
