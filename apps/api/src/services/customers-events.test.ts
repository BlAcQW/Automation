import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));

import { publishEvent } from './events/publish.js';
import { upsertCustomerByPhone } from './customers.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

function db(existing: unknown = null) {
    return {
        customer: {
            findUnique: vi.fn(async () => existing),
            create: vi.fn(async ({ data }: any) => ({ id: 'cu1', attributes: null, ...data })),
        },
        tenant: { findUnique: vi.fn(async () => ({ whatsappDisplayNumber: '+233200000000' })) },
    } as any;
}

beforeEach(() => {
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('customer.created', () => {
    it('goes through the versioned emit helper: payload carries v: 1', async () => {
        await upsertCustomerByPhone(db(), { tenantId: 't1', phone: '+233241234567' });
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][1]).toMatchObject({ tenantId: 't1', type: 'customer.created', payload: { v: 1, customerId: 'cu1' } });
    });

    it('is not published for an existing customer', async () => {
        await upsertCustomerByPhone(db({ id: 'cu1', tenantId: 't1', phone: '+233241234567', name: 'A', email: 'a@x.com' }), { tenantId: 't1', phone: '+233241234567' });
        expect(publish).not.toHaveBeenCalled();
    });

    it('never fails the upsert when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const c = await upsertCustomerByPhone(db(), { tenantId: 't1', phone: '+233241234567' });
        expect(c?.id).toBe('cu1');
    });
});
