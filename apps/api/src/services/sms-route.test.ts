import { describe, expect, it } from 'vitest';
import { resolveSmsRoute, withinSmsBudget, DEFAULT_MONTHLY_SMS_BUDGET } from './sms-route.js';

const platform = { apiKey: 'plat_key', senderId: 'Bookly' };

describe('resolveSmsRoute', () => {
  it('uses the platform account when the tenant has none', () => {
    // A salon owner should never have to open an SMS gateway account.
    expect(
      resolveSmsRoute({ arkeselApiKey: null, arkeselSenderId: null }, platform),
    ).toEqual({ route: 'PLATFORM', apiKey: 'plat_key', senderId: 'Bookly' });
  });

  it('keeps using the tenant account when they configured one', () => {
    // Their own sender ID is their brand in the recipient's inbox — taking
    // that away silently would change what their customers see.
    expect(
      resolveSmsRoute(
        { arkeselApiKey: 'enc', arkeselSenderId: 'GlamHouse' },
        platform,
        () => 'tenant_key',
      ),
    ).toEqual({ route: 'OWN_ACCOUNT', apiKey: 'tenant_key', senderId: 'GlamHouse' });
  });

  it('falls back to the platform when the tenant key cannot be decrypted', () => {
    expect(
      resolveSmsRoute({ arkeselApiKey: 'corrupt', arkeselSenderId: 'GlamHouse' }, platform, () => {
        throw new Error('bad key');
      }),
    ).toEqual({ route: 'PLATFORM', apiKey: 'plat_key', senderId: 'Bookly' });
  });

  it('falls back to the platform when the tenant has a key but no sender id', () => {
    // Arkesel rejects a send with no sender, so a half-configured tenant
    // must not be treated as configured.
    expect(
      resolveSmsRoute({ arkeselApiKey: 'enc', arkeselSenderId: null }, platform, () => 'k'),
    ).toEqual({ route: 'PLATFORM', apiKey: 'plat_key', senderId: 'Bookly' });
  });

  it('returns null when neither is available', () => {
    expect(resolveSmsRoute({ arkeselApiKey: null, arkeselSenderId: null }, null)).toBeNull();
  });
});

describe('withinSmsBudget', () => {
  it('allows a tenant under their allowance', () => {
    expect(withinSmsBudget({ sentThisCycle: 10, budget: 100 })).toBe(true);
  });

  it('refuses once the allowance is used up', () => {
    // Platform SMS is Bookly's money. Without a per-tenant cap one busy or
    // misbehaving tenant spends the whole budget.
    expect(withinSmsBudget({ sentThisCycle: 100, budget: 100 })).toBe(false);
    expect(withinSmsBudget({ sentThisCycle: 101, budget: 100 })).toBe(false);
  });

  it('allows the very last message in the allowance', () => {
    expect(withinSmsBudget({ sentThisCycle: 99, budget: 100 })).toBe(true);
  });

  it('treats a zero budget as no platform SMS at all', () => {
    expect(withinSmsBudget({ sentThisCycle: 0, budget: 0 })).toBe(false);
  });

  it('has a sane default budget', () => {
    expect(DEFAULT_MONTHLY_SMS_BUDGET).toBeGreaterThan(0);
  });
});
