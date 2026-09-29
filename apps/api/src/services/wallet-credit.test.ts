import { describe, expect, it } from 'vitest';
import { isPlatformCollected, depositIdempotencyKey } from './wallet-credit.js';

describe('isPlatformCollected', () => {
  it('is true only for an explicit stored PLATFORM route', () => {
    expect(isPlatformCollected('PLATFORM')).toBe(true);
  });

  it('is false for an own-gateway payment', () => {
    // That money went into the tenant's own Paystack and never reached us.
    expect(isPlatformCollected('OWN_GATEWAY')).toBe(false);
  });

  it('fails closed on anything unrecognised', () => {
    // Legacy rows predating the column, and any value we did not write.
    // Leaving money uncredited is recoverable; crediting money we never
    // received is not.
    expect(isPlatformCollected(null)).toBe(false);
    expect(isPlatformCollected(undefined)).toBe(false);
    expect(isPlatformCollected('')).toBe(false);
    expect(isPlatformCollected('platform')).toBe(false);
    expect(isPlatformCollected('SOMETHING_ELSE')).toBe(false);
  });
});

describe('depositIdempotencyKey', () => {
  it('is derived from the provider reference, not generated', () => {
    // A generated key would let a redelivered webhook credit twice.
    expect(depositIdempotencyKey('bf_p_bk1_1790000000')).toBe('deposit:bf_p_bk1_1790000000');
  });

  it('is stable across calls', () => {
    expect(depositIdempotencyKey('ref1')).toBe(depositIdempotencyKey('ref1'));
  });

  it('differs per reference', () => {
    expect(depositIdempotencyKey('ref1')).not.toBe(depositIdempotencyKey('ref2'));
  });
});
