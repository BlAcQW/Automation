import { beforeEach, describe, expect, it } from 'vitest';
import { claimOnce, clearFailures, getValue, isLocked, recordFailure, resetThrottleMemory, setValue } from './admin-throttle.js';

function fakeRedis() {
    const m = new Map<string, string>();
    return {
        m,
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string, ...a: any[]) => { if (a.includes('NX') && m.has(k)) return null; m.set(k, v); return 'OK'; },
        incr: async (k: string) => { const n = Number(m.get(k) ?? 0) + 1; m.set(k, String(n)); return n; },
        expire: async () => 1,
        del: async (...ks: string[]) => { ks.forEach((k) => m.delete(k)); return ks.length; },
    } as any;
}
const POLICY = { max: 3, lockMs: 60_000 };

beforeEach(() => resetThrottleMemory());

describe.each([['memory', () => null], ['redis', () => fakeRedis()]])('failure throttle (%s)', (_n, make) => {
    it('locks after max failures and clears on success', async () => {
        const r = make();
        for (let i = 0; i < 2; i++) await recordFailure(r, 'k', POLICY, 1000);
        expect(await isLocked(r, 'k', 1000)).toBe(false);
        await recordFailure(r, 'k', POLICY, 1000);
        expect(await isLocked(r, 'k', 1000)).toBe(true);
        await clearFailures(r, 'k');
        expect(await isLocked(r, 'k', 1000)).toBe(false);
    });
    it('keys are independent', async () => {
        const r = make();
        for (let i = 0; i < 3; i++) await recordFailure(r, 'a', POLICY, 1000);
        expect(await isLocked(r, 'b', 1000)).toBe(false);
    });
    it('claimOnce is true exactly once; values round-trip', async () => {
        const r = make();
        expect(await claimOnce(r, 'step:1', 120, 1000)).toBe(true);
        expect(await claimOnce(r, 'step:1', 120, 1000)).toBe(false);
        await setValue(r, 'v', '42', 120, 1000);
        expect(await getValue(r, 'v', 1000)).toBe('42');
    });
});

describe('memory specifics', () => {
    it('the lock expires', async () => {
        for (let i = 0; i < 3; i++) await recordFailure(null, 'k', POLICY, 1000);
        expect(await isLocked(null, 'k', 1000 + 59_000)).toBe(true);
        expect(await isLocked(null, 'k', 1000 + 60_001)).toBe(false);
    });
    it('failures outside the window do not accumulate', async () => {
        await recordFailure(null, 'k', POLICY, 1000);
        await recordFailure(null, 'k', POLICY, 1000);
        await recordFailure(null, 'k', POLICY, 1000 + 61_000);
        expect(await isLocked(null, 'k', 1000 + 61_000)).toBe(false);
    });
});

describe('redis falls back to memory when it errors', () => {
    it('still locks', async () => {
        const broken: any = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); }, incr: async () => { throw new Error('down'); }, expire: async () => 1, del: async () => 1 };
        for (let i = 0; i < 3; i++) await recordFailure(broken, 'k', POLICY, 1000);
        expect(await isLocked(broken, 'k', 1000)).toBe(true);
    });
});
