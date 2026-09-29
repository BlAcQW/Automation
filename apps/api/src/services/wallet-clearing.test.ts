import { describe, expect, it } from 'vitest';
import {
  bookingStatusClearsFunds,
  depositOutcomeOnCancel,
  orderStatusClearsFunds,
  pendingFromEntries,
} from './wallet-clearing.js';

describe('bookingStatusClearsFunds', () => {
  it('releases the money when the job is done', () => {
    expect(bookingStatusClearsFunds('COMPLETED')).toBe(true);
  });

  it('releases the money on a no-show', () => {
    // The whole point of taking a deposit: they did not turn up, so it is
    // the salon's compensation rather than the customer's to get back.
    expect(bookingStatusClearsFunds('NO_SHOW')).toBe(true);
  });

  it('does not release on states where the work has not happened', () => {
    for (const s of ['CONFIRMED', 'PENDING_PAYMENT', 'CANCELLED']) {
      expect(bookingStatusClearsFunds(s)).toBe(false);
    }
  });

  it('does not release on an unknown status', () => {
    expect(bookingStatusClearsFunds('SOMETHING_NEW')).toBe(false);
  });
});

describe('orderStatusClearsFunds', () => {
  it('releases once delivered', () => {
    expect(orderStatusClearsFunds('DELIVERED')).toBe(true);
  });

  it('holds while the order is still moving', () => {
    for (const s of ['PENDING', 'PROCESSING', 'SHIPPED', 'CANCELLED']) {
      expect(orderStatusClearsFunds(s)).toBe(false);
    }
  });
});

describe('pendingFromEntries', () => {
  it('sums what is still pending for this entity', () => {
    expect(
      pendingFromEntries([
        { account: 'EXTERNAL', amountMinor: -5000 },
        { account: 'TENANT_PENDING', amountMinor: 4900 },
        { account: 'PLATFORM_FEE', amountMinor: 100 },
      ]),
    ).toBe(4900);
  });

  it('nets out money that has already been cleared', () => {
    // Guards the double-release: a prior FUNDS_CLEARED movement debited
    // pending, so there is nothing left to release.
    expect(
      pendingFromEntries([
        { account: 'TENANT_PENDING', amountMinor: 4900 },
        { account: 'TENANT_PENDING', amountMinor: -4900 },
        { account: 'TENANT_AVAILABLE', amountMinor: 4900 },
      ]),
    ).toBe(0);
  });

  it('nets out a refund', () => {
    expect(
      pendingFromEntries([
        { account: 'TENANT_PENDING', amountMinor: 4900 },
        { account: 'TENANT_PENDING', amountMinor: -4900 },
      ]),
    ).toBe(0);
  });

  it('is zero when nothing was ever credited', () => {
    expect(pendingFromEntries([])).toBe(0);
    expect(pendingFromEntries([{ account: 'TENANT_AVAILABLE', amountMinor: 100 }])).toBe(0);
  });
});

describe('depositOutcomeOnCancel', () => {
  it('lets the business keep the deposit when the customer cancels', () => {
    // Non-refundable by policy — the slot was held and then lost. A customer
    // who cannot make it reschedules instead, which keeps the same booking
    // and carries the deposit with it.
    expect(depositOutcomeOnCancel('CUSTOMER')).toBe('FORFEIT_TO_BUSINESS');
  });

  it('holds the money when the business cancels', () => {
    // The one case a no-refund policy cannot cover. Keeping a customer's
    // money for work nobody will do is indefensible however the terms read,
    // so it is held rather than released to the salon.
    expect(depositOutcomeOnCancel('BUSINESS')).toBe('HOLD_FOR_REFUND');
  });
});
