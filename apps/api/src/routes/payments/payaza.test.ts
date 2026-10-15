import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

vi.mock('../../config/index.js', async (orig) => {
    const real = await orig<typeof import('../../config/index.js')>();
    return { ...real, config: { ...real.config, nodeEnv: 'test', apiPublicUrl: 'https://api.bookly.test/', platformPaystack: { secretKey: 'sk_platform' } } };
});
// Real signature check and URL building; only the network calls are replaced.
vi.mock('../../services/payaza.js', async (orig) => ({
    ...(await orig<object>()),
    queryTransaction: vi.fn(),
    probeKeys: vi.fn(),
}));
vi.mock('../../services/paystack.js', () => ({
    initializeTransaction: vi.fn(), verifyTransaction: vi.fn(), verifyWebhookSignature: vi.fn(() => false), PaystackError: class extends Error {},
}));
vi.mock('../../services/crypto.js', () => ({
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ''),
}));
vi.mock('../../services/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: vi.fn() }));
vi.mock('../../services/payment-fulfillment.js', () => ({ fulfillBookingCharge: vi.fn(), fulfillOrderCharge: vi.fn(), republishPaymentSucceeded: vi.fn(async () => null) }));
vi.mock('../../services/payout-transfer.js', () => ({ markPayoutFailed: vi.fn(), markPayoutPaid: vi.fn(), markPayoutReversed: vi.fn() }));

import { probeKeys, queryTransaction } from '../../services/payaza.js';
import { audit } from '../../services/audit.js';
import { raiseAlert } from '../../services/alerts.js';
import { registerFulfillmentOwner, registerPaymentFulfiller, resetPaymentFulfillersForTests } from '../../services/payment-fulfillers.js';
import paymentsRoutes from './index.js';

const PUB = 'PZ78-PKLIVE-AAAA';
const SEC = 'PZ78-SKLIVE-SECRET';
const REF = 'bf_f_ride_package_pass1_1700000000000';

const prisma: any = {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
    order: { findFirst: vi.fn() },
};

async function build(user?: { role: string; tenantId?: string }) {
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

const sign = (raw: string, key = SEC) => crypto.createHmac('sha512', key).update(raw).digest('base64');

async function webhook(payload: Record<string, unknown>, opts: { signature?: string | null; key?: string } = {}) {
    const app = await build();
    const raw = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.signature !== null) headers['x-payaza-signature'] = opts.signature ?? sign(raw, opts.key);
    const res = await app.inject({ method: 'POST', url: '/payaza/webhook', headers, payload: raw });
    await app.close();
    return res;
}

const completed = (over: Record<string, unknown> = {}) => ({
    transaction_reference: 'PZ-TX-1', merchant_reference: REF, status: 'Completed', transaction_status: 'Funds Received',
    amount_received: 960, request_amount: 960, amount_validation: 'EXACT', currency_code: 'GHS', channel: 'GH_MOBILEMONEY',
    customer: { email_address: 'x@y.z', first_name: 'A', last_name: 'B', mobile_number: '233241234567' },
    ...over,
});

const payazaTenant = { id: 't1', payazaPublicKey: `enc:${PUB}`, payazaSecretKey: `enc:${SEC}`, payazaMode: 'LIVE', paymentProvider: 'PAYAZA' };
const fulfiller = vi.fn();
const owner = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    resetPaymentFulfillersForTests();
    registerPaymentFulfiller('ride_package', fulfiller);
    registerFulfillmentOwner('ride_package', owner);
    owner.mockResolvedValue('t1');
    fulfiller.mockResolvedValue({ status: 'applied' });
    prisma.tenant.findUnique.mockResolvedValue(payazaTenant);
    (queryTransaction as any).mockResolvedValue({
        status: 'success', amountKobo: 96000, currency: 'GHS', paidAt: new Date(), reference: REF, customerEmail: '',
        channel: 'GH_MOBILEMONEY', transactionId: 'PZ-TX-1', metadata: null,
    });
});

