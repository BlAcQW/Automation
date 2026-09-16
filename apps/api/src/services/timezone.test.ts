import { describe, it, expect } from 'vitest';
import { zonedTimeToUtc, startOfDayInZone, zonedDateString, zonedTimeString, safeZone } from './timezone.js';

describe('zonedTimeToUtc', () => {
    it('treats a time in UTC as itself', () => {
        expect(zonedTimeToUtc('2026-09-20', '14:00', 'UTC')?.toISOString()).toBe('2026-09-20T14:00:00.000Z');
    });

    it('shifts west of Greenwich forward', () => {
        // New York is UTC-4 in September (EDT): 14:00 local = 18:00 UTC.
        expect(zonedTimeToUtc('2026-09-20', '14:00', 'America/New_York')?.toISOString())
            .toBe('2026-09-20T18:00:00.000Z');
    });

    it('shifts east of Greenwich backward', () => {
        // Lagos is UTC+1 year-round: 14:00 local = 13:00 UTC. This is the case
        // that silently broke bookings for a Nigerian tenant.
        expect(zonedTimeToUtc('2026-09-20', '14:00', 'Africa/Lagos')?.toISOString())
            .toBe('2026-09-20T13:00:00.000Z');
    });

    it('handles Accra, which is UTC+0 with no DST', () => {
        expect(zonedTimeToUtc('2026-09-20', '09:30', 'Africa/Accra')?.toISOString())
            .toBe('2026-09-20T09:30:00.000Z');
    });

    it('respects DST on either side of a transition', () => {
        // London: BST (UTC+1) in July, GMT (UTC+0) in December.
        expect(zonedTimeToUtc('2026-07-15', '12:00', 'Europe/London')?.toISOString())
            .toBe('2026-07-15T11:00:00.000Z');
        expect(zonedTimeToUtc('2026-12-15', '12:00', 'Europe/London')?.toISOString())
            .toBe('2026-12-15T12:00:00.000Z');
    });

    it('rejects malformed input instead of producing an Invalid Date', () => {
        expect(zonedTimeToUtc('20-09-2026', '14:00', 'UTC')).toBeNull();
        expect(zonedTimeToUtc('2026-09-20', '2pm', 'UTC')).toBeNull();
    });
});

describe('startOfDayInZone', () => {
    it('is midnight local, not midnight UTC', () => {
        expect(startOfDayInZone('2026-09-20', 'Africa/Lagos')?.toISOString())
            .toBe('2026-09-19T23:00:00.000Z');
    });
});

describe('round trip', () => {
    it('recovers the wall clock it was given', () => {
        for (const zone of ['UTC', 'Africa/Accra', 'Africa/Lagos', 'America/New_York', 'Asia/Kolkata']) {
            const utc = zonedTimeToUtc('2026-09-20', '14:30', zone)!;
            expect(zonedDateString(utc, zone)).toBe('2026-09-20');
            expect(zonedTimeString(utc, zone)).toBe('14:30');
        }
    });
});

describe('safeZone', () => {
    it('falls back to UTC rather than throwing', () => {
        expect(safeZone(null)).toBe('UTC');
        expect(safeZone('Not/AZone')).toBe('UTC');
        expect(safeZone('Africa/Accra')).toBe('Africa/Accra');
    });
});
