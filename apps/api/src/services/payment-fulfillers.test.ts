import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    registerPaymentFulfiller,
    getPaymentFulfiller,
    resetPaymentFulfillersForTests,
    parseFulfillmentMetadata,
    dispatchFulfillment,
    RESERVED_FULFILLMENT_KINDS,
    buildFulfillmentReference,
    parseFulfillmentReference,
    registerFulfillmentOwner,
    resolveFulfillmentTenant,
} from './payment-fulfillers.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const prisma: any = {};
const verified = (over: Record<string, unknown> = {}) => ({
    status: 'success' as const, amountKobo: 5000, currency: 'GHS', paidAt: null,
    reference: 'ref1', customerEmail: 'a@b.c',
    // Paystack returns the metadata we set when the link was created.
    metadata: { fulfillmentKind: 'ride_package', entityId: 'e1', tenantId: 't1' },
    ...over,
});
const base = (over: Record<string, unknown> = {}) => ({
    prisma, tenantId: 't1', reference: 'ref1', log,
    metadata: { fulfillmentKind: 'ride_package', entityId: 'e1' } as Record<string, unknown>,
    verify: vi.fn().mockResolvedValue(verified()),
    ...over,
});

beforeEach(() => { resetPaymentFulfillersForTests(); vi.clearAllMocks(); });

describe('registry', () => {
    it('registers and looks up a fulfiller', () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        expect(getPaymentFulfiller('ride_package')).toBe(f);
        expect(getPaymentFulfiller('nope')).toBeUndefined();
    });
    it('refuses reserved kinds', () => {
        expect(RESERVED_FULFILLMENT_KINDS).toEqual(['booking', 'order']);
        expect(() => registerPaymentFulfiller('booking', vi.fn())).toThrow(/reserved/i);
        expect(() => registerPaymentFulfiller('order', vi.fn())).toThrow(/reserved/i);
    });
    it('refuses malformed kinds and double registration', () => {
        for (const k of ['', 'Ride', 'has space', 'a'.repeat(41), '__proto__', 'x-y']) {
            expect(() => registerPaymentFulfiller(k, vi.fn())).toThrow();
        }
        registerPaymentFulfiller('ride_payg', vi.fn());
        expect(() => registerPaymentFulfiller('ride_payg', vi.fn())).toThrow(/already/i);
    });
});

describe('parseFulfillmentMetadata', () => {
    it('is absent when no fulfillmentKind', () => {
        expect(parseFulfillmentMetadata(undefined)).toEqual({ state: 'absent' });
        expect(parseFulfillmentMetadata({ tenantId: 't' })).toEqual({ state: 'absent' });
    });
    it('parses kind and entityId', () => {
        expect(parseFulfillmentMetadata({ fulfillmentKind: 'k_1', entityId: 'e' })).toEqual({ state: 'present', kind: 'k_1', entityId: 'e' });
    });
    it('flags missing, non-string or oversized entityId and non-string kind', () => {
        expect(parseFulfillmentMetadata({ fulfillmentKind: 'k' })).toEqual({ state: 'invalid', reason: 'fulfillment_entity_missing' });
        expect(parseFulfillmentMetadata({ fulfillmentKind: 'k', entityId: 5 })).toMatchObject({ state: 'invalid' });
        expect(parseFulfillmentMetadata({ fulfillmentKind: 'k', entityId: 'x'.repeat(101) })).toMatchObject({ state: 'invalid' });
        expect(parseFulfillmentMetadata({ fulfillmentKind: { a: 1 }, entityId: 'e' })).toMatchObject({ state: 'invalid' });
    });
});

