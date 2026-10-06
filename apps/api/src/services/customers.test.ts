import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
    upsertCustomerByPhone,
    linkConversationToCustomer,
    resolveCustomerIdSafe,
    findCustomerEmail,
    resolveCustomerEmail,
} from './customers.js';

type Row = {
    id: string; tenantId: string; phone: string; name: string | null; email: string | null;
    attributes: unknown; createdAt: Date; updatedAt: Date;
};

function p2002() {
    return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
}

/** In-memory stand-in for the slice of prisma these functions touch. */
function fakePrisma(opts: { displayNumber?: string | null; raceOnCreate?: boolean } = {}) {
    const rows: Row[] = [];
    let seq = 0;
    const conversations: Array<{ id: string; tenantId: string; customerId: string | null }> = [
        { id: 'conv-1', tenantId: 't1', customerId: null },
    ];
    let raced = false;
    const prisma = {
        rows,
        conversations,
        tenant: {
            findUnique: vi.fn(async () => ({ whatsappDisplayNumber: opts.displayNumber ?? null })),
        },
        customer: {
            findUnique: vi.fn(async ({ where }: any) => {
                const k = where.tenantId_phone;
                return rows.find((r) => r.tenantId === k.tenantId && r.phone === k.phone) ?? null;
            }),
            findFirst: vi.fn(async ({ where }: any) => {
                return (
                    rows.find((r) => {
                        if (r.tenantId !== where.tenantId) return false;
                        if (where.id && r.id !== where.id) return false;
                        if (where.phone?.in && !where.phone.in.includes(r.phone)) return false;
                        if (typeof where.phone === 'string' && r.phone !== where.phone) return false;
                        return true;
                    }) ?? null
                );
            }),
            create: vi.fn(async ({ data }: any) => {
                if (opts.raceOnCreate && !raced) {
                    raced = true;
                    // Another request wins the insert between our read and write.
                    rows.push({ id: `c${++seq}`, attributes: null, createdAt: new Date(), updatedAt: new Date(), name: null, email: null, ...data });
                    throw p2002();
                }
                if (rows.some((r) => r.tenantId === data.tenantId && r.phone === data.phone)) throw p2002();
                const row: Row = { id: `c${++seq}`, attributes: null, createdAt: new Date(), updatedAt: new Date(), name: null, email: null, ...data };
                rows.push(row);
                return row;
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const r = rows.find((x) => x.id === where.id)!;
                Object.assign(r, data);
                return r;
            }),
            count: vi.fn(async ({ where }: any) => rows.filter((r) => r.id === where.id && r.tenantId === where.tenantId).length),
        },
        conversation: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                const hit = conversations.filter((c) => c.id === where.id && c.tenantId === where.tenantId);
                hit.forEach((c) => Object.assign(c, data));
                return { count: hit.length };
            }),
        },
        booking: { findFirst: vi.fn(async () => null) },
        order: { findFirst: vi.fn(async () => null) },
    };
    return prisma;
}

const publish = () => vi.fn(async () => ({ eventId: 'e1' }));

