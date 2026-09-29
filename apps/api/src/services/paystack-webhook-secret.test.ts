import { describe, expect, it } from 'vitest';
import { selectWebhookSecretSource } from './paystack-webhook-secret.js';

describe('selectWebhookSecretSource', () => {
  it('verifies a transfer event with the platform key', () => {
    // Transfers are always initiated by Bookly from Bookly's balance, so the
    // tenant's key could never sign them.
    expect(selectWebhookSecretSource('transfer.success', 'trf_x', undefined)).toBe('PLATFORM');
    expect(selectWebhookSecretSource('transfer.failed', 'trf_x', undefined)).toBe('PLATFORM');
    expect(selectWebhookSecretSource('transfer.reversed', 'trf_x', undefined)).toBe('PLATFORM');
  });

  it('verifies a platform-collected charge with the platform key', () => {
    // The bug this exists to prevent: a tenant with no Paystack account of
    // their own has no key to verify against, so their payments were being
    // dropped as "unknown tenant" and never fulfilled.
    expect(
      selectWebhookSecretSource('charge.success', 'bf_p_bk1_1', { collectionRoute: 'PLATFORM' }),
    ).toBe('PLATFORM');
  });

  it('falls back to the reference prefix when metadata is absent', () => {
    expect(selectWebhookSecretSource('charge.success', 'bf_p_bk1_1', undefined)).toBe('PLATFORM');
  });

  it('verifies an own-gateway charge with the tenant key', () => {
    expect(
      selectWebhookSecretSource('charge.success', 'bf_o_bk1_1', { collectionRoute: 'OWN_GATEWAY' }),
    ).toBe('TENANT');
    expect(selectWebhookSecretSource('charge.success', 'bf_o_bk1_1', undefined)).toBe('TENANT');
  });

  it('treats an unmarked legacy reference as the tenant key', () => {
    // Everything taken before platform collection existed went through the
    // tenant's own account, so that is the only key that can verify it.
    expect(selectWebhookSecretSource('charge.success', 'bf_bk1_1', undefined)).toBe('TENANT');
  });

  it('trusts metadata over the prefix', () => {
    expect(
      selectWebhookSecretSource('charge.success', 'bf_o_bk1_1', { collectionRoute: 'PLATFORM' }),
    ).toBe('PLATFORM');
  });
});
