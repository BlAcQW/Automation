import { describe, it, expect, vi } from 'vitest';
import { TemplatePurpose } from '@prisma/client';
import {
    purposeEntity,
    OUT_OF_WINDOW_PURPOSES,
    IN_WINDOW_PURPOSES,
    normalizeReminderJob,
    reminderStillApplies,
    registerReminderEntity,
    isReminderEntityRegistered,
} from './notification-purposes.js';

const ALL_PURPOSES = Object.values(TemplatePurpose) as TemplatePurpose[];

describe('purposeEntity', () => {
    it.each(['ORDER_CONFIRMATION', 'ORDER_SHIPPED', 'ORDER_DELIVERED'] as const)(
        'maps %s to order',
        (p) => {
            expect(purposeEntity(p)).toBe('order');
        },
    );

    it.each([
        'BOOKING_CONFIRMATION',
        'BOOKING_REMINDER',
        'BOOKING_CANCELLED',
        'BOOKING_RESCHEDULED',
    ] as const)('maps %s to booking', (p) => {
        expect(purposeEntity(p)).toBe('booking');
    });

    it('returns null for an unknown purpose', () => {
        expect(purposeEntity('SOMETHING_NEW' as TemplatePurpose)).toBeNull();
    });

    it('returns null for empty / nullish input', () => {
        expect(purposeEntity('' as TemplatePurpose)).toBeNull();
        expect(purposeEntity(undefined as unknown as TemplatePurpose)).toBeNull();
        expect(purposeEntity(null as unknown as TemplatePurpose)).toBeNull();
    });

    it('classifies every current TemplatePurpose (a new enum value must be mapped)', () => {
        const unmapped = ALL_PURPOSES.filter((p) => purposeEntity(p) === null);
        expect(unmapped).toEqual([]);
    });
});

describe('window classification', () => {
    it('every TemplatePurpose is explicitly in-window or out-of-window', () => {
        const classified = new Set<string>([...IN_WINDOW_PURPOSES, ...OUT_OF_WINDOW_PURPOSES]);
        const unclassified = ALL_PURPOSES.filter((p) => !classified.has(p));
        expect(unclassified).toEqual([]);
    });

    it('no purpose is in both lists', () => {
        const both = [...IN_WINDOW_PURPOSES].filter((p) => OUT_OF_WINDOW_PURPOSES.has(p));
        expect(both).toEqual([]);
    });

    it('lists contain no stale purposes that left the enum', () => {
        const all = new Set<string>(ALL_PURPOSES);
        const stale = [...IN_WINDOW_PURPOSES, ...OUT_OF_WINDOW_PURPOSES].filter(
            (p) => !all.has(p),
        );
        expect(stale).toEqual([]);
    });

    it('keeps reminders and shipping/delivery updates gated as out-of-window', () => {
        expect([...OUT_OF_WINDOW_PURPOSES].sort()).toEqual(
            ['BOOKING_REMINDER', 'ORDER_DELIVERED', 'ORDER_SHIPPED'].sort(),
        );
    });
});

describe('normalizeReminderJob', () => {
    const base = { purpose: 'BOOKING_REMINDER', tenantId: 't1', customerPhone: '+233241234567', variables: ['Cut', '10:00'] };

    it('passes a generic payload through', () => {
        const job = normalizeReminderJob({ ...base, entityType: 'ride', entityId: 'r1', customerId: 'c1' });
        expect(job).toEqual(expect.objectContaining({ entityType: 'ride', entityId: 'r1', customerId: 'c1' }));
    });

    it('upgrades a legacy bookingId-only job already sitting in the queue', () => {
        const job = normalizeReminderJob({ ...base, bookingId: 'b1' });
        expect(job).toEqual(expect.objectContaining({ entityType: 'booking', entityId: 'b1', bookingId: 'b1' }));
    });

    it('rejects payloads that name no entity, or the wrong shapes', () => {
        expect(normalizeReminderJob({ ...base })).toBeNull();
        expect(normalizeReminderJob({ ...base, entityType: 'ride' })).toBeNull();
        expect(normalizeReminderJob({ ...base, entityType: 'ride', entityId: '' })).toBeNull();
        expect(normalizeReminderJob({ ...base, bookingId: 5 as any })).toBeNull();
        expect(normalizeReminderJob(null as any)).toBeNull();
        expect(normalizeReminderJob({ ...base, bookingId: 'b1', tenantId: '' })).toBeNull();
    });
});

describe('reminder entity registry', () => {
    const db = (status: string | null, tenantId = 't1') => ({
        booking: { findFirst: vi.fn(async ({ where }: any) => (status && where.tenantId === tenantId ? { status } : null)) },
    });

    it('applies to a CONFIRMED booking of the tenant', async () => {
        const d = db('CONFIRMED');
        expect(await reminderStillApplies(d, { entityType: 'booking', entityId: 'b1', tenantId: 't1' })).toBe('applies');
        expect(d.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1', tenantId: 't1' } }));
    });

    it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'PENDING_PAYMENT'])('skips a booking that is %s', async (status) => {
        expect(await reminderStillApplies(db(status), { entityType: 'booking', entityId: 'b1', tenantId: 't1' })).toBe('skip');
    });

    it('skips a missing booking and one belonging to another tenant', async () => {
        expect(await reminderStillApplies(db(null), { entityType: 'booking', entityId: 'b1', tenantId: 't1' })).toBe('skip');
        expect(await reminderStillApplies(db('CONFIRMED', 'other'), { entityType: 'booking', entityId: 'b1', tenantId: 't1' })).toBe('skip');
    });

    it('skips an entity type nobody registered, without throwing', async () => {
        expect(await reminderStillApplies({}, { entityType: 'ride', entityId: 'r1', tenantId: 't1' })).toBe('unknown_entity');
    });

    it('lets a pack register its own entity type', async () => {
        const check = vi.fn(async () => true);
        registerReminderEntity('ride_test', check);
        expect(isReminderEntityRegistered('ride_test')).toBe(true);
        expect(await reminderStillApplies({}, { entityType: 'ride_test', entityId: 'r1', tenantId: 't1' })).toBe('applies');
        expect(check).toHaveBeenCalledWith({}, { entityId: 'r1', tenantId: 't1' });
        check.mockResolvedValueOnce(false);
        expect(await reminderStillApplies({}, { entityType: 'ride_test', entityId: 'r1', tenantId: 't1' })).toBe('skip');
    });

    it('treats a throwing check as an error for the caller to retry, not as a skip', async () => {
        registerReminderEntity('flaky_test', async () => { throw new Error('db'); });
        await expect(reminderStillApplies({}, { entityType: 'flaky_test', entityId: 'x', tenantId: 't1' })).rejects.toThrow('db');
    });

    it('refuses to replace the built-in booking check or register a malformed key', () => {
        expect(() => registerReminderEntity('booking', async () => true)).toThrow();
        expect(() => registerReminderEntity('Bad Key', async () => true)).toThrow();
    });
});
