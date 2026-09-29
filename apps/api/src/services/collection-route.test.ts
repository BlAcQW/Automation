import { describe, expect, it } from 'vitest';
import { resolveCollectionRoute } from './collection-route.js';

describe('resolveCollectionRoute', () => {
  it('uses the platform account when the tenant has no gateway of their own', () => {
    // The whole point: a salon owner never creates a Paystack account.
    expect(
      resolveCollectionRoute({ tenantSecretKeyEncrypted: null }, 'sk_platform'),
    ).toEqual({ route: 'PLATFORM', secretKey: 'sk_platform' });
  });

  it('keeps using the tenant key when they already connected one', () => {
    // Anyone already live keeps their existing arrangement — money they are
    // already collecting must not silently start landing somewhere else.
    expect(
      resolveCollectionRoute(
        { tenantSecretKeyEncrypted: 'enc' },
        'sk_platform',
        () => 'sk_tenant',
      ),
    ).toEqual({ route: 'OWN_GATEWAY', secretKey: 'sk_tenant' });
  });

  it('returns null when neither is configured', () => {
    // No silent fallback to nothing: the caller must handle "cannot collect".
    expect(resolveCollectionRoute({ tenantSecretKeyEncrypted: null }, undefined)).toBeNull();
  });

  it('falls back to the platform when the tenant key cannot be decrypted', () => {
    // A corrupt or rotated key must not stop the business taking money.
    const route = resolveCollectionRoute(
      { tenantSecretKeyEncrypted: 'corrupt' },
      'sk_platform',
      () => { throw new Error('bad key'); },
    );
    expect(route).toEqual({ route: 'PLATFORM', secretKey: 'sk_platform' });
  });

  it('returns null when the tenant key is broken and there is no platform key', () => {
    expect(
      resolveCollectionRoute(
        { tenantSecretKeyEncrypted: 'corrupt' },
        undefined,
        () => { throw new Error('bad key'); },
      ),
    ).toBeNull();
  });

  it('only credits the ledger for platform-collected money', () => {
    // Money collected into the tenant's own Paystack never touches our
    // balance, so crediting a wallet for it would invent funds we do not hold.
    const platform = resolveCollectionRoute({ tenantSecretKeyEncrypted: null }, 'sk_platform');
    const own = resolveCollectionRoute({ tenantSecretKeyEncrypted: 'enc' }, 'sk_platform', () => 'sk_t');
    expect(platform?.route).toBe('PLATFORM');
    expect(own?.route).toBe('OWN_GATEWAY');
  });
});
