import { describe, it, expect } from 'vitest';
import { TemplatePurpose } from '@prisma/client';
import {
    purposeEntity,
    OUT_OF_WINDOW_PURPOSES,
    IN_WINDOW_PURPOSES,
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
