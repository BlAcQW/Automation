import { describe, it, expect } from 'vitest';
import { buildResetLink, resetLinkOptions, resolveResetBase, type ResetLinkConfig } from './reset-link.js';

const prod: ResetLinkConfig = {
    nodeEnv: 'production',
    frontendUrl: 'https://app.bookly.test',
    allowedOrigins: ['https://app.bookly.test', 'https://turbo-gh.vercel.app', 'https://console.example.org/'],
};
const DEFAULT = 'https://app.bookly.test/reset-password';

describe('resolveResetBase', () => {
    it('falls back to the Bookly reset page when nothing is asked for', () => {
        expect(resolveResetBase(undefined, prod)).toEqual({ base: DEFAULT, custom: false });
        expect(resolveResetBase(null, prod)).toEqual({ base: DEFAULT, custom: false });
        expect(resolveResetBase('', prod)).toEqual({ base: DEFAULT, custom: false });
    });

    it('uses an https page on an allowed origin, path kept, query and fragment dropped', () => {
        expect(resolveResetBase('https://turbo-gh.vercel.app/reset-password', prod))
            .toEqual({ base: 'https://turbo-gh.vercel.app/reset-password', custom: true, origin: 'https://turbo-gh.vercel.app' });
        expect(resolveResetBase('https://turbo-gh.vercel.app/auth/reset?x=1#frag', prod).base)
            .toBe('https://turbo-gh.vercel.app/auth/reset');
        // A configured origin written with a trailing slash still matches.
        expect(resolveResetBase('https://console.example.org/reset', prod).custom).toBe(true);
    });

    it.each([
        ['a foreign origin', 'https://evil.example.com/reset-password'],
        ['http on an allowed host', 'http://turbo-gh.vercel.app/reset-password'],
        ['javascript:', 'javascript:alert(1)//https://turbo-gh.vercel.app'],
        ['data:', 'data:text/html,<script>alert(1)</script>'],
        ['a lookalike host (suffix)', 'https://turbo-gh.vercel.app.evil.com/reset-password'],
        ['a lookalike host (prefix)', 'https://evilturbo-gh.vercel.app/reset-password'],
        ['a subdomain of an allowed host', 'https://x.turbo-gh.vercel.app/reset-password'],
        ['a different port', 'https://turbo-gh.vercel.app:8443/reset-password'],
        ['credentials in the URL', 'https://user:pass@turbo-gh.vercel.app/reset-password'],
        ['userinfo trick', 'https://turbo-gh.vercel.app@evil.com/reset-password'],
        ['protocol-relative', '//turbo-gh.vercel.app/reset-password'],
        ['a relative path', '/reset-password'],
        ['garbage', 'not a url'],
        ['a non-string', { href: 'https://turbo-gh.vercel.app' }],
        ['an over-long URL', `https://turbo-gh.vercel.app/${'a'.repeat(3000)}`],
        ['localhost in production', 'http://localhost:3000/reset-password'],
    ])('ignores %s', (_label, input) => {
        const cfg = { ...prod, allowedOrigins: [...prod.allowedOrigins, 'http://localhost:3000'] };
        expect(resolveResetBase(input, cfg)).toEqual({ base: DEFAULT, custom: false });
    });

    it('allows http://localhost only in development and test, and only when it is an allowed origin', () => {
        const dev: ResetLinkConfig = { nodeEnv: 'development', frontendUrl: 'http://localhost:3000', allowedOrigins: ['http://localhost:3000', 'http://localhost:5173'] };
        expect(resolveResetBase('http://localhost:5173/reset-password', dev).custom).toBe(true);
        expect(resolveResetBase('http://localhost:5174/reset-password', dev).custom).toBe(false);
        expect(resolveResetBase('http://127.0.0.1:5173/reset-password', dev).custom).toBe(false);
        expect(resolveResetBase('http://localhost:5173/reset-password', { ...dev, nodeEnv: 'test' }).custom).toBe(true);
    });

    it('ignores allowed origins that are not https in production (misconfiguration does not widen it)', () => {
        const cfg = { ...prod, allowedOrigins: [...prod.allowedOrigins, 'http://legacy.example.com'] };
        expect(resolveResetBase('http://legacy.example.com/reset', cfg).custom).toBe(false);
    });
});

describe('buildResetLink', () => {
    it('sets the token as a query parameter with URL APIs', () => {
        const link = buildResetLink('https://turbo-gh.vercel.app/reset-password', 'abc.def-_');
        expect(link).toBe('https://turbo-gh.vercel.app/reset-password?token=abc.def-_');
        expect(new URL(link).searchParams.get('token')).toBe('abc.def-_');
    });

    it('encodes anything unusual instead of concatenating it', () => {
        const link = buildResetLink('https://app.bookly.test/reset-password', 'a&b=c#d');
        expect(new URL(link).searchParams.get('token')).toBe('a&b=c#d');
        expect(new URL(link).hash).toBe('');
    });
});

describe('resetLinkOptions', () => {
    it('lists Bookly first, then every other allowed https origin once', () => {
        const opts = resetLinkOptions(prod);
        expect(opts[0]).toEqual({ label: 'Bookly', origin: 'https://app.bookly.test', resetUrl: DEFAULT, isDefault: true });
        expect(opts.slice(1)).toEqual([
            { label: 'turbo-gh.vercel.app', origin: 'https://turbo-gh.vercel.app', resetUrl: 'https://turbo-gh.vercel.app/reset-password', isDefault: false },
            { label: 'console.example.org', origin: 'https://console.example.org', resetUrl: 'https://console.example.org/reset-password', isDefault: false },
        ]);
    });

    it('drops origins the resolver would refuse', () => {
        const opts = resetLinkOptions({ ...prod, allowedOrigins: [...prod.allowedOrigins, 'http://legacy.example.com', 'nonsense'] });
        expect(opts.map((o) => o.origin)).not.toContain('http://legacy.example.com');
        expect(opts).toHaveLength(3);
    });
});
