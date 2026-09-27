import { describe, expect, it } from 'vitest';
import { normalizeLocalNumber, toE164, NumberOnboardingError } from './meta-number-onboarding.js';

describe('normalizeLocalNumber', () => {
  it('strips spaces, dashes and parentheses', () => {
    expect(normalizeLocalNumber('024 123 4567')).toBe('241234567');
    expect(normalizeLocalNumber('(024)-123-4567')).toBe('241234567');
  });

  // Ghanaian numbers are written and spoken with the national trunk prefix
  // (024...), but Meta wants the subscriber number without it. Getting this
  // wrong produces a number Meta accepts but nobody can message.
  it('strips a single leading national trunk zero', () => {
    expect(normalizeLocalNumber('0241234567')).toBe('241234567');
  });

  it('leaves a number that has no trunk zero untouched', () => {
    expect(normalizeLocalNumber('241234567')).toBe('241234567');
  });

  it('strips only the first zero, not significant ones', () => {
    expect(normalizeLocalNumber('0204567890')).toBe('204567890');
  });

  it('removes a leading + and country code typed into the local field', () => {
    // A user who pastes the full international form into the local box should
    // not end up with the country code duplicated.
    expect(normalizeLocalNumber('+233241234567', '233')).toBe('241234567');
    expect(normalizeLocalNumber('233241234567', '233')).toBe('241234567');
  });

  it('throws on input with no digits', () => {
    expect(() => normalizeLocalNumber('abc')).toThrow(NumberOnboardingError);
  });

  it('throws on an implausibly short number', () => {
    expect(() => normalizeLocalNumber('12345')).toThrow(NumberOnboardingError);
  });
});

describe('toE164', () => {
  it('joins country code and local number', () => {
    expect(toE164('233', '241234567')).toBe('+233241234567');
  });

  it('tolerates a country code written with a plus', () => {
    expect(toE164('+233', '241234567')).toBe('+233241234567');
  });

  it('rejects a non-numeric country code', () => {
    expect(() => toE164('GH', '241234567')).toThrow(NumberOnboardingError);
  });
});
