import { describe, expect, it } from 'vitest';
import {
  coolingOffUntil,
  destinationIsUsable,
  COOLING_OFF_HOURS,
} from './payout-recipient.js';

const NOW = new Date('2026-10-01T09:00:00Z');

describe('coolingOffUntil', () => {
  it('lets a first destination be used immediately', () => {
    // The attack this guards against is changing the destination on an
    // account that already has money. A brand new account has neither a
    // balance worth stealing nor a destination to replace, so a delay here
    // would only punish an honest owner on their first payday.
    expect(coolingOffUntil({ isReplacement: false }, NOW)).toEqual(NOW);
  });

  it('holds a replacement destination for the cooling-off window', () => {
    // Account takeover works by changing where the money goes, not by
    // stealing the login. This is the window in which the real owner can
    // notice and react.
    const until = coolingOffUntil({ isReplacement: true }, NOW);
    expect(until.getTime()).toBe(NOW.getTime() + COOLING_OFF_HOURS * 3600_000);
  });
});

describe('destinationIsUsable', () => {
  it('is usable once the cooling-off has passed', () => {
    expect(
      destinationIsUsable({ usableFrom: new Date('2026-10-01T08:00:00Z'), archivedAt: null }, NOW),
    ).toBe(true);
  });

  it('is not usable during cooling-off', () => {
    expect(
      destinationIsUsable({ usableFrom: new Date('2026-10-02T09:00:00Z'), archivedAt: null }, NOW),
    ).toBe(false);
  });

  it('is usable exactly at the boundary', () => {
    expect(destinationIsUsable({ usableFrom: NOW, archivedAt: null }, NOW)).toBe(true);
  });

  it('is never usable once archived', () => {
    // An old number the owner replaced must not still be payable.
    expect(
      destinationIsUsable(
        { usableFrom: new Date('2026-01-01T00:00:00Z'), archivedAt: NOW },
        NOW,
      ),
    ).toBe(false);
  });

  it('is not usable when there is no destination at all', () => {
    expect(destinationIsUsable(null, NOW)).toBe(false);
    expect(destinationIsUsable(undefined, NOW)).toBe(false);
  });
});
