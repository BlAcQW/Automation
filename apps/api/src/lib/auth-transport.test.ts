import { describe, expect, it } from 'vitest';
import { extractRefreshToken, isMobileClient } from './auth-transport.js';

describe('isMobileClient', () => {
  it('is true when X-Client header is mobile (any case)', () => {
    expect(isMobileClient({ 'x-client': 'mobile' })).toBe(true);
    expect(isMobileClient({ 'x-client': 'Mobile' })).toBe(true);
  });

  it('handles an array header value', () => {
    expect(isMobileClient({ 'x-client': ['mobile'] })).toBe(true);
  });

  it('is false for web / missing / other values', () => {
    expect(isMobileClient({})).toBe(false);
    expect(isMobileClient({ 'x-client': 'web' })).toBe(false);
    expect(isMobileClient({ 'x-client': undefined })).toBe(false);
  });
});

describe('extractRefreshToken', () => {
  it('prefers the cookie (web)', () => {
    expect(extractRefreshToken({ cookies: { refreshToken: 'cookie-tok' }, body: { refreshToken: 'body-tok' } })).toBe(
      'cookie-tok',
    );
  });

  it('falls back to the body (mobile)', () => {
    expect(extractRefreshToken({ body: { refreshToken: 'body-tok' } })).toBe('body-tok');
  });

  it('returns undefined when neither is present', () => {
    expect(extractRefreshToken({})).toBeUndefined();
    expect(extractRefreshToken({ body: {} })).toBeUndefined();
    expect(extractRefreshToken({ body: { refreshToken: '' } })).toBeUndefined();
    expect(extractRefreshToken({ body: { refreshToken: 123 } })).toBeUndefined();
  });
});
