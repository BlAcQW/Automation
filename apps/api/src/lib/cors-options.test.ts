import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { corsOptions } from './cors-options.js';

describe('corsOptions (shared by src/index.ts)', () => {
    it('lets a configured console read Retry-After cross-site, with credentials', async () => {
        const app = Fastify();
        await app.register(cors, corsOptions(['https://console.turboghana.app']));
        app.get('/x', async (_req, reply) => reply.header('Retry-After', '42').code(429).send({ code: 'RESEND_TOO_SOON' }));
        const res = await app.inject({ url: '/x', headers: { origin: 'https://console.turboghana.app' } });
        expect(res.headers['access-control-allow-origin']).toBe('https://console.turboghana.app');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
        expect(String(res.headers['access-control-expose-headers'])).toMatch(/Retry-After/i);
    });

    it('does not reflect an unlisted origin', async () => {
        const app = Fastify();
        await app.register(cors, corsOptions(['https://console.turboghana.app']));
        app.get('/x', async () => ({ ok: true }));
        const res = await app.inject({ url: '/x', headers: { origin: 'https://evil.example' } });
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
});
