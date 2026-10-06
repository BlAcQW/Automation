import { describe, it, expect } from 'vitest';
import { accessTokenCookieString, clearAccessTokenCookieString } from './cookie';

describe('access-token presence cookie', () => {
    it('sets path, 15-minute max-age, lax, and Secure in production', () => {
        expect(accessTokenCookieString({ name: 'accessToken', maxAgeSeconds: 900 }, 'a b', true)).toBe(
            'accessToken=a%20b; path=/; max-age=900; samesite=lax; secure',
        );
    });
    it('omits Secure outside production', () => {
        expect(accessTokenCookieString({ name: 'accessToken', maxAgeSeconds: 900 }, 'tok', false)).toBe(
            'accessToken=tok; path=/; max-age=900; samesite=lax',
        );
    });
    it('clears with max-age=0', () => {
        expect(clearAccessTokenCookieString({ name: 'accessToken', maxAgeSeconds: 900 })).toBe(
            'accessToken=; path=/; max-age=0; samesite=lax',
        );
    });
});