describe('dispatchFulfillment', () => {
    it('reports unregistered kinds without calling Paystack', async () => {
        const args = base();
        const r = await dispatchFulfillment(args);
        expect(r).toMatchObject({ unattributedReason: 'fulfillment_kind_unregistered', body: { ignored: 'fulfillment_kind_unregistered' } });
        expect(args.verify).not.toHaveBeenCalled();
    });
    it('reports invalid metadata', async () => {
        const r = await dispatchFulfillment(base({ metadata: { fulfillmentKind: 'ride_package' } }));
        expect(r.unattributedReason).toBe('fulfillment_entity_missing');
    });
    it('reserved kinds in metadata are never dispatched', async () => {
        const r = await dispatchFulfillment(base({ metadata: { fulfillmentKind: 'booking', entityId: 'e' } }));
        expect(r.unattributedReason).toBe('fulfillment_kind_unregistered');
    });
    it('passes the VERIFIED amount and currency to the fulfiller', async () => {
        const f = vi.fn().mockResolvedValue({ status: 'applied' });
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base());
        expect(f).toHaveBeenCalledWith({
            prisma, tenantId: 't1', entityId: 'e1', reference: 'ref1', amountMinor: 5000, currency: 'GHS', log,
        });
        expect(r).toEqual({ body: { ok: true, entity: 'ride_package' } });
    });
    it('passes Paystack\'s transaction id and channel through (shown to the business as the transaction ID)', async () => {
        const f = vi.fn().mockResolvedValue({ status: 'applied' });
        registerPaymentFulfiller('ride_package', f);
        await dispatchFulfillment(base({ verify: vi.fn().mockResolvedValue(verified({ transactionId: '4099260516', channel: 'mobile_money' })) }));
        expect(f).toHaveBeenCalledWith(expect.objectContaining({ transactionId: '4099260516', channel: 'mobile_money' }));
    });
    it('answers idempotent when the fulfiller says already_applied', async () => {
        registerPaymentFulfiller('ride_package', vi.fn().mockResolvedValue({ status: 'already_applied' }));
        expect(await dispatchFulfillment(base())).toEqual({ body: { ok: true, idempotent: true } });
    });
    it('turns a rejection into an unattributed report with a distinct reason', async () => {
        registerPaymentFulfiller('ride_package', vi.fn().mockResolvedValue({ status: 'rejected', reason: 'amount_mismatch' }));
        const r = await dispatchFulfillment(base());
        expect(r.unattributedReason).toBe('fulfillment_rejected:amount_mismatch');
        expect(r.body).toEqual({ ignored: 'fulfillment_rejected' });
        expect(r.amountMinor).toBe(5000);
    });
    it('ignores a charge Paystack does not confirm as success', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({ verify: vi.fn().mockResolvedValue(verified({ status: 'failed' })) }));
        expect(r.body).toEqual({ ignored: 'status_failed' });
        expect(f).not.toHaveBeenCalled();
    });
    it('refuses when Paystack-side metadata disagrees with the webhook metadata', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({
            verify: vi.fn().mockResolvedValue(verified({ metadata: { fulfillmentKind: 'ride_package', entityId: 'OTHER' } })),
        }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        expect(f).not.toHaveBeenCalled();
    });
    it('refuses when Paystack returns no metadata, rather than trusting the webhook alone', async () => {
        // Otherwise a tenant could pair one cheap real charge (made without
        // metadata) with a self-signed webhook naming a pricier entity.
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({ verify: vi.fn().mockResolvedValue(verified({ metadata: null })) }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        expect(f).not.toHaveBeenCalled();
    });
    it('refuses when the Paystack-side tenant differs from the verified request tenant', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({
            verify: vi.fn().mockResolvedValue(verified({
                metadata: { fulfillmentKind: 'ride_package', entityId: 'e1', tenantId: 'someone_else' },
            })),
        }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        expect(f).not.toHaveBeenCalled();
    });
    it('lets a fulfiller error propagate so Paystack retries', async () => {
        registerPaymentFulfiller('ride_package', vi.fn().mockRejectedValue(new Error('db down')));
        await expect(dispatchFulfillment(base())).rejects.toThrow('db down');
    });
    it('treats an unknown outcome as a failure rather than success', async () => {
        registerPaymentFulfiller('ride_package', vi.fn().mockResolvedValue(undefined));
        await expect(dispatchFulfillment(base())).rejects.toThrow(/outcome/i);
    });
});

