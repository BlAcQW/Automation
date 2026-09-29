import { describe, expect, it } from 'vitest';
import { normalizeCustomerPhone, countryCodeFromE164 } from './customer-phone.js';

describe('countryCodeFromE164', () => {
  it('reads a Ghanaian country code', () => {
    expect(countryCodeFromE164('+233241234567')).toBe('233');
  });

  it('reads a one-digit country code', () => {
    expect(countryCodeFromE164('+14155550123')).toBe('1');
  });

  it('reads a two-digit country code', () => {
    expect(countryCodeFromE164('+447700900123')).toBe('44');
  });

  it('returns null without a leading plus', () => {
    // A number we cannot be sure about must not silently invent a country.
    expect(countryCodeFromE164('0241234567')).toBeNull();
    expect(countryCodeFromE164('')).toBeNull();
  });
});

describe('normalizeCustomerPhone', () => {
  it('accepts a full international number', () => {
    expect(normalizeCustomerPhone('+233 24 123 4567')).toBe('+233241234567');
  });

  it('completes a local number using the business country', () => {
    // A customer on Instagram types their number the way they say it.
    expect(normalizeCustomerPhone('024 123 4567', '+233209999999')).toBe('+233241234567');
  });

  it('refuses a local number when the business country is unknown', () => {
    // Guessing a country would produce a number that silently never delivers.
    expect(normalizeCustomerPhone('0241234567')).toBeNull();
  });

  it('accepts a bare international number without the plus', () => {
    expect(normalizeCustomerPhone('233241234567')).toBe('+233241234567');
  });

  it('refuses something too short to be a phone number', () => {
    expect(normalizeCustomerPhone('12345')).toBeNull();
    expect(normalizeCustomerPhone('+1234')).toBeNull();
  });

  it('refuses text with no digits', () => {
    expect(normalizeCustomerPhone('call me')).toBeNull();
    expect(normalizeCustomerPhone('')).toBeNull();
  });

  it('refuses an implausibly long number', () => {
    // Guards against a customer pasting an order reference or an account number.
    expect(normalizeCustomerPhone('+2332412345678901234')).toBeNull();
  });

  it('strips punctuation people actually type', () => {
    expect(normalizeCustomerPhone('(024)-123-4567', '+233209999999')).toBe('+233241234567');
  });
});
