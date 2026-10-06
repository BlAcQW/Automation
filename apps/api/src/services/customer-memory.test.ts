import { describe, it, expect, vi } from 'vitest';
import { buildCustomerMemory } from './customer-memory.js';

function fake(opts: { customer?: any } = {}) {
    return {
        customer: {
            findFirst: vi.fn(async (_args: any) => opts.customer ?? null),
        },
        booking: { findMany: vi.fn(async (_args: any) => [] as any[]) },
        order: { findMany: vi.fn(async (_args: any) => [] as any[]) },
        conversation: { findFirst: vi.fn(async (_args: any) => null as any) },
    };
}

describe('buildCustomerMemory identity', () => {
    it('uses the given customerId (and phone for history that predates linking)', async () => {
        const db = fake();
        await buildCustomerMemory(db as any, 't1', '+233241234567', 'cust-1');
        for (const m of [db.booking.findMany, db.order.findMany] as any[]) {
            expect(m.mock.calls[0][0].where).toEqual({
                tenantId: 't1',
                OR: [{ customerId: 'cust-1' }, { customerPhone: '+233241234567' }],
            });
        }
        expect(db.conversation.findFirst.mock.calls[0][0].where).toEqual({
            tenantId: 't1',
            OR: [{ customerId: 'cust-1' }, { customerPhone: '+233241234567' }],
        });
        expect(db.customer.findFirst).not.toHaveBeenCalled();
    });

    it('looks the customer up by phone when no id is given', async () => {
        const db = fake({ customer: { id: 'cust-9', name: 'Ama' } });
        await buildCustomerMemory(db as any, 't1', '0241234567');
        expect(db.customer.findFirst.mock.calls[0][0].where.tenantId).toBe('t1');
        expect(db.booking.findMany.mock.calls[0][0].where.OR).toContainEqual({ customerId: 'cust-9' });
    });

    it('falls back to the phone alone when there is no customer record', async () => {
        const db = fake();
        await buildCustomerMemory(db as any, 't1', '+233241234567');
        expect(db.booking.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', customerPhone: '+233241234567' });
    });

    it('falls back to the phone when the customer lookup itself fails', async () => {
        const db = fake();
        db.customer.findFirst.mockRejectedValue(new Error('db'));
        const m = await buildCustomerMemory(db as any, 't1', '+233241234567');
        expect(m).toEqual({ summary: '', isReturning: false });
        expect(db.booking.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', customerPhone: '+233241234567' });
    });

    it('names a returning customer from the record when bookings carry no name', async () => {
        const db = fake({ customer: { id: 'cust-9', name: 'Ama Mensah' } });
        db.order.findMany.mockResolvedValue([{ orderRef: 'ORD-1', createdAt: new Date(), status: 'CONFIRMED', totalAmount: 5 }] as any);
        const m = await buildCustomerMemory(db as any, 't1', '+233241234567');
        expect(m.summary).toContain('Name: Ama Mensah.');
        expect(m.isReturning).toBe(true);
    });

    it('is a stranger when nothing is known', async () => {
        const m = await buildCustomerMemory(fake() as any, 't1', '+233241234567');
        expect(m).toEqual({ summary: '', isReturning: false });
    });
});
