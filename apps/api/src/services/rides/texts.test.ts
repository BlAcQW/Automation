import { describe, it, expect } from 'vitest';
import { driverAssignedText, rideCompletedText, packageActivatedText, formatDate, money, rides, rideCancelledText, expiryReminderText, lowBalanceText, driverSmsText, PAYG_PAYMENT_RECEIVED_TEXT, topupReceivedText, topupNotConfirmedText, refundSourceText } from './texts.js';

describe('TURBO wording', () => {
    it('driver assigned', () => {
        expect(driverAssignedText({ name: 'Kofi', vehicle: 'Toyota Vitz', plate: 'GR 1234-24' }))
            .toBe('🚗 Driver Assigned\n\nDriver: Kofi\nVehicle: Toyota Vitz\nPlate: GR 1234-24\n\nYour driver is on the way.');
    });
    it('ride completed with the GHS deducted and the remaining balance (never negative), and without one for PAYG', () => {
        expect(rideCompletedText({ deductedMinor: 1600, balanceAfterMinor: 94400, currency: 'GHS' }))
            .toBe('✅ Ride Completed\n\nThanks for riding with TURBO.\n\nGHS 16 deducted\n\n🎟️ Remaining balance: GHS 944\n\nNeed another ride?\nReply BOOK.');
        expect(rideCompletedText({ deductedMinor: 1600, balanceAfterMinor: -5, currency: 'GHS' })).toContain('Remaining balance: GHS 0\n');
        expect(rideCompletedText(null)).toBe('✅ Ride Completed\n\nThanks for riding with TURBO.\n\nNeed another ride?\nReply BOOK.');
    });
    it('package activated (GHS credit)', () => {
        expect(packageActivatedText({ name: 'Ama Mensah', creditMinor: 96000, days: 60, balanceMinor: 96000, currency: 'GHS' }))
            .toMatch(/^✅ Payment confirmed, thank you!\n\n🎉 WELCOME TO TURBO, AMA MENSAH!\n\nYou're officially one of our Founding 50\.\n\n🎟️ Your Package\n\nGHS 960 ride credit\nValid for 60 days\n\nBalance: GHS 960/);
        expect(packageActivatedText({ name: null, creditMinor: 96000, days: 60, balanceMinor: 96000, currency: 'GHS' })).toMatch(/WELCOME TO TURBO, TURBER!/);
    });
    it('top-up received / not confirmed', () => {
        expect(topupReceivedText(1400, 'GHS')).toBe("✅ Payment confirmed, thank you!\n\nYour ride is confirmed.\n\nGHS 14 from your balance is deducted when the ride is completed.\n\nWe're finding your TURBO driver.");
        expect(topupNotConfirmedText(200, 'GHS')).toMatch(/payment of GHS 2,[\s\S]*refund/);
    });
    it('PAYG payment received', () => {
        expect(PAYG_PAYMENT_RECEIVED_TEXT).toBe("✅ Payment confirmed, thank you!\n\nYour ride is confirmed.\n\nWe're assigning your driver now.");
    });
    it('helpers', () => {
        expect(formatDate(new Date('2026-12-05T23:30:00Z'), 'Africa/Accra')).toBe('5 Dec 2026');
        expect(formatDate(new Date('2026-12-05T23:30:00Z'), 'Not/AZone')).toBe('5 Dec 2026');
        expect(money(96000, 'GHS')).toBe('GHS 960');
        expect(money(2550, 'GHS')).toBe('GHS 25.50');
        expect(rides(1)).toBe('1 ride');
        expect(rideCancelledText({ ref: 'TR-1', refundMinor: 2500, currency: 'GHS' })).toMatch(/payment of GHS 25 will be refunded/);
        expect(rideCancelledText({ ref: 'TR-1', refundMinor: null, currency: 'GHS' })).not.toMatch(/refund/);
        expect(expiryReminderText({ expiresAt: new Date('2026-12-05T12:00:00Z'), remainingMinor: 12800, currency: 'GHS', timeZone: 'UTC' })).toMatch(/expires on 5 Dec 2026[\s\S]*GHS 128 ride credit left/);
        expect(lowBalanceText({ remainingMinor: 8000, currency: 'GHS', expiresAt: null, timeZone: 'UTC' })).toMatch(/^🎟️ Only GHS 80 ride credit left/);
        expect(driverSmsText({ ref: 'TR-1', customerName: 'Ama', customerPhone: '+233', pickup: 'Gate', destination: 'Lib', kind: 'PAYG' })).toBe('TURBO ride TR-1 (PAYG): pick up Ama (+233) at Gate, to Lib.');
        // Customer-controlled text goes out from TURBO's sender ID: no links, short.
        const sms = driverSmsText({ ref: 'TR-2', customerName: 'Win cash https://evil.example/x', customerPhone: '+233', pickup: 'Gate www.bad.example ' + 'x'.repeat(200), destination: 'http://y.example', kind: 'PACKAGE' });
        expect(sms).not.toMatch(/https?:|www\.|\.example/);
        expect(sms.length).toBeLessThanOrEqual(200);
        expect(driverSmsText({ ref: 'TR-3', customerName: 'Kofi', customerPhone: '+233', pickup: 'St.Mary Hostel', destination: 'U.C.C Gate', kind: 'PACKAGE' })).toContain('St.Mary Hostel, to U.C.C Gate');
    });
});

describe('refundSourceText (staff-facing: where to refund)', () => {
    it('names the gateway that took the money, and both when unknown', () => {
        expect(refundSourceText('PAYAZA')).toBe('your Payaza dashboard');
        expect(refundSourceText('PAYSTACK')).toBe('your Paystack dashboard');
        expect(refundSourceText(null)).toBe("your payment provider's dashboard (Paystack or Payaza)");
        expect(refundSourceText(undefined)).toBe("your payment provider's dashboard (Paystack or Payaza)");
    });
});
