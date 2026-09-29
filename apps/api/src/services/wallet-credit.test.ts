import { describe, expect, it } from 'vitest';
import { isPlatformCollected, depositIdempotencyKey } from './wallet-credit.js';

describe('isPlatformCollected', () => {
  it('recognises a platform reference', () => {
    expect(isPlatformCollected('bf_p_bk1_1790000000', undefined)).toBe(true);
  });

  it('recognises an own-gateway reference', () => {
    expect(isPlatformCollected('bf_o_bk1_1790000000', undefined)).toBe(false);
  });

  it('trusts explicit metadata over the reference', () => {
    // Metadata is the authoritative signal when present; the prefix is a
    // fallback for replays that arrive without it.
    expect(isPlatformCollected('bf_o_bk1_1', { collectionRoute: 'PLATFORM' })).toBe(true);
    expect(isPlatformCollected('bf_p_bk1_1', { collectionRoute: 'OWN_GATEWAY' })).toBe(false);
  });

  it('treats an unmarked legacy reference as NOT platform-collected', () => {
    // Every payment taken before this feature existed went into the tenant's
    // own Paystack. Crediting a wallet for those would invent money we never
    // received — fail closed.
    expect(isPlatformCollected('bf_bk1_1790000000', undefined)).toBe(false);
    expect(isPlatformCollected('', undefined)).toBe(false);
    expect(isPlatformCollected('some-other-psp-ref', undefined)).toBe(false);
  });

  it('ignores unrecognised metadata values and falls back to the prefix', () => {
    expect(isPlatformCollected('bf_p_bk1_1', { collectionRoute: 'NONSENSE' })).toBe(true);
    expect(isPlatformCollected('bf_bk1_1', { collectionRoute: 'NONSENSE' })).toBe(false);
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
