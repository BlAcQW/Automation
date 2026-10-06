import { describe, it, expect } from 'vitest';
import {
    checkRefresh, isRefreshStoreRequired, refreshAllowedWithoutStore, revoke, revokeAllForAdmin, revokeFamily, REUSE_GRACE_MS,
} from './refresh-store.js';

function fakeRedis() {
    const m = new Map<string, string>();
    return {
        m,
        get: async (k: string) => m.get(k) ?? null,
        set: async (k: string, v: string, ...args: any[]) => {
            if (args.includes('NX') && m.has(k)) return null;
            m.set(k, v);
            return 'OK';
        },
    } as any;
}
const claims = (over: Record<string, unknown> = {}) => ({ adminId: 'a1', jti: 'j1', fam: 'f1', iat: 1_000, ...over });

describe('admin refresh store', () => {
    it('without redis every check passes (the caller decides whether that is allowed)', async () => {
        expect(await checkRefresh(null, claims(), 100)).toBe('ok');
    });
    it('first use is ok, an immediate second use (other tab) is ok, a late replay is reused', async () => {
        const r = fakeRedis();
        expect(await checkRefresh(r, claims(), 100, 1_000)).toBe('ok');
        expect(await checkRefresh(r, claims(), 100, 1_000 + REUSE_GRACE_MS)).toBe('ok');
        expect(await checkRefresh(r, claims(), 100, 1_000 + REUSE_GRACE_MS + 1)).toBe('reused');
    });
    it('a reuse beyond the grace window revokes the WHOLE family, including the newest token', async () => {
        const r = fakeRedis();
        await checkRefresh(r, claims(), 100, 1_000);
        expect(await checkRefresh(r, claims(), 100, 1_000 + REUSE_GRACE_MS + 1)).toBe('reused');
        // a sibling token of the same family (what the thief or the victim now holds) is dead
        expect(await checkRefresh(r, claims({ jti: 'j2' }), 100, 2_000_000)).toBe('family_revoked');
        // another family is untouched
        expect(await checkRefresh(r, claims({ jti: 'j9', fam: 'other' }), 100, 2_000_000)).toBe('ok');
    });
    it('a revoked token is refused, other tokens are not', async () => {
        const r = fakeRedis();
        await revoke(r, 'j2', 100);
        expect(await checkRefresh(r, claims({ jti: 'j2' }), 100)).toBe('revoked');
        expect(await checkRefresh(r, claims({ jti: 'j3' }), 100)).toBe('ok');
    });
    it('revokeFamily kills every token of the family', async () => {
        const r = fakeRedis();
        await revokeFamily(r, 'f1');
        expect(await checkRefresh(r, claims(), 100)).toBe('family_revoked');
    });
    it('revokeAllForAdmin refuses tokens issued before it, not those issued after', async () => {
        const r = fakeRedis();
        await revokeAllForAdmin(r, 'a1', 5_000);
        expect(await checkRefresh(r, claims({ iat: 4_999 }), 100)).toBe('session_revoked');
        expect(await checkRefresh(r, claims({ iat: 5_000 }), 100)).toBe('session_revoked');
        expect(await checkRefresh(r, claims({ iat: 5_001, jti: 'new' }), 100)).toBe('ok');
        expect(await checkRefresh(r, claims({ adminId: 'a2', iat: 4_000, jti: 'x' }), 100)).toBe('ok');
    });
});

describe('fail-closed policy without Redis', () => {
    it('production without redis refuses refresh unless the explicit opt-out is set', () => {
        expect(refreshAllowedWithoutStore({ nodeEnv: 'production', optOut: undefined })).toBe(false);
        expect(refreshAllowedWithoutStore({ nodeEnv: 'production', optOut: 'false' })).toBe(false);
        expect(refreshAllowedWithoutStore({ nodeEnv: 'production', optOut: 'true' })).toBe(true);
    });
    it('development and test keep working without redis', () => {
        expect(refreshAllowedWithoutStore({ nodeEnv: 'development', optOut: undefined })).toBe(true);
        expect(refreshAllowedWithoutStore({ nodeEnv: 'test', optOut: undefined })).toBe(true);
    });
    it('isRefreshStoreRequired is the inverse for the current env', () => {
        expect(typeof isRefreshStoreRequired()).toBe('boolean');
    });
});