describe('upsertCustomerByPhone', () => {
    it('creates a customer with a normalised phone and publishes customer.created', async () => {
        const db = fakePrisma();
        const pub = publish();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233 24 123 4567', name: ' Ama ', email: 'a@x.com' }, { publish: pub });
        expect(c?.phone).toBe('+233241234567');
        expect(c?.name).toBe('Ama');
        expect(c?.email).toBe('a@x.com');
        expect(pub).toHaveBeenCalledTimes(1);
        expect(pub).toHaveBeenCalledWith(db, expect.objectContaining({ tenantId: 't1', type: 'customer.created' }));
    });

    it('does not put the phone or email in the event payload beyond ids', async () => {
        const db = fakePrisma();
        const pub = publish();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'a@x.com' }, { publish: pub });
        const payload = (pub.mock.calls[0] as any[])[1].payload;
        expect(payload.customerId).toBeTruthy();
        expect(JSON.stringify(payload)).not.toContain('a@x.com');
    });

    it('returns the same row for the same phone and does not publish twice', async () => {
        const db = fakePrisma();
        const pub = publish();
        const a = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: pub });
        const b = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233 241234567' }, { publish: pub });
        expect(b?.id).toBe(a?.id);
        expect(db.rows).toHaveLength(1);
        expect(pub).toHaveBeenCalledTimes(1);
    });

    it('keeps customers of different tenants apart', async () => {
        const db = fakePrisma();
        const a = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: publish() });
        const b = await upsertCustomerByPhone(db as any, { tenantId: 't2', phone: '+233241234567' }, { publish: publish() });
        expect(a?.id).not.toBe(b?.id);
    });

    it('refuses a phone it cannot normalise, writing nothing', async () => {
        const db = fakePrisma();
        for (const phone of ['', 'abc', '12', '0241234567']) {
            expect(await upsertCustomerByPhone(db as any, { tenantId: 't1', phone }, { publish: publish() })).toBeNull();
        }
        expect(db.rows).toHaveLength(0);
        expect(db.customer.create).not.toHaveBeenCalled();
    });

    it('completes a local number using the explicit business number', async () => {
        const db = fakePrisma();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '0241234567', businessNumber: '+233200000000' }, { publish: publish() });
        expect(c?.phone).toBe('+233241234567');
    });

    it('falls back to the tenant display number for a local number', async () => {
        const db = fakePrisma({ displayNumber: '+233200000000' });
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '0241234567' }, { publish: publish() });
        expect(c?.phone).toBe('+233241234567');
    });

    it('never overwrites a known name or email with empty values', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: 'Ama', email: 'a@x.com' }, { publish: publish() });
        const again = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: '  ', email: '' }, { publish: publish() });
        expect(again?.name).toBe('Ama');
        expect(again?.email).toBe('a@x.com');
        const nulls = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: null, email: null }, { publish: publish() });
        expect(nulls?.name).toBe('Ama');
    });

    it('does not replace a known name with a different one, but fills a missing one', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: 'Ama' }, { publish: publish() });
        const other = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: 'Kofi', email: 'k@x.com' }, { publish: publish() });
        expect(other?.name).toBe('Ama');
        expect(other?.email).toBe('k@x.com');
    });

    it('survives losing the insert race (P2002) by reading the winner', async () => {
        const db = fakePrisma({ raceOnCreate: true });
        const pub = publish();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', name: 'Ama' }, { publish: pub });
        expect(c?.phone).toBe('+233241234567');
        expect(db.rows).toHaveLength(1);
        expect(c?.name).toBe('Ama');
        // The winner announces the creation, not the loser.
        expect(pub).not.toHaveBeenCalled();
    });

    it('rethrows non-unique database errors', async () => {
        const db = fakePrisma();
        db.customer.create.mockRejectedValueOnce(new Error('db down'));
        await expect(
            upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: publish() }),
        ).rejects.toThrow('db down');
    });

    it('still returns the customer when event publishing fails', async () => {
        const db = fakePrisma();
        const pub = vi.fn().mockRejectedValue(new Error('events down'));
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: pub });
        expect(c?.id).toBeTruthy();
    });
});

describe('resolveCustomerIdSafe', () => {
    it('returns the id', async () => {
        const db = fakePrisma();
        const id = await resolveCustomerIdSafe(db as any, { tenantId: 't1', phone: '+233241234567' }, undefined, { publish: publish() });
        expect(id).toBe(db.rows[0].id);
    });

    it('returns null for an unusable phone and for database errors, never throwing', async () => {
        const db = fakePrisma();
        expect(await resolveCustomerIdSafe(db as any, { tenantId: 't1', phone: 'nope' })).toBeNull();
        db.customer.findUnique.mockRejectedValueOnce(new Error('boom'));
        const log = { warn: vi.fn() };
        expect(await resolveCustomerIdSafe(db as any, { tenantId: 't1', phone: '+233241234567' }, log as any)).toBeNull();
        expect(log.warn).toHaveBeenCalled();
    });
});

describe('linkConversationToCustomer', () => {
    it('links a conversation of the same tenant', async () => {
        const db = fakePrisma();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: publish() });
        const ok = await linkConversationToCustomer(db as any, { tenantId: 't1', conversationId: 'conv-1', customerId: c!.id });
        expect(ok).toBe(true);
        expect(db.conversations[0].customerId).toBe(c!.id);
    });

    it('refuses a customer from another tenant', async () => {
        const db = fakePrisma();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't2', phone: '+233241234567' }, { publish: publish() });
        const ok = await linkConversationToCustomer(db as any, { tenantId: 't1', conversationId: 'conv-1', customerId: c!.id });
        expect(ok).toBe(false);
        expect(db.conversations[0].customerId).toBeNull();
    });

    it('returns false for a conversation of another tenant', async () => {
        const db = fakePrisma();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't2', phone: '+233241234567' }, { publish: publish() });
        const ok = await linkConversationToCustomer(db as any, { tenantId: 't2', conversationId: 'conv-1', customerId: c!.id });
        expect(ok).toBe(false);
        expect(db.conversations[0].customerId).toBeNull();
    });
});

