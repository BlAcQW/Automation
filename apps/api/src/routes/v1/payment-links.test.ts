import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import v1Routes from './index.js';
import { buildHarness, type Harness } from '../../test-utils/api-harness.js';

vi.mock('../../config/index.js', async () => (await import('../../test-utils/api-harness.js')).configMock());
vi.mock('../../services/events/publish.js', () => ({ publishEvent: vi.fn().mockResolvedValue({ eventId: 'e1' }) }));
vi.mock('../../services/payment-link.js', () => ({ createFulfillmentPaymentLink: vi.fn() }));

import { createFulfillmentPaymentLink } from '../../services/payment-link.js';
import { getPaymentFulfiller, resetPaymentFulfillersForTests } from '../../services/payment-fulfillers.js';

let h: Harness;
beforeEach(async () => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
    (createFulfillmentPaymentLink as any).mockImplementation(async (args: any) => {
        await args.onCreated({ reference: 'bf_f_external_app_ride-1_1', authorizationUrl: 'https://paystack/pay/x', collectionRoute: 'OWN_GATEWAY' });
        return 'https://paystack/pay/x';
    });
    h = await buildHarness(async (app) => { await app.register(v1Routes, { prefix: '/v1' }); });
    h.respond('tenant.findUnique', (args: any) =>
        args?.select?.isActive && !args.select.paystackSecretKey ? { isActive: true } : { id: 'tenant-a', isActive: true, paystackSecretKey: 'enc-key', paymentCurrency: 'GHS' });
});
afterEach(async () => { await h.close(); });

const auth = (k: string) => ({ authorization: `Bearer ${k}` });
const post = (k: string, payload: unknown) => h.app.inject({ method: 'POST', url: '/v1/payment-links', headers: auth(k), payload: payload as any });
const valid = { entityRef: 'ride-1', amountMinor: 2500, customerPhone: '+233241234567' };

describe('POST /v1/payment-links', () => {
    const scopes = ['payments:write' as const];

    it('creates a link on the tenant\'s own gateway with kind external_app and the app\'s entity ref', async () => {
        const k = h.makeKey({ scopes, tenantId: 'tenant-a' });
        const res = await post(k, valid);
        expect(res.statusCode).toBe(201);
        const args = (createFulfillmentPaymentLink as any).mock.calls[0][0];
        expect(args).toMatchObject({
            tenantId: 'tenant-a', paystackSecretKeyEncrypted: 'enc-key', currency: 'GHS',
            kind: 'external_app', entityId: 'ride-1', amount: 25, customerPhone: '+233241234567',
        });
        expect(res.json().data).toEqual({
            url: 'https://paystack/pay/x', reference: 'bf_f_external_app_ride-1_1', entityRef: 'ride-1', amountMinor: 2500, currency: 'GHS',
        });
        expect(h.find('tenant', 'findUnique').every((q) => q.args.where.id === 'tenant-a')).toBe(true);
    });

    it('registers the external_app fulfiller so the link is usable even if index.ts did not', async () => {
        expect(getPaymentFulfiller('external_app')).toBeTypeOf('function');
    });

    it('passes an https callbackUrl through', async () => {
        const k = h.makeKey({ scopes });
        await post(k, { ...valid, callbackUrl: 'https://turbo.example/paid' });
        expect((createFulfillmentPaymentLink as any).mock.calls[0][0].callbackUrl).toBe('https://turbo.example/paid');
    });

    it('422 payments_not_configured when the tenant has no Paystack key (no platform fallback)', async () => {
        (createFulfillmentPaymentLink as any).mockResolvedValue(null);
        h.respond('tenant.findUnique', (args: any) => (args?.select?.isActive && !args.select.paystackSecretKey ? { isActive: true } : { id: 'tenant-a', paystackSecretKey: null, paymentCurrency: 'GHS' }));
        const k = h.makeKey({ scopes });
        const res = await post(k, valid);
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('payments_not_configured');
    });

    it.each([
        ['zero amount', { ...valid, amountMinor: 0 }],
        ['negative amount', { ...valid, amountMinor: -5 }],
        ['fractional amount', { ...valid, amountMinor: 10.5 }],
        ['amount as string', { ...valid, amountMinor: '2500' }],
        ['amount above cap', { ...valid, amountMinor: 100_000_001 }],
        ['missing entityRef', { amountMinor: 2500, customerPhone: '+233241234567' }],
        ['empty entityRef', { ...valid, entityRef: '' }],
        ['entityRef with spaces', { ...valid, entityRef: 'ride 1' }],
        ['entityRef with sql chars', { ...valid, entityRef: "x'; DROP--" }],
        ['entityRef over 100', { ...valid, entityRef: 'a'.repeat(101) }],
        ['bad phone', { ...valid, customerPhone: '0241234567' }],
        ['http callback', { ...valid, callbackUrl: 'http://turbo.example/paid' }],
        ['callback with credentials', { ...valid, callbackUrl: 'https://u:p@turbo.example/paid' }],
        ['unknown field (currency override)', { ...valid, currency: 'USD' }],
    ])('400 for %s', async (_n, payload) => {
        const k = h.makeKey({ scopes });
        const res = await post(k, payload);
        expect(res.statusCode).toBe(400);
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });

    it('accepts entityRef at 100 chars with allowed punctuation', async () => {
        const k = h.makeKey({ scopes });
        expect((await post(k, { ...valid, entityRef: 'ride:1_a-b.c'.padEnd(100, 'z') })).statusCode).toBe(201);
    });

    it('403 without payments:write', async () => {
        const k = h.makeKey({ scopes: ['messages:write'] });
        expect((await post(k, valid)).statusCode).toBe(403);
        expect(createFulfillmentPaymentLink).not.toHaveBeenCalled();
    });
});
