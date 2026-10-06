import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import {
    bindTenantContext,
    getTenantContext,
    tenantContext,
    tenantContextOnRequest,
} from './tenant-context.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('tenant context propagation through Fastify hooks', () => {
    it('CHARACTERISATION: enterWith after an await in a hook does not reach the handler', async () => {
        const app = Fastify();
        app.addHook('preHandler', async (req) => {
            await tick(); // stands in for `await request.jwtVerify()`
            tenantContext.enterWith({ tenantId: String(req.headers['x-t']) });
        });
        app.get('/', async () => ({ ctx: getTenantContext() ?? null }));
        const res = await app.inject({ url: '/', headers: { 'x-t': 'a' } });
        expect(res.json()).toEqual({ ctx: null });
    });

    it('bindTenantContext after an await reaches the handler when onRequest opened the store', async () => {
        const app = Fastify();
        app.addHook('onRequest', tenantContextOnRequest);
        app.addHook('preHandler', async (req) => {
            await tick();
            bindTenantContext({ tenantId: String(req.headers['x-t']) });
        });
        app.get('/', async () => {
            await tick();
            return { ctx: getTenantContext() ?? null };
        });
        const res = await app.inject({ url: '/', headers: { 'x-t': 'a' } });
        expect(res.json()).toEqual({ ctx: { tenantId: 'a' } });
    });

    it('keeps concurrent requests isolated from each other', async () => {
        const app = Fastify();
        app.addHook('onRequest', tenantContextOnRequest);
        app.addHook('preHandler', async (req) => {
            await tick();
            bindTenantContext({ tenantId: String(req.headers['x-t']) });
        });
        app.get('/', async (req) => {
            await new Promise((r) => setTimeout(r, Math.random() * 15));
            return { want: req.headers['x-t'], got: getTenantContext()?.tenantId };
        });
        const ids = Array.from({ length: 25 }, (_, i) => `t${i}`);
        const results = await Promise.all(
            ids.map((t) => app.inject({ url: '/', headers: { 'x-t': t } }).then((r) => r.json())),
        );
        for (const r of results) expect(r.got).toBe(r.want);
    });

    it('does not leak into an unauthenticated request or the outer context', async () => {
        const app = Fastify();
        app.addHook('onRequest', tenantContextOnRequest);
        app.get('/', async () => ({ ctx: getTenantContext() ?? null }));
        await app.inject({ url: '/' });
        const res = await app.inject({ url: '/' });
        expect(res.json()).toEqual({ ctx: {} });
        expect(getTenantContext()).toBeUndefined();
    });
});
