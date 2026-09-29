import { describe, expect, it } from 'vitest';
import {
  checkWithdrawal,
  MIN_PAYOUT_MINOR,
  MAX_DAILY_PAYOUTS,
} from './payout-request.js';

/** A request that should succeed, which each test then breaks one way. */
const ok = {
  amountMinor: 5000,
  availableMinor: 10_000,
  destinationUsable: true,
  inFlightCount: 0,
  payoutsToday: 0,
  withdrawnTodayMinor: 0,
  maxDailyMinor: 500_000,
};

describe('checkWithdrawal', () => {
  it('allows a normal withdrawal', () => {
    expect(checkWithdrawal(ok)).toEqual({ allowed: true });
  });

  it('allows withdrawing the entire available balance', () => {
    expect(checkWithdrawal({ ...ok, amountMinor: 10_000 })).toEqual({ allowed: true });
  });

  it('refuses a penny more than is available', () => {
    // The balance passed in is re-derived from the ledger inside the
    // transaction, so this is the last line before a negative balance.
    expect(checkWithdrawal({ ...ok, amountMinor: 10_001 })).toEqual({
      allowed: false,
      reason: 'insufficient_funds',
    });
  });

  it('refuses when nothing has cleared yet', () => {
    expect(checkWithdrawal({ ...ok, availableMinor: 0 })).toEqual({
      allowed: false,
      reason: 'insufficient_funds',
    });
  });

  it('refuses a zero, negative or fractional amount', () => {
    for (const amountMinor of [0, -1, -5000, 50.5]) {
      expect(checkWithdrawal({ ...ok, amountMinor }).allowed).toBe(false);
    }
  });

  it('refuses below the provider minimum', () => {
    expect(checkWithdrawal({ ...ok, amountMinor: MIN_PAYOUT_MINOR - 1 })).toEqual({
      allowed: false,
      reason: 'below_minimum',
    });
  });

  it('refuses when the destination is still in cooling-off', () => {
    // The takeover guard: a freshly changed number cannot be paid to yet.
    expect(checkWithdrawal({ ...ok, destinationUsable: false })).toEqual({
      allowed: false,
      reason: 'destination_not_ready',
    });
  });

  it('refuses while another payout is still in flight', () => {
    // This is the double-tap guard as much as a business rule: a second
    // request cannot be created while the first has not settled.
    expect(checkWithdrawal({ ...ok, inFlightCount: 1 })).toEqual({
      allowed: false,
      reason: 'payout_in_flight',
    });
  });

  it('refuses past the daily count cap', () => {
    expect(checkWithdrawal({ ...ok, payoutsToday: MAX_DAILY_PAYOUTS })).toEqual({
      allowed: false,
      reason: 'daily_count_reached',
    });
  });

  it('refuses when the amount would cross the daily total cap', () => {
    // Velocity, not just balance: draining a large balance in one day is the
    // shape of a compromised account even when every individual request is
    // affordable.
    expect(
      checkWithdrawal({
        ...ok,
        amountMinor: 200_000,
        availableMinor: 1_000_000,
        withdrawnTodayMinor: 400_000,
        maxDailyMinor: 500_000,
      }),
    ).toEqual({ allowed: false, reason: 'daily_limit_reached' });
  });

  it('allows an amount that exactly reaches the daily cap', () => {
    expect(
      checkWithdrawal({
        ...ok,
        amountMinor: 100_000,
        availableMinor: 1_000_000,
        withdrawnTodayMinor: 400_000,
        maxDailyMinor: 500_000,
      }),
    ).toEqual({ allowed: true });
  });

  it('checks funds before anything else, so the message is the useful one', () => {
    // Several rules fail at once here; the owner should be told the one that
    // actually explains why, not the first in the list.
    const result = checkWithdrawal({ ...ok, amountMinor: 999_999, availableMinor: 100 });
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe('insufficient_funds');
  });
});
