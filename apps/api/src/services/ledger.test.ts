import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  depositReceived,
  fundsCleared,
  payoutRequested,
  payoutSettled,
  payoutReversed,
  refundIssued,
  sumFor,
  LedgerImbalanceError,
  splitFee,
} from './ledger.js';

/** Every builder must produce a movement that sums to zero. */
const BUILDERS = {
  depositReceived: depositReceived(5000, 100),
  fundsCleared: fundsCleared(4900),
  payoutRequested: payoutRequested(4900),
  payoutSettled: payoutSettled(4900),
  payoutReversed: payoutReversed(4900),
  refundIssued: refundIssued(4900, 100, 'TENANT_PENDING'),
};

describe('assertBalanced', () => {
  it('accepts a movement that sums to zero', () => {
    expect(() =>
      assertBalanced([
        { account: 'EXTERNAL', amountMinor: -5000 },
        { account: 'TENANT_PENDING', amountMinor: 5000 },
      ]),
    ).not.toThrow();
  });

  it('rejects a movement that does not sum to zero', () => {
    // This is the whole safety net: money cannot be conjured into existence.
    expect(() =>
      assertBalanced([
        { account: 'EXTERNAL', amountMinor: -5000 },
        { account: 'TENANT_PENDING', amountMinor: 4900 },
      ]),
    ).toThrow(LedgerImbalanceError);
  });

  it('rejects an empty movement', () => {
    expect(() => assertBalanced([])).toThrow(LedgerImbalanceError);
  });

  it('rejects a single-sided movement', () => {
    // One entry can never be a transfer; it is always a mistake.
    expect(() =>
      assertBalanced([{ account: 'TENANT_AVAILABLE', amountMinor: 5000 }]),
    ).toThrow(LedgerImbalanceError);
  });

  it('rejects a non-integer amount', () => {
    // Fractional pesewas mean someone used a float somewhere upstream.
    expect(() =>
      assertBalanced([
        { account: 'EXTERNAL', amountMinor: -50.5 },
        { account: 'TENANT_PENDING', amountMinor: 50.5 },
      ]),
    ).toThrow(LedgerImbalanceError);
  });
});

describe('every movement builder balances', () => {
  for (const [name, entries] of Object.entries(BUILDERS)) {
    it(`${name} sums to zero`, () => {
      expect(entries.reduce((t, e) => t + e.amountMinor, 0)).toBe(0);
      expect(() => assertBalanced(entries)).not.toThrow();
    });
  }
});

describe('depositReceived', () => {
  it('credits the tenant net of the fee and books the fee as revenue', () => {
    const entries = depositReceived(5000, 100);
    expect(sumFor(entries, 'EXTERNAL')).toBe(-5000);
    expect(sumFor(entries, 'TENANT_PENDING')).toBe(4900);
    expect(sumFor(entries, 'PLATFORM_FEE')).toBe(100);
  });

  it('lands the money as PENDING, never straight to available', () => {
    // A deposit is conditional until the appointment happens — paying it out
    // immediately means Bookly funds every cancellation refund itself.
    const entries = depositReceived(5000, 0);
    expect(sumFor(entries, 'TENANT_AVAILABLE')).toBe(0);
    expect(sumFor(entries, 'TENANT_PENDING')).toBe(5000);
  });

  it('handles a zero fee', () => {
    const entries = depositReceived(5000, 0);
    expect(sumFor(entries, 'PLATFORM_FEE')).toBe(0);
    expect(sumFor(entries, 'TENANT_PENDING')).toBe(5000);
  });

  it('refuses a fee larger than the payment', () => {
    expect(() => depositReceived(100, 500)).toThrow(LedgerImbalanceError);
  });

  it('refuses a negative or zero payment', () => {
    expect(() => depositReceived(0, 0)).toThrow(LedgerImbalanceError);
    expect(() => depositReceived(-100, 0)).toThrow(LedgerImbalanceError);
  });
});

describe('the payout lifecycle conserves money', () => {
  it('moves available -> payout pending -> out, never duplicating', () => {
    const all = [...payoutRequested(4900), ...payoutSettled(4900)];
    // Net effect of the whole lifecycle: the tenant's available drops, and
    // the money leaves the system. PAYOUT_PENDING nets to zero.
    expect(sumFor(all, 'TENANT_AVAILABLE')).toBe(-4900);
    expect(sumFor(all, 'PAYOUT_PENDING')).toBe(0);
    expect(sumFor(all, 'EXTERNAL')).toBe(4900);
  });

  it('returns the money to available when a payout fails', () => {
    const all = [...payoutRequested(4900), ...payoutReversed(4900)];
    // A failed payout must leave the tenant exactly where they started.
    expect(sumFor(all, 'TENANT_AVAILABLE')).toBe(0);
    expect(sumFor(all, 'PAYOUT_PENDING')).toBe(0);
    expect(sumFor(all, 'EXTERNAL')).toBe(0);
  });

  it('refuses a zero or negative payout', () => {
    expect(() => payoutRequested(0)).toThrow(LedgerImbalanceError);
    expect(() => payoutRequested(-1)).toThrow(LedgerImbalanceError);
  });
});

describe('refundIssued', () => {
  it('takes the money back from the tenant and reverses the fee', () => {
    const entries = refundIssued(4900, 100, 'TENANT_PENDING');
    expect(sumFor(entries, 'TENANT_PENDING')).toBe(-4900);
    expect(sumFor(entries, 'PLATFORM_FEE')).toBe(-100);
    expect(sumFor(entries, 'EXTERNAL')).toBe(5000);
  });

  it('can refund from available when the funds already cleared', () => {
    const entries = refundIssued(4900, 100, 'TENANT_AVAILABLE');
    expect(sumFor(entries, 'TENANT_AVAILABLE')).toBe(-4900);
    expect(sumFor(entries, 'TENANT_PENDING')).toBe(0);
  });
});

describe('splitFee', () => {
  it('rounds the fee to whole minor units', () => {
    // 2.5% of 5000 pesewas = 125 exactly.
    expect(splitFee(5000, 250)).toBe(125);
  });

  it('rounds half up and never exceeds the amount', () => {
    expect(splitFee(101, 250)).toBe(3); // 2.525 -> 3
    expect(splitFee(1, 10000)).toBe(1); // 100% of 1
  });

  it('is zero when the rate is zero', () => {
    expect(splitFee(5000, 0)).toBe(0);
  });

  it('refuses a negative rate', () => {
    expect(() => splitFee(5000, -1)).toThrow(LedgerImbalanceError);
  });
});
