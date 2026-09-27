import { describe, expect, it } from 'vitest';
import { selectCredentialSource } from './whatsapp-credentials.js';

const base = {
  whatsappPhoneNumberId: null as string | null,
  whatsappAccessToken: null as string | null,
  whatsappHosted: false,
  whatsappNumberStatus: null as string | null,
};

describe('selectCredentialSource', () => {
  it('returns null when no number is connected', () => {
    expect(selectCredentialSource({ ...base })).toBeNull();
  });

  it('returns null for a missing tenant', () => {
    // Call sites pass the result of findUnique straight in.
    expect(selectCredentialSource(null)).toBeNull();
    expect(selectCredentialSource(undefined)).toBeNull();
  });

  it('uses the tenant token for a bring-your-own number', () => {
    expect(
      selectCredentialSource({
        ...base,
        whatsappPhoneNumberId: 'pn_1',
        whatsappAccessToken: 'encrypted-token',
      }),
    ).toEqual({ kind: 'own', phoneNumberId: 'pn_1', encryptedToken: 'encrypted-token' });
  });

  it('returns null for a bring-your-own number missing its token', () => {
    // Half-connected rows must not be treated as live — the old inline checks
    // guarded on the token being present and this preserves that.
    expect(
      selectCredentialSource({ ...base, whatsappPhoneNumberId: 'pn_1' }),
    ).toBeNull();
  });

  it('uses the platform token for a registered hosted number', () => {
    expect(
      selectCredentialSource({
        ...base,
        whatsappPhoneNumberId: 'pn_2',
        whatsappHosted: true,
        whatsappNumberStatus: 'REGISTERED',
      }),
    ).toEqual({ kind: 'hosted', phoneNumberId: 'pn_2' });
  });

  it('returns null for a hosted number still awaiting its OTP', () => {
    // The number exists on our WABA but is not registered for Cloud API yet.
    // Sending on it would fail at Meta with "account not registered".
    expect(
      selectCredentialSource({
        ...base,
        whatsappPhoneNumberId: 'pn_3',
        whatsappHosted: true,
        whatsappNumberStatus: 'PENDING_CODE',
      }),
    ).toBeNull();
  });

  it('ignores a stale tenant token on a hosted number', () => {
    // A tenant migrated from bring-your-own to hosted may still carry an old
    // encrypted token. The platform token is the correct one for our WABA.
    expect(
      selectCredentialSource({
        ...base,
        whatsappPhoneNumberId: 'pn_4',
        whatsappAccessToken: 'stale-token',
        whatsappHosted: true,
        whatsappNumberStatus: 'REGISTERED',
      }),
    ).toEqual({ kind: 'hosted', phoneNumberId: 'pn_4' });
  });
});
