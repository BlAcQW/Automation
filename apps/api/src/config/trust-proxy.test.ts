import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { resolveTrustProxy } from './index.js';

describe('resolveTrustProxy', () => {
    it('defaults to loopback (the local nginx hop) when unset or blank', () => {
        expect(resolveTrustProxy(undefined)).toBe('loopback');
        expect(resolveTrustProxy('')).toBe('loopback');
        expect(resolveTrustProxy('   ')).toBe('loopback');
    });

    it('allows switching it off', () => {
        expect(resolveTrustProxy('false')).toBe(false);
        expect(resolveTrustProxy(' FALSE ')).toBe(false);
    });

    it('accepts true, a hop count, and address lists', () => {
        expect(resolveTrustProxy('true')).toBe(true);
        expect(resolveTrustProxy('2')).toBe(2);
        expect(resolveTrustProxy('loopback')).toBe('loopback');
        expect(resolveTrustProxy('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
    });
});

describe('trustProxy wired into Fastify', () => {
    async function ipFor(trust: ReturnType<typeof resolveTrustProxy>, remoteAddress: string, xff?: string) {
        const app = Fastify({ trustProxy: trust });
        app.get('/ip', async (req) => ({ ip: req.ip }));
        const res = await app.inject({
            method: 'GET', url: '/ip', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {},
        });
        await app.close();
        return res.json().ip as string;
    }

    it('default: behind the local nginx the client address comes from X-Forwarded-For', async () => {
        expect(await ipFor(resolveTrustProxy(undefined), '127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    });

    it('default: a spoofed X-Forwarded-For from a non-loopback peer is ignored', async () => {
        expect(await ipFor(resolveTrustProxy(undefined), '198.51.100.7', '203.0.113.9')).toBe('198.51.100.7');
    });

    it('false: the header is never believed', async () => {
        expect(await ipFor(resolveTrustProxy('false'), '127.0.0.1', '203.0.113.9')).toBe('127.0.0.1');
    });
});