describe('dispatchFulfillment with trusted metadata (providers that do not echo metadata, e.g. Payaza)', () => {
    const trusted = { fulfillmentKind: 'ride_package', entityId: 'e1', tenantId: 't1' };
    const payazaVerified = verified({ metadata: null, reference: 'ref1' });

    it('uses the trusted metadata when the provider returns none, and passes the provider to the fulfiller', async () => {
        const f = vi.fn().mockResolvedValue({ status: 'applied' });
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({
            trustedMetadata: trusted, provider: 'PAYAZA', verify: vi.fn().mockResolvedValue(payazaVerified),
        }));
        expect(r.body).toEqual({ ok: true, entity: 'ride_package' });
        expect(f).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'e1', amountMinor: 5000, provider: 'PAYAZA' }));
    });

    it('still refuses when the trusted metadata disagrees with the dispatched kind, entity or tenant', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        for (const bad of [
            { ...trusted, entityId: 'OTHER' },
            { ...trusted, tenantId: 'someone_else' },
            { ...trusted, fulfillmentKind: 'ride_payg' },
        ]) {
            const r = await dispatchFulfillment(base({ trustedMetadata: bad, verify: vi.fn().mockResolvedValue(payazaVerified) }));
            expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        }
        expect(f).not.toHaveBeenCalled();
    });

    it('refuses when the provider answered about a different reference', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({
            trustedMetadata: trusted, verify: vi.fn().mockResolvedValue(verified({ metadata: null, reference: 'other_ref' })),
        }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        expect(f).not.toHaveBeenCalled();
    });

    it('provider metadata, when present, still wins over trusted metadata (Paystack behaviour unchanged)', async () => {
        const f = vi.fn();
        registerPaymentFulfiller('ride_package', f);
        const r = await dispatchFulfillment(base({
            trustedMetadata: trusted,
            verify: vi.fn().mockResolvedValue(verified({ metadata: { fulfillmentKind: 'ride_package', entityId: 'OTHER', tenantId: 't1' } })),
        }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
        expect(f).not.toHaveBeenCalled();
    });

    it('without trusted metadata, a provider answer with no metadata is still a mismatch', async () => {
        registerPaymentFulfiller('ride_package', vi.fn());
        const r = await dispatchFulfillment(base({ verify: vi.fn().mockResolvedValue(payazaVerified) }));
        expect(r.unattributedReason).toBe('fulfillment_metadata_mismatch');
    });
});

describe('fulfillment references', () => {
    it('builds bf_f_{kind}_{entityId}_{ts}', () => {
        expect(buildFulfillmentReference('ride_package', 'pass1', 1700000000000)).toBe('bf_f_ride_package_pass1_1700000000000');
    });

    it('parses back kind and entity id against the registered kinds, even when both contain underscores', () => {
        registerPaymentFulfiller('ride_package', vi.fn());
        registerPaymentFulfiller('flow_payment', vi.fn());
        expect(parseFulfillmentReference('bf_f_ride_package_ck_9a_1700000000000')).toEqual({ kind: 'ride_package', entityId: 'ck_9a' });
        expect(parseFulfillmentReference('bf_f_flow_payment_conv_1.pay_step.2500.GHS_1700000000000'))
            .toEqual({ kind: 'flow_payment', entityId: 'conv_1.pay_step.2500.GHS' });
    });

    it('refuses a kind that is an underscore-prefix of another (references would be ambiguous)', () => {
        registerPaymentFulfiller('ride', vi.fn());
        expect(() => registerPaymentFulfiller('ride_payg', vi.fn())).toThrow(/ambiguous/);
        resetPaymentFulfillersForTests();
        registerPaymentFulfiller('ride_payg', vi.fn());
        expect(() => registerPaymentFulfiller('ride', vi.fn())).toThrow(/ambiguous/);
        // A plain string prefix without the separator is fine.
        registerPaymentFulfiller('ride_pay', vi.fn());
        expect(parseFulfillmentReference('bf_f_ride_payg_r1_1')).toEqual({ kind: 'ride_payg', entityId: 'r1' });
        expect(parseFulfillmentReference('bf_f_ride_pay_r1_1')).toEqual({ kind: 'ride_pay', entityId: 'r1' });
    });

    it('returns null for anything that is not one of ours', () => {
        registerPaymentFulfiller('ride_package', vi.fn());
        for (const ref of ['', 'bf_o_ord1_1', 'PZ-123', 'bf_f_ride_package__1', 'bf_f_ride_package_e1', 'bf_f_unknown_e1_1', `bf_f_ride_package_${'x'.repeat(101)}_1`, 'bf_f_ride_package_e1_1x']) {
            expect(parseFulfillmentReference(ref)).toBeNull();
        }
    });
});

describe('fulfillment owners (which tenant a reference belongs to)', () => {
    it('asks the resolver registered for the kind', async () => {
        const owner = vi.fn().mockResolvedValue('t9');
        registerFulfillmentOwner('ride_package', owner);
        expect(await resolveFulfillmentTenant(prisma, 'ride_package', 'e1')).toBe('t9');
        expect(owner).toHaveBeenCalledWith(prisma, 'e1');
    });

    it('is null for a kind with no resolver, and refuses double registration', async () => {
        expect(await resolveFulfillmentTenant(prisma, 'nope', 'e1')).toBeNull();
        registerFulfillmentOwner('ride_package', vi.fn());
        expect(() => registerFulfillmentOwner('ride_package', vi.fn())).toThrow(/already/);
    });
});
