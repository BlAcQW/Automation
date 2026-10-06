import { describe, it, expect } from 'vitest';
import { resolveCrossSiteAuth } from './index.js';

const prod = {
    nodeEnv: 'production' as const,
    apiPublicUrl: 'https://api.example.com',
    corsOrigins: ['https://app.example.com', 'https://console.example.org'],
};

describe('resolveCrossSiteAuth', () => {
    it('is off by default (flag unset, empty, false, anything but "true")', () => {
        for (const flag of [undefined, '', 'false', '0', 'yes', 'TRUE ']) {
            expect(resolveCrossSiteAuth({ ...prod, flag })).toBe(false);
        }
    });

    it('turns on in production when the API and every origin are https', () => {
        expect(resolveCrossSiteAuth({ ...prod, flag: 'true' })).toBe(true);
    });

    it('refuses in production when the API URL is not https', () => {
        expect(() => resolveCrossSiteAuth({ ...prod, flag: 'true', apiPublicUrl: 'http://api.example.com' })).toThrow(/https/i);
    });

    it('refuses in production when a CORS origin is not https', () => {
        expect(() =>
            resolveCrossSiteAuth({ ...prod, flag: 'true', corsOrigins: ['https://a.com', 'http://b.com'] }),
        ).toThrow(/https/i);
    });

    it('refuses outside production without the explicit dev override', () => {
        const dev = { nodeEnv: 'development' as const, apiPublicUrl: 'http://localhost:3001', corsOrigins: ['http://localhost:3000'] };
        expect(() => resolveCrossSiteAuth({ ...dev, flag: 'true' })).toThrow(/CROSS_SITE_AUTH_ALLOW_INSECURE_DEV/);
        expect(resolveCrossSiteAuth({ ...dev, flag: 'true', devOverride: 'true' })).toBe(true);
    });

    it('never honours the dev override in production', () => {
        expect(() =>
            resolveCrossSiteAuth({ ...prod, flag: 'true', apiPublicUrl: 'http://x.com', devOverride: 'true' }),
        ).toThrow(/https/i);
    });

    it('does not allow the override under NODE_ENV=test', () => {
        expect(() =>
            resolveCrossSiteAuth({ nodeEnv: 'test', apiPublicUrl: 'http://localhost', corsOrigins: [], flag: 'true', devOverride: 'true' }),
        ).toThrow();
    });
});
