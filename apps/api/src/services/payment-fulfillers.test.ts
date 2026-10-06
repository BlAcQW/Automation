import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    registerPaymentFulfiller,
    getPaymentFulfiller,
    resetPaymentFulfillersForTests,
    parseFulfillmentMetadata,
    dispatchFulfillment,
    RESERVED_FULFILLMENT_KINDS,
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
