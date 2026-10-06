import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { STEPUP_MAX_FAILURES, STEPUP_LOCK_MS, checkStepUp, verifyStepUp } from './payout-stepup.js';
import { resetThrottleMemory } from './admin-throttle.js';

const hash = bcrypt.hashSync('correct horse', 4);
beforeEach(() => resetThrottleMemory());
const prismaWith = (user: unknown) => ({ user: { findFirst: vi.fn(async () => user) } }) as any;

describe('verifyStepUp', () => {
    it('accepts the account password', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        expect(await verifyStepUp(prisma, { tenantId: 't1', userId: 'u1', password: 'correct horse' })).toBe(true);
    });

    it('looks the user up inside the tenant', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        await verifyStepUp(prisma, { tenantId: 't1', userId: 'u1', password: 'correct horse' });
        expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1', tenantId: 't1' } }));
    });

    it('rejects a wrong password', async () => {
        expect(await verifyStepUp(prismaWith({ passwordHash: hash, isActive: true }), { tenantId: 't1', userId: 'u1', password: 'nope' })).toBe(false);
    });

    it.each([undefined, null, '', 42, {}, 'x'.repeat(5000)])('rejects a missing or unusable password (%s) without touching the database', async (password) => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        expect(await verifyStepUp(prisma, { tenantId: 't1', userId: 'u1', password: password as any })).toBe(false);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when the user is gone, or has no usable hash', async () => {
        expect(await verifyStepUp(prismaWith(null), { tenantId: 't1', userId: 'u1', password: 'correct horse' })).toBe(false);
        expect(await verifyStepUp(prismaWith({ passwordHash: '' }), { tenantId: 't1', userId: 'u1', password: 'correct horse' })).toBe(false);
        expect(await verifyStepUp(prismaWith({ passwordHash: 'not-a-bcrypt-hash' }), { tenantId: 't1', userId: 'u1', password: 'correct horse' })).toBe(false);
    });
});

describe('verifyStepUp: deactivated users', () => {
    it('a deactivated user cannot step up even with the right password', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: false });
        expect(await verifyStepUp(prisma, { tenantId: 't1', userId: 'u1', password: 'correct horse' })).toBe(false);
    });
    it('asks the database for isActive', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        await verifyStepUp(prisma, { tenantId: 't1', userId: 'u1', password: 'correct horse' });
        expect(prisma.user.findFirst.mock.calls[0][0].select).toMatchObject({ passwordHash: true, isActive: true });
    });
});

describe('checkStepUp: lockout after consecutive failures', () => {
    const args = (password: string, over: Record<string, unknown> = {}) => ({ tenantId: 't1', userId: 'u1', password, ...over });

    it('reports incorrect for a wrong password, ok for the right one', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        expect(await checkStepUp(prisma, args('nope'))).toEqual({ ok: false, reason: 'incorrect' });
        expect(await checkStepUp(prisma, args('correct horse'))).toEqual({ ok: true });
    });

    it(`locks after ${STEPUP_MAX_FAILURES} consecutive failures, even for the right password, without hashing`, async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        for (let i = 0; i < STEPUP_MAX_FAILURES; i++) await checkStepUp(prisma, args('nope'));
        prisma.user.findFirst.mockClear();
        const r: any = await checkStepUp(prisma, args('correct horse'));
        expect(r).toMatchObject({ ok: false, reason: 'locked' });
        expect(r.retryAfterSec).toBeGreaterThan(0);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('a success before the limit resets the count', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        for (let i = 0; i < STEPUP_MAX_FAILURES - 1; i++) await checkStepUp(prisma, args('nope'));
        expect((await checkStepUp(prisma, args('correct horse'))).ok).toBe(true);
        for (let i = 0; i < STEPUP_MAX_FAILURES - 1; i++) await checkStepUp(prisma, args('nope'));
        expect((await checkStepUp(prisma, args('correct horse'))).ok).toBe(true);
    });

    it('is per user: another owner is not locked out', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        for (let i = 0; i < STEPUP_MAX_FAILURES; i++) await checkStepUp(prisma, args('nope'));
        expect((await checkStepUp(prisma, args('correct horse', { userId: 'u2' }))).ok).toBe(true);
        expect((await checkStepUp(prisma, args('correct horse', { tenantId: 't2' }))).ok).toBe(true);
    });

    it('the lock ends after the lock period', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        const t0 = 5_000_000;
        for (let i = 0; i < STEPUP_MAX_FAILURES; i++) await checkStepUp(prisma, args('nope', { now: t0 }));
        expect((await checkStepUp(prisma, args('correct horse', { now: t0 + 1000 }))).ok).toBe(false);
        expect((await checkStepUp(prisma, args('correct horse', { now: t0 + STEPUP_LOCK_MS + 1 }))).ok).toBe(true);
    });

    it('a missing password is not an attempt and does not count', async () => {
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        for (let i = 0; i < STEPUP_MAX_FAILURES + 2; i++) await checkStepUp(prisma, args(''));
        expect((await checkStepUp(prisma, args('correct horse'))).ok).toBe(true);
    });

    it('uses Redis when given (counts are shared across instances)', async () => {
        const store = new Map<string, string>();
        const redis: any = {
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
            incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; }),
            expire: vi.fn(async () => 1),
            del: vi.fn(async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); return ks.length; }),
        };
        const prisma = prismaWith({ passwordHash: hash, isActive: true });
        for (let i = 0; i < STEPUP_MAX_FAILURES; i++) await checkStepUp(prisma, args('nope', { redis }));
        resetThrottleMemory(); // a different instance has no memory of it
        expect(await checkStepUp(prisma, args('correct horse', { redis }))).toMatchObject({ ok: false, reason: 'locked' });
        expect(redis.incr).toHaveBeenCalled();
    });
});
