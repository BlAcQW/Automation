import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import errorHandler from './error-handler.js';
import {
    GUARDED_OPERATIONS,
    TenantGuardError,
    guardDecision,
    hasTenantFilter,
    resolveGuardMode,
} from './tenant-guard.js';

const scopedModels = new Set(['Booking', 'Service']);
const tenantCtx = { tenantId: 't1', userId: 'u1' };

describe('hasTenantFilter', () => {
    it.each([
        [{ id: 'x', tenantId: 't1' }, true],
        [{ tenantId: { in: ['a'] } }, true],
        [{ tenantId_email: { tenantId: 't', email: 'e' } }, true],
        [{ id: 'x' }, false],
        [{}, false],
        [undefined, false],
        [null, false],
        ['tenantId', false],
        [{ tenantId: undefined }, false],
        [{ tenantId: null }, false],
    ])('%j -> %s', (where, expected) => {
        expect(hasTenantFilter(where)).toBe(expected);
    });
});

describe('resolveGuardMode', () => {
    it('defaults to block', () => {
        expect(resolveGuardMode(undefined)).toBe('block');
        expect(resolveGuardMode('')).toBe('block');
    });
    it('accepts warn and block, case/space-insensitive', () => {
        expect(resolveGuardMode('warn')).toBe('warn');
        expect(resolveGuardMode(' WARN ')).toBe('warn');
        expect(resolveGuardMode('block')).toBe('block');
    });
    it('unknown values fail closed to block', () => {
        expect(resolveGuardMode('off')).toBe('block');
        expect(resolveGuardMode('false')).toBe('block');
    });
});

describe('guardDecision', () => {
    const base = { model: 'Booking', operation: 'update', where: { id: 'b1' }, ctx: tenantCtx, scopedModels };

    it('blocks an unscoped guarded op in tenant context (block mode)', () => {
        expect(guardDecision({ ...base, mode: 'block' })).toBe('block');
    });
    it('warns for the same call in warn mode', () => {
        expect(guardDecision({ ...base, mode: 'warn' })).toBe('warn');
    });
    it('allows when where has tenantId', () => {
        expect(guardDecision({ ...base, where: { id: 'b1', tenantId: 't1' }, mode: 'block' })).toBe('allow');
    });
    it('allows a tenantId_* compound unique', () => {
        expect(guardDecision({ ...base, where: { tenantId_x: { tenantId: 't1', x: 1 } }, mode: 'block' })).toBe('allow');
    });
    it('blocks when where is missing entirely', () => {
        expect(guardDecision({ ...base, where: undefined, mode: 'block' })).toBe('block');
    });
    it('allows with no context (webhooks, workers)', () => {
        expect(guardDecision({ ...base, ctx: undefined, mode: 'block' })).toBe('allow');
    });
    it('allows admin context', () => {
        expect(guardDecision({ ...base, ctx: { adminId: 'a1' }, mode: 'block' })).toBe('allow');
    });
    it('allows a context that has an adminId even with a tenantId', () => {
        expect(guardDecision({ ...base, ctx: { tenantId: 't1', adminId: 'a1' }, mode: 'block' })).toBe('allow');
    });
    it('allows context without tenantId', () => {
        expect(guardDecision({ ...base, ctx: { userId: 'u' }, mode: 'block' })).toBe('allow');
    });
    it('allows models outside the scoped set', () => {
        expect(guardDecision({ ...base, model: 'Tenant', mode: 'block' })).toBe('allow');
    });
    it('allows unguarded operations (create, upsert, createMany)', () => {
        for (const operation of ['create', 'createMany', 'upsert']) {
            expect(guardDecision({ ...base, operation, mode: 'block' })).toBe('allow');
        }
    });
    it('covers every guarded read/write operation', () => {
        for (const operation of GUARDED_OPERATIONS) {
            expect(guardDecision({ ...base, operation, mode: 'block' })).toBe('block');
        }
        expect(GUARDED_OPERATIONS.has('update')).toBe(true);
        expect(GUARDED_OPERATIONS.has('deleteMany')).toBe(true);
    });
});

describe('TenantGuardError', () => {
    it('carries model/operation, is a 500 and exposes no row data', () => {
        const e = new TenantGuardError('Booking', 'update');
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('TenantGuardError');
        expect(e.model).toBe('Booking');
        expect(e.operation).toBe('update');
        expect(e.statusCode).toBe(500);
        expect(e.message).toContain('Booking.update');
    });
});

describe('TenantGuardError through the real error handler', () => {
    it('is a generic 500 that does not echo the model or operation to the client', async () => {
        const app = Fastify({ logger: false });
        await app.register(errorHandler);
        app.get('/', async () => {
            throw new TenantGuardError('Booking', 'update');
        });
        const res = await app.inject({ url: '/' });
        expect(res.statusCode).toBe(500);
        const body = res.json();
        expect(body.message).toBe('Something went wrong on our side. Please try again.');
        expect(res.body).not.toContain('Booking');
        expect(res.body).not.toContain('tenantId');
        await app.close();
    });
});
