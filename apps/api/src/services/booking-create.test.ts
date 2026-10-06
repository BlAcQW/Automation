import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveCustomerIdSafe = vi.fn();
vi.mock('./customers.js', () => ({ resolveCustomerIdSafe: (...a: unknown[]) => resolveCustomerIdSafe(...a) }));
vi.mock('./events/publish.js', () => ({ publishEvent: vi.fn() }));

import { createBookingAtomic, afterBookingConfirmed } from './booking-create.js';
import { publishEvent } from './events/publish.js';

const publish = publishEvent as unknown as ReturnType<typeof vi.fn>;

function fakePrisma() {
    const created: any[] = [];
    const tx = {
        tenant: { findUnique: vi.fn(async () => ({ bookingCapacity: 1 })) },
        booking: {
            findMany: vi.fn(async () => []),
            create: vi.fn(async ({ data }: any) => {
                created.push(data);
                return { id: 'b1', ...data };
            }),
        },
    };
    return { created, tx, $transaction: vi.fn(async (fn: any) => fn(tx)) };
}

const base = {
    tenantId: 't1',
    serviceId: 's1',
    customerName: 'Ama',
    customerPhone: '+233241234567',
    startTime: new Date('2030-01-01T10:00:00Z'),
    endTime: new Date('2030-01-01T11:00:00Z'),
    depositAmount: 0,
};

beforeEach(() => {
    resolveCustomerIdSafe.mockReset();
    publish.mockReset();
    publish.mockResolvedValue({ eventId: 'e1' });
});

describe('createBookingAtomic customer linking', () => {
    it('links the booking to the customer record for its phone', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cust-1');
        const db = fakePrisma();
        await createBookingAtomic({ prisma: db as any, ...base, customerEmail: 'a@x.com' });
        expect(resolveCustomerIdSafe).toHaveBeenCalledWith(
            db,
            { tenantId: 't1', phone: '+233241234567', name: 'Ama', email: 'a@x.com' },
            undefined,
        );
        expect(db.created[0].customerId).toBe('cust-1');
        // The phone as typed is still what the booking stores.
        expect(db.created[0].customerPhone).toBe('+233241234567');
    });

    it('resolves the customer before opening the serializable transaction', async () => {
        const order: string[] = [];
        resolveCustomerIdSafe.mockImplementation(async () => { order.push('customer'); return 'c'; });
        const db = fakePrisma();
        db.$transaction.mockImplementation(async (fn: any) => { order.push('tx'); return fn(db.tx); });
        await createBookingAtomic({ prisma: db as any, ...base });
        expect(order).toEqual(['customer', 'tx']);
    });

    it('linkCustomer:false (a typed, unverified phone) never touches customer records', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cust-1');
        const db = fakePrisma();
        await createBookingAtomic({ prisma: db as any, ...base, linkCustomer: false });
        expect(resolveCustomerIdSafe).not.toHaveBeenCalled();
        expect(db.created[0].customerId).toBeNull();
    });

    it('still creates the booking, unlinked, when no customer can be resolved', async () => {
        resolveCustomerIdSafe.mockResolvedValue(null);
        const db = fakePrisma();
        await createBookingAtomic({ prisma: db as any, ...base });
        expect(db.created[0].customerId).toBeNull();
    });

    it('resolves the customer once per call', async () => {
        resolveCustomerIdSafe.mockResolvedValue('c');
        const db = fakePrisma();
        await createBookingAtomic({ prisma: db as any, ...base });
        expect(resolveCustomerIdSafe).toHaveBeenCalledTimes(1);
    });
});

describe('afterBookingConfirmed reminder', () => {
    it('queues a generic booking reminder carrying the customer id', async () => {
        const add = vi.fn().mockResolvedValue({ id: 'j' });
        const start = new Date(Date.now() + 3 * 3600_000);
        await afterBookingConfirmed({
            prisma: { notification: { create: vi.fn().mockResolvedValue({}) } } as any,
            queues: { notifications: null, reminders: { add } as any },
            tenantId: 't1',
            timezone: 'UTC',
            booking: { id: 'b1', bookingReference: 'BK-1', startTime: start, customerName: 'Ama', customerPhone: '+233241234567', customerId: 'cust-1' },
            service: { name: 'Cut' },
        });
        expect(add).toHaveBeenCalledWith(
            'booking_reminder',
            expect.objectContaining({ entityType: 'booking', entityId: 'b1', bookingId: 'b1', customerId: 'cust-1' }),
            expect.objectContaining({ jobId: 'reminder-b1' }),
        );
    });
});

describe('booking.created event', () => {
    it('is published after the transaction commits, with customer and start time', async () => {
        resolveCustomerIdSafe.mockResolvedValue('cust-1');
        const order: string[] = [];
        const db = fakePrisma();
        db.$transaction.mockImplementation(async (fn: any) => { const r = await fn(db.tx); order.push('commit'); return r; });
        publish.mockImplementation(async () => { order.push('publish'); return { eventId: 'e' }; });

        await createBookingAtomic({ prisma: db as any, ...base });

        expect(order).toEqual(['commit', 'publish']);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][0]).toBe(db); // plain client, not the transaction
        expect(publish.mock.calls[0][1]).toEqual({
            tenantId: 't1',
            type: 'booking.created',
            payload: { v: 1, bookingId: 'b1', customerId: 'cust-1', startsAt: '2030-01-01T10:00:00.000Z' },
        });
    });

    it('does not fail (or retry) the booking when the publish throws', async () => {
        publish.mockRejectedValue(new Error('events db down'));
        const db = fakePrisma();
        const created = await createBookingAtomic({ prisma: db as any, ...base });
        expect(created.id).toBe('b1');
        expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it('is not published when the slot is taken', async () => {
        const db = fakePrisma();
        (db.tx.booking.findMany as any).mockResolvedValue([{ id: 'x', startTime: base.startTime, endTime: base.endTime }]);
        await expect(createBookingAtomic({ prisma: db as any, ...base })).rejects.toThrow();
        expect(publish).not.toHaveBeenCalled();
    });
});
