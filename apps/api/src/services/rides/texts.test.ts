import { describe, it, expect } from 'vitest';
import { driverAssignedText, rideCompletedText, packageActivatedText, formatDate, money, rides, rideCancelledText, expiryReminderText, lowBalanceText, driverSmsText, PAYG_PAYMENT_RECEIVED_TEXT } from './texts.js';

describe('TURBO wording', () => {
    it('driver assigned', () => {
        expect(driverAssignedText({ name: 'Kofi', vehicle: 'Toyota Vitz', plate: 'GR 1234-24' }))
            .toBe('🚗 Driver Assigned\n\nDriver: Kofi\nVehicle: Toyota Vitz\nPlate: GR 1234-24\n\nYour driver is on the way.');
    });
    it('ride completed with the remaining balance (never negative), and without one for PAYG', () => {
        expect(rideCompletedText(59)).toBe('✅ Ride Completed\n\nThanks for riding with TURBO.\n\n1 ride used\n\n🎟️ Remaining balance: 59 rides\n\nNeed another ride?\nReply BOOK.');
        expect(rideCompletedText(1)).toContain('Remaining balance: 1 ride\n');
        expect(rideCompletedText(-1)).toContain('Remaining balance: 0 rides');
        expect(rideCompletedText(null)).toBe('✅ Ride Completed\n\nThanks for riding with TURBO.\n\nNeed another ride?\nReply BOOK.');
    });
    it('package activated', () => {
        expect(packageActivatedText({ name: 'Ama Mensah', rides: 60, days: 60, maxKm: 6, balance: 60 }))
            .toMatch(/^🎉 WELCOME TO TURBO, AMA MENSAH!\n\nYou're officially one of our Founding 50\.\n\n🎟️ Your Package\n\n60 rides\nValid for 60 days\n0–6 km\n\nBalance: 60 rides/);
        expect(packageActivatedText({ name: null, rides: 60, days: 60, maxKm: 6, balance: 60 })).toMatch(/WELCOME TO TURBO, TURBER!/);
    });
    it('PAYG payment received', () => {
        expect(PAYG_PAYMENT_RECEIVED_TEXT).toBe("✅ Payment Received\n\nYour ride is confirmed.\n\nWe're assigning your driver now.");
    });
    it('helpers', () => {
        expect(formatDate(new Date('2026-12-05T23:30:00Z'), 'Africa/Accra')).toBe('5 Dec 2026');
        expect(formatDate(new Date('2026-12-05T23:30:00Z'), 'Not/AZone')).toBe('5 Dec 2026');
        expect(money(96000, 'GHS')).toBe('GHS 960');
        expect(money(2550, 'GHS')).toBe('GHS 25.50');
        expect(rides(1)).toBe('1 ride');
        expect(rideCancelledText({ ref: 'TR-1', paidPayg: true })).toMatch(/refunded/);
        expect(expiryReminderText({ expiresAt: new Date('2026-12-05T12:00:00Z'), remaining: 8, timeZone: 'UTC' })).toMatch(/expires on 5 Dec 2026[\s\S]*8 rides left/);
        expect(lowBalanceText({ remaining: 5, expiresAt: null, timeZone: 'UTC' })).toMatch(/^🎟️ Only 5 rides left/);
        expect(driverSmsText({ ref: 'TR-1', customerName: 'Ama', customerPhone: '+233', pickup: 'Gate', destination: 'Lib', kind: 'PAYG' })).toBe('TURBO ride TR-1 (PAYG): pick up Ama (+233) at Gate, to Lib.');
        // Customer-controlled text goes out from TURBO's sender ID: no links, short.
        const sms = driverSmsText({ ref: 'TR-2', customerName: 'Win cash https://evil.example/x', customerPhone: '+233', pickup: 'Gate www.bad.example ' + 'x'.repeat(200), destination: 'http://y.example', kind: 'PACKAGE' });
        expect(sms).not.toMatch(/https?:|www\.|\.example/);
        expect(sms.length).toBeLessThanOrEqual(200);
        expect(driverSmsText({ ref: 'TR-3', customerName: 'Kofi', customerPhone: '+233', pickup: 'St.Mary Hostel', destination: 'U.C.C Gate', kind: 'PACKAGE' })).toContain('St.Mary Hostel, to U.C.C Gate');
    });
});
