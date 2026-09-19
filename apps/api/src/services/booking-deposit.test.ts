import { describe, expect, it } from 'vitest';
import { effectiveDeposit } from './booking-deposit.js';

const on = { depositRequired: true, defaultDepositAmount: '50.00' };
const off = { depositRequired: false, defaultDepositAmount: '50.00' };

describe('effectiveDeposit', () => {
    it('uses the business default when the service has none', () => {
        expect(effectiveDeposit(on, { depositAmount: null })).toBe(50);
    });

    it('lets a service override the default, including to zero', () => {
        expect(effectiveDeposit(on, { depositAmount: '20.5' })).toBe(20.5);
        expect(effectiveDeposit(on, { depositAmount: 0 })).toBe(0);
    });

    it('is zero when the business has deposits switched off, whatever the service says', () => {
        expect(effectiveDeposit(off, { depositAmount: '80' })).toBe(0);
    });

    it('falls back to 50 when the default is missing, and never returns garbage', () => {
        expect(effectiveDeposit({ depositRequired: true, defaultDepositAmount: null }, { depositAmount: null })).toBe(50);
        expect(effectiveDeposit(on, { depositAmount: 'abc' })).toBe(0);
        expect(effectiveDeposit(on, { depositAmount: -5 })).toBe(0);
    });

    it('accepts Prisma Decimal-like objects', () => {
        const decimalLike = { toString: () => '75.00' };
        expect(effectiveDeposit({ depositRequired: true, defaultDepositAmount: decimalLike }, { depositAmount: null })).toBe(75);
    });
});
