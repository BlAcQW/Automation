import { describe, it, expect } from 'vitest';
import {
    blockersFor,
    confirmNameMatches,
    describeMoneyHistory,
    moneyHistoryTotal,
    type MoneyHistory,
} from './tenant-lifecycle.js';

const NONE: MoneyHistory = {
    ledgerMovements: 0, paidBookings: 0, paidOrders: 0, paidPasses: 0, paidRides: 0,
    payoutRequests: 0, walletNonZero: false, subscription: false,
};

describe('confirmNameMatches', () => {
    it('accepts the exact name, ignoring surrounding whitespace', () => {
        expect(confirmNameMatches('TURBO Rides', 'TURBO Rides')).toBe(true);
        expect(confirmNameMatches('  TURBO Rides ', 'TURBO Rides')).toBe(true);
    });
    it('is case-sensitive and refuses partial or empty input', () => {
        expect(confirmNameMatches('turbo rides', 'TURBO Rides')).toBe(false);
        expect(confirmNameMatches('TURBO', 'TURBO Rides')).toBe(false);
        expect(confirmNameMatches('', 'TURBO Rides')).toBe(false);
        expect(confirmNameMatches('   ', '   ')).toBe(false);
    });
});

describe('money history', () => {
    it('totals every kind of financial record, counting a non-zero wallet and a subscription as one each', () => {
        expect(moneyHistoryTotal(NONE)).toBe(0);
        expect(moneyHistoryTotal({ ...NONE, ledgerMovements: 2, paidBookings: 1, walletNonZero: true, subscription: true })).toBe(5);
    });
    it('describes what is there in plain words', () => {
        const text = describeMoneyHistory({ ...NONE, ledgerMovements: 2, paidBookings: 1, payoutRequests: 1 });
        expect(text).toContain('2 ledger movements');
        expect(text).toContain('1 paid booking');
        expect(text).toContain('1 payout');
        expect(text).not.toContain('order');
    });
});

describe('blockersFor', () => {
    it('an active organisation must be deactivated first', () => {
        const b = blockersFor({ isActive: true }, NONE);
        expect(b).toEqual([expect.objectContaining({ code: 'NOT_DEACTIVATED', count: 1 })]);
    });
    it('an inactive organisation with no money history can be deleted', () => {
        expect(blockersFor({ isActive: false }, NONE)).toEqual([]);
    });
    it('money history always blocks, with the record count and a message saying records are kept', () => {
        const b = blockersFor({ isActive: false }, { ...NONE, ledgerMovements: 3, paidRides: 1 });
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ code: 'MONEY_HISTORY', count: 4 });
        expect(b[0].message).toMatch(/payment history/i);
        expect(b[0].message).toMatch(/financial records must be kept/i);
        expect(b[0].message).toMatch(/stay deactivated/i);
    });
    it('open payment links block with a plain message and the link count', () => {
        const b = blockersFor({ isActive: false }, NONE, { bookings: 1, orders: 1, passes: 0, rides: 2 });
        expect(b).toEqual([{ code: 'OPEN_PAYMENT_LINKS', count: 4, message: expect.stringMatching(/unpaid payment links still open.*expire or cancel them first/i) }]);
        expect(blockersFor({ isActive: false }, NONE, { bookings: 0, orders: 0, passes: 0, rides: 0 })).toEqual([]);
    });

    it('reports both blockers together', () => {
        const codes = blockersFor({ isActive: true }, { ...NONE, walletNonZero: true }).map((x) => x.code);
        expect(codes).toEqual(['NOT_DEACTIVATED', 'MONEY_HISTORY']);
    });
});