describe('POST /payments/payaza/webhook', () => {
    it('Completed: verifies with the stored tenant secret, re-queries Payaza, applies the fulfiller with the queried amount', async () => {
        const res = await webhook(completed());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, entity: 'ride_package' });
        expect(owner).toHaveBeenCalledWith(prisma, 'pass1');
        expect(prisma.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' } }));
        expect(queryTransaction).toHaveBeenCalledWith(PUB, 'LIVE', REF);
        expect(fulfiller).toHaveBeenCalledWith(expect.objectContaining({
            tenantId: 't1', entityId: 'pass1', reference: REF, amountMinor: 96000, currency: 'GHS',
            provider: 'PAYAZA', transactionId: 'PZ-TX-1', channel: 'GH_MOBILEMONEY',
        }));
        expect(audit).not.toHaveBeenCalled();
    });

    it('takes the tenant from OUR row, never from the payload', async () => {
        owner.mockResolvedValue('t1');
        await webhook(completed({ additional_details: { tenantId: 't_evil' }, tenantId: 't_evil' }));
        expect(prisma.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' } }));
        expect(fulfiller).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }));
    });

    it('falls back to transaction_reference when merchant_reference is absent', async () => {
        const res = await webhook(completed({ merchant_reference: undefined, transaction_reference: REF }));
        expect(res.statusCode).toBe(200);
        expect(queryTransaction).toHaveBeenCalledWith(PUB, 'LIVE', REF);
    });

    it('rejects a bad or missing signature with 401 before querying or applying anything', async () => {
        expect((await webhook(completed(), { key: 'not-the-secret' })).statusCode).toBe(401);
        expect((await webhook(completed(), { signature: null })).statusCode).toBe(401);
        expect((await webhook(completed(), { signature: 'garbage' })).statusCode).toBe(401);
        expect(queryTransaction).not.toHaveBeenCalled();
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('a tenant without Payaza keys cannot have a webhook verified: 401', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ ...payazaTenant, payazaSecretKey: null });
        expect((await webhook(completed())).statusCode).toBe(401);
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await webhook(completed())).statusCode).toBe(401);
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('a reference that is not ours (other sales on the same Payaza account) is 200 and quiet', async () => {
        const res = await webhook(completed({ merchant_reference: 'SHOP-ORDER-77', transaction_reference: 'PZ-9' }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ignored: 'unknown_reference' });
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('one of our references whose entity no longer exists is 200 and quiet (it cannot be authenticated)', async () => {
        owner.mockResolvedValue(null);
        const res = await webhook(completed());
        expect(res.json()).toEqual({ ignored: 'unknown_reference' });
        expect(fulfiller).not.toHaveBeenCalled();
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('refuses an oversized body before any lookup (every request costs an HMAC)', async () => {
        const res = await webhook(completed({ padding: 'x'.repeat(70 * 1024) }));
        expect(res.statusCode).toBe(413);
        expect(owner).not.toHaveBeenCalled();
    });

    it('no reference at all is 200', async () => {
        const res = await webhook({ status: 'Completed' });
        expect(res.json()).toEqual({ ignored: 'missing_reference' });
    });

    it('a signed Failed notification changes nothing', async () => {
        const res = await webhook(completed({ status: 'Failed', transaction_status: 'Transaction Failed' }));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ignored: 'status_Failed' });
        expect(queryTransaction).not.toHaveBeenCalled();
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('the status query is the source of truth: a webhook saying Completed while Payaza says Initialized applies nothing', async () => {
        (queryTransaction as any).mockResolvedValue({ status: 'pending', amountKobo: 0, currency: 'GHS', paidAt: null, reference: REF, customerEmail: '', metadata: null });
        const res = await webhook(completed());
        expect(res.json()).toEqual({ ignored: 'status_pending' });
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('redelivery is idempotent (the fulfiller answers already_applied)', async () => {
        await webhook(completed());
        fulfiller.mockResolvedValue({ status: 'already_applied' });
        const again = await webhook(completed());
        expect(again.statusCode).toBe(200);
        expect(again.json()).toEqual({ ok: true, idempotent: true });
    });

    it('an underpayment is rejected by the fulfiller and reported loudly (audit + critical alert), still 200', async () => {
        (queryTransaction as any).mockResolvedValue({ status: 'success', amountKobo: 100, currency: 'GHS', paidAt: new Date(), reference: REF, customerEmail: '', metadata: null });
        fulfiller.mockResolvedValue({ status: 'rejected', reason: 'amount_insufficient' });
        const res = await webhook(completed({ amount_received: 1, amount_validation: 'UNDERPAYMENT' }));
        expect(res.statusCode).toBe(200);
        expect(fulfiller).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 100 }));
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'payment.unattributed', tenantId: 't1', targetType: 'PayazaCharge',
            metadata: expect.objectContaining({ reason: 'fulfillment_rejected:amount_insufficient', amountMinor: 100 }),
        }));
        expect(raiseAlert).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'payment.unattributed', severity: 'critical', dedupeKey: `payment.unattributed:t1:${REF}`,
        }));
    });

    it('Payaza unreachable during the status query: 502 so the notification is retried', async () => {
        (queryTransaction as any).mockRejectedValue(new Error('network'));
        const res = await webhook(completed());
        expect(res.statusCode).toBe(502);
        expect(fulfiller).not.toHaveBeenCalled();
    });

    it('a fulfiller crash is 5xx (retried)', async () => {
        fulfiller.mockRejectedValue(new Error('db down'));
        expect((await webhook(completed())).statusCode).toBe(500);
    });
});

