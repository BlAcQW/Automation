import { describe, expect, it } from 'vitest';
import { isSufficientPayment } from './payment-fulfillment.js';

describe('isSufficientPayment', () => {
  it('accepts the exact amount', () => {
    expect(isSufficientPayment(5000, 50)).toBe(true);
  });

  it('accepts an overpayment', () => {
    // Refusing this would strand a customer's money for being generous.
    expect(isSufficientPayment(6000, 50)).toBe(true);
  });

  it('refuses an underpayment', () => {
    // The gap this closes: before, a GHS 1 payment against a GHS 50 deposit
    // confirmed the slot and credited the salon GHS 1.
    expect(isSufficientPayment(100, 50)).toBe(false);
  });

  it('refuses an underpayment that is only slightly short', () => {
    expect(isSufficientPayment(4900, 50)).toBe(false);
  });

  it('absorbs a one-pesewa rounding difference', () => {
    // The expected amount is a decimal column and the paid amount an integer,
    // so a single unit of drift must not block a genuine payment.
    expect(isSufficientPayment(4999, 50)).toBe(true);
  });

  it('accepts anything when no expected amount is known', () => {
    // Fail open only here: refusing would break every legacy payment that
    // predates the expected amount being carried through.
    expect(isSufficientPayment(100, null)).toBe(true);
    expect(isSufficientPayment(100, undefined)).toBe(true);
  });

  it('accepts anything when the expected amount is zero or nonsense', () => {
    expect(isSufficientPayment(100, 0)).toBe(true);
    expect(isSufficientPayment(100, 'abc')).toBe(true);
  });

  it('handles a Decimal-like object via Number coercion', () => {
    // Prisma hands back a Decimal, not a number.
    expect(isSufficientPayment(5000, { toString: () => '50' } as unknown)).toBe(true);
    expect(isSufficientPayment(100, { toString: () => '50' } as unknown)).toBe(false);
  });
});