describe('findCustomerEmail / resolveCustomerEmail', () => {
    it('finds by customerId within the tenant', async () => {
        const db = fakePrisma();
        const c = await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'a@x.com' }, { publish: publish() });
        expect(await findCustomerEmail(db as any, { tenantId: 't1', customerId: c!.id, phone: 'x' })).toBe('a@x.com');
        expect(await findCustomerEmail(db as any, { tenantId: 't2', customerId: c!.id, phone: 'x' })).toBeNull();
    });

    it('finds by phone, raw or normalised', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'a@x.com' }, { publish: publish() });
        expect(await findCustomerEmail(db as any, { tenantId: 't1', phone: '+233241234567' })).toBe('a@x.com');
        expect(await findCustomerEmail(db as any, { tenantId: 't1', phone: '+233 24 123 4567' })).toBe('a@x.com');
    });

    it('for a booking purpose the LATEST booking email wins over a stale Customer email (salon behaviour)', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'old@x.com' }, { publish: publish() });
        db.booking.findFirst.mockResolvedValue({ customerEmail: 'new@x.com' } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'BOOKING_REMINDER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'new@x.com', source: 'booking' });
        expect(db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { tenantId: 't1', customerPhone: '+233241234567' }, orderBy: { createdAt: 'desc' },
        }));
    });

    it('for an order purpose the latest order email wins over the Customer email', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'old@x.com' }, { publish: publish() });
        db.order.findFirst.mockResolvedValue({ customerEmail: 'o@x.com' } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'ORDER_SHIPPED' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'o@x.com', source: 'order' });
    });

    it('falls back to the Customer email when the latest booking has none', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'c@x.com' }, { publish: publish() });
        db.booking.findFirst.mockResolvedValue({ customerEmail: null } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'BOOKING_REMINDER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'c@x.com', source: 'customer' });
    });

    it('falls back to the Customer email when the customer has no bookings at all', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'c@x.com' }, { publish: publish() });
        db.booking.findFirst.mockResolvedValue(null as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'BOOKING_REMINDER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'c@x.com', source: 'customer' });
    });

    it('for an entity-less purpose (flows, generic reminders) the Customer email is used and no booking/order is probed', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567', email: 'c@x.com' }, { publish: publish() });
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'WHATEVER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'c@x.com', source: 'customer' });
        expect(db.booking.findFirst).not.toHaveBeenCalled();
        expect(db.order.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the latest booking for a booking purpose', async () => {
        const db = fakePrisma();
        db.booking.findFirst.mockResolvedValue({ customerEmail: 'b@x.com' } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'BOOKING_REMINDER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'b@x.com', source: 'booking' });
    });

    it('falls back to the latest order for an order purpose', async () => {
        const db = fakePrisma();
        db.order.findFirst.mockResolvedValue({ customerEmail: 'o@x.com' } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'ORDER_SHIPPED' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: 'o@x.com', source: 'order' });
    });

    it('ignores a Customer row without an email and keeps falling back', async () => {
        const db = fakePrisma();
        await upsertCustomerByPhone(db as any, { tenantId: 't1', phone: '+233241234567' }, { publish: publish() });
        db.booking.findFirst.mockResolvedValue({ customerEmail: 'b@x.com' } as any);
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'BOOKING_REMINDER' as any, customerPhone: '+233241234567' });
        expect(r.email).toBe('b@x.com');
    });

    it('returns no email for an unknown purpose with no Customer email', async () => {
        const db = fakePrisma();
        const r = await resolveCustomerEmail(db as any, { tenantId: 't1', purpose: 'WHATEVER' as any, customerPhone: '+233241234567' });
        expect(r).toEqual({ email: null, source: null });
        expect(db.booking.findFirst).not.toHaveBeenCalled();
        expect(db.order.findFirst).not.toHaveBeenCalled();
    });
});