describe('Payaza settings', () => {
    const connect = async (body: Record<string, unknown>, role = 'OWNER') => {
        const app = await build({ role });
        const res = await app.inject({ method: 'POST', url: '/payaza/connect', payload: body });
        await app.close();
        return res;
    };

    it('connect is owner-only', async () => {
        expect((await connect({ publicKey: PUB, secretKey: SEC, mode: 'LIVE' }, 'STAFF')).statusCode).toBe(403);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('connect probes the public key in the chosen mode, stores both keys encrypted, audits, and never echoes a secret', async () => {
        (probeKeys as any).mockResolvedValue('valid');
        const res = await connect({ publicKey: ` ${PUB} `, secretKey: SEC, mode: 'LIVE' });
        expect(res.statusCode).toBe(200);
        expect(probeKeys).toHaveBeenCalledWith(PUB, 'LIVE');
        expect(prisma.tenant.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: { payazaPublicKey: `enc:${PUB}`, payazaSecretKey: `enc:${SEC}`, payazaMode: 'LIVE' },
        });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.payaza_connected', metadata: { mode: 'LIVE', publicKeyPrefix: PUB.slice(0, 12) } }));
        expect(res.json()).toEqual({ success: true, mode: 'LIVE', webhookUrl: 'https://api.bookly.test/payments/payaza/webhook' });
        expect(res.body).not.toContain(SEC);
    });

    it('connect refuses keys Payaza rejects', async () => {
        (probeKeys as any).mockResolvedValue('invalid');
        const res = await connect({ publicKey: PUB, secretKey: SEC, mode: 'LIVE' });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/Payaza rejected/);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('connect carries on when Payaza cannot be reached (like the Paystack probe)', async () => {
        (probeKeys as any).mockResolvedValue('unknown');
        expect((await connect({ publicKey: PUB, secretKey: SEC, mode: 'LIVE' })).statusCode).toBe(200);
        expect(prisma.tenant.update).toHaveBeenCalled();
    });

    it('connect refuses a key from the other mode, the same value twice, and malformed input', async () => {
        (probeKeys as any).mockResolvedValue('valid');
        expect((await connect({ publicKey: 'PZ78-PKTEST-AAAA', secretKey: SEC, mode: 'LIVE' })).statusCode).toBe(400);
        expect((await connect({ publicKey: PUB, secretKey: 'PZ78-SKTEST-X', mode: 'LIVE' })).statusCode).toBe(400);
        expect((await connect({ publicKey: PUB, secretKey: SEC, mode: 'TEST' })).statusCode).toBe(400);
        expect((await connect({ publicKey: PUB, secretKey: PUB, mode: 'LIVE' })).statusCode).toBe(400);
        expect((await connect({ publicKey: 'has space', secretKey: SEC, mode: 'LIVE' })).statusCode).toBe(400);
        expect((await connect({ publicKey: PUB, secretKey: SEC, mode: 'PROD' })).statusCode).toBe(400);
        expect((await connect({ publicKey: PUB })).statusCode).toBe(400);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('disconnect is owner-only, clears the keys, and moves a Payaza tenant back to Paystack', async () => {
        const app = await build({ role: 'STAFF' });
        expect((await app.inject({ method: 'POST', url: '/payaza/disconnect' })).statusCode).toBe(403);
        await app.close();

        prisma.tenant.findUnique.mockResolvedValue({ paymentProvider: 'PAYAZA' });
        const owner = await build({ role: 'OWNER' });
        const res = await owner.inject({ method: 'POST', url: '/payaza/disconnect' });
        await owner.close();
        expect(res.json()).toEqual({ disconnected: true, provider: 'PAYSTACK' });
        expect(prisma.tenant.update).toHaveBeenCalledWith({
            where: { id: 't1' },
            data: { payazaPublicKey: null, payazaSecretKey: null, paymentProvider: 'PAYSTACK' },
        });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.payaza_disconnected', metadata: { providerWas: 'PAYAZA' } }));
    });

    describe('PATCH /payments/provider', () => {
        const patch = async (body: unknown, role = 'OWNER') => {
            const app = await build({ role });
            const res = await app.inject({ method: 'PATCH', url: '/provider', payload: body as object });
            await app.close();
            return res;
        };

        it('is owner-only', async () => {
            expect((await patch({ provider: 'PAYAZA' }, 'STAFF')).statusCode).toBe(403);
        });

        it('refuses PAYAZA until Payaza keys are connected', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ paymentProvider: 'PAYSTACK', payazaPublicKey: null, payazaSecretKey: null });
            const res = await patch({ provider: 'PAYAZA' });
            expect(res.statusCode).toBe(400);
            expect(res.json().message).toMatch(/Connect Payaza/);
            expect(prisma.tenant.update).not.toHaveBeenCalled();
        });

        it('switches to PAYAZA when connected, and audits from -> to', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ paymentProvider: 'PAYSTACK', payazaPublicKey: 'enc:x', payazaSecretKey: 'enc:y' });
            const res = await patch({ provider: 'PAYAZA' });
            expect(res.statusCode).toBe(200);
            expect(res.json()).toEqual({ provider: 'PAYAZA' });
            expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { paymentProvider: 'PAYAZA' } });
            expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments.provider_changed', metadata: { from: 'PAYSTACK', to: 'PAYAZA' } }));
        });

        it('switching back to PAYSTACK is always allowed; anything else is a 400', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ paymentProvider: 'PAYAZA', payazaPublicKey: null, payazaSecretKey: null });
            expect((await patch({ provider: 'PAYSTACK' })).statusCode).toBe(200);
            expect((await patch({ provider: 'STRIPE' })).statusCode).toBe(400);
            expect((await patch({})).statusCode).toBe(400);
        });
    });

    it('GET /payments/status adds the provider and the Payaza block, with no secret values', async () => {
        prisma.tenant.findUnique.mockResolvedValue({
            paystackPublicKey: 'pk_live_x', paystackSecretKey: 'enc:sk_live_secret', paymentCurrency: 'GHS',
            paymentProvider: 'PAYAZA', payazaPublicKey: `enc:${PUB}`, payazaSecretKey: `enc:${SEC}`, payazaMode: 'LIVE',
        });
        const app = await build({ role: 'STAFF' });
        const res = await app.inject({ method: 'GET', url: '/status' });
        await app.close();
        expect(res.json()).toEqual({
            connected: true, publicKey: 'pk_live_x', currency: 'GHS',
            provider: 'PAYAZA',
            payaza: { connected: true, mode: 'LIVE', publicKeyPrefix: PUB.slice(0, 12), webhookUrl: 'https://api.bookly.test/payments/payaza/webhook' },
        });
        expect(res.body).not.toContain(SEC);
        expect(res.body).not.toContain('sk_live_secret');
    });

    it('GET /payments/status for a tenant that never touched Payaza', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ paystackPublicKey: null, paystackSecretKey: null, paymentCurrency: 'GHS' });
        const app = await build({ role: 'OWNER' });
        const res = await app.inject({ method: 'GET', url: '/status' });
        await app.close();
        expect(res.json()).toMatchObject({
            connected: false, provider: 'PAYSTACK',
            payaza: { connected: false, mode: 'TEST', publicKeyPrefix: null, webhookUrl: 'https://api.bookly.test/payments/payaza/webhook' },
        });
    });
});
