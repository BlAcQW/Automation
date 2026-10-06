import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    API_KEY_SCOPES,
    MAX_ACTIVE_KEYS_PER_TENANT,
    LAST_USED_THROTTLE_MS,
    ApiKeyError,
    generateApiKey,
    parseApiKey,
    hashSecret,
    verifySecret,
    createApiKey,
    listApiKeys,
    revokeApiKey,
    verifyApiKey,
    touchLastUsed,
    hasScopes,
} from './api-keys.js';

function stubPrisma() {
    return {
        apiKey: {
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn(async ({ data }: any) => ({ id: 'k1', createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data })),
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        tenant: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
    } as any;
}

describe('generateApiKey', () => {
    it('produces bk_live_<10 char prefix>_<base62 secret of 32+ bytes>', () => {
        const { key, prefix, secret } = generateApiKey();
        expect(key).toBe(`bk_live_${prefix}_${secret}`);
        expect(prefix).toMatch(/^[A-Za-z0-9]{10}$/);
        // 32 bytes of entropy needs at least 43 base62 characters.
        expect(secret).toMatch(/^[A-Za-z0-9]{43,}$/);
    });

    it('is random per call', () => {
        const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));
        expect(keys.size).toBe(50);
    });
});

describe('parseApiKey', () => {
    it('parses a generated key', () => {
        const { key, prefix, secret } = generateApiKey();
        expect(parseApiKey(key)).toEqual({ prefix, secret });
    });

    it.each([
        ['empty', ''],
        ['undefined', undefined],
        ['null', null],
        ['number', 42],
        ['wrong scheme', 'bk_test_abcdefghij_' + 'a'.repeat(43)],
        ['short prefix', 'bk_live_abc_' + 'a'.repeat(43)],
        ['short secret', 'bk_live_abcdefghij_' + 'a'.repeat(10)],
        ['bad chars in secret', 'bk_live_abcdefghij_' + 'a'.repeat(42) + '!'],
        ['extra segment', 'bk_live_abcdefghij_' + 'a'.repeat(43) + '_x'],
        ['sql chars', "bk_live_abcdefghij_'; DROP TABLE x;--"],
        ['unicode', 'bk_live_abcdefghij_' + 'é'.repeat(43)],
    ])('rejects %s', (_n, raw) => {
        expect(parseApiKey(raw as any)).toBeNull();
    });

    it('rejects an absurdly long input without matching', () => {
        expect(parseApiKey('bk_live_abcdefghij_' + 'a'.repeat(5000))).toBeNull();
    });
});

describe('hashSecret / verifySecret', () => {
    it('hashes to 64 hex chars, deterministic, never the secret itself', () => {
        const h = hashSecret('s3cret');
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(h).toBe(hashSecret('s3cret'));
        expect(h).not.toContain('s3cret');
    });

    it('verifies the right secret and rejects a wrong one', () => {
        const h = hashSecret('right');
        expect(verifySecret('right', h)).toBe(true);
        expect(verifySecret('wrong', h)).toBe(false);
    });

    it('rejects malformed stored hashes instead of throwing', () => {
        expect(verifySecret('x', 'short')).toBe(false);
        expect(verifySecret('x', 'z'.repeat(64))).toBe(false);
        expect(verifySecret('x', '')).toBe(false);
    });
});

describe('hasScopes', () => {
    it('requires every scope', () => {
        expect(hasScopes(['messages:write', 'customers:read'], ['messages:write'])).toBe(true);
        expect(hasScopes(['messages:write'], ['messages:write', 'customers:read'])).toBe(false);
        expect(hasScopes([], [])).toBe(true);
        expect(hasScopes([], ['messages:write'])).toBe(false);
    });
});

describe('createApiKey', () => {
    let prisma: ReturnType<typeof stubPrisma>;
    beforeEach(() => { prisma = stubPrisma(); });

    it('stores only prefix + sha256(secret) and returns the full key once', async () => {
        const { key, apiKey } = await createApiKey(prisma, {
            tenantId: 't1', name: '  TURBO app  ', scopes: ['messages:write', 'messages:write', 'customers:read'], createdBy: 'u1',
        });
        const parsed = parseApiKey(key)!;
        const data = prisma.apiKey.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
            tenantId: 't1', name: 'TURBO app', prefix: parsed.prefix, secretHash: hashSecret(parsed.secret),
            scopes: ['messages:write', 'customers:read'], createdBy: 'u1',
        });
        expect(JSON.stringify(data)).not.toContain(parsed.secret);
        // The returned record never carries the hash.
        expect(apiKey).not.toHaveProperty('secretHash');
        expect(apiKey.prefix).toBe(parsed.prefix);
    });

    it('rejects empty and unknown scopes', async () => {
        await expect(createApiKey(prisma, { tenantId: 't1', name: 'x', scopes: [] })).rejects.toMatchObject({ code: 'invalid_scopes' });
        await expect(createApiKey(prisma, { tenantId: 't1', name: 'x', scopes: ['admin:all' as any] })).rejects.toMatchObject({ code: 'invalid_scopes' });
        expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });

    it('rejects blank and over-long names', async () => {
        await expect(createApiKey(prisma, { tenantId: 't1', name: '   ', scopes: ['messages:write'] })).rejects.toMatchObject({ code: 'invalid_name' });
        await expect(createApiKey(prisma, { tenantId: 't1', name: 'x'.repeat(61), scopes: ['messages:write'] })).rejects.toMatchObject({ code: 'invalid_name' });
    });

    it('enforces the per-tenant active key limit (revoked keys do not count)', async () => {
        prisma.apiKey.count.mockResolvedValue(MAX_ACTIVE_KEYS_PER_TENANT);
        await expect(createApiKey(prisma, { tenantId: 't1', name: 'x', scopes: ['messages:write'] })).rejects.toBeInstanceOf(ApiKeyError);
        expect(prisma.apiKey.count).toHaveBeenCalledWith({ where: { tenantId: 't1', revokedAt: null } });
        expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });

    it('retries with a fresh key when the prefix collides', async () => {
        prisma.apiKey.create
            .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
            .mockImplementationOnce(async ({ data }: any) => ({ id: 'k2', createdAt: new Date(), ...data }));
        const { apiKey } = await createApiKey(prisma, { tenantId: 't1', name: 'x', scopes: ['messages:write'] });
        expect(apiKey.id).toBe('k2');
        expect(prisma.apiKey.create).toHaveBeenCalledTimes(2);
    });

    it('does not swallow other database errors', async () => {
        prisma.apiKey.create.mockRejectedValue(new Error('db down'));
        await expect(createApiKey(prisma, { tenantId: 't1', name: 'x', scopes: ['messages:write'] })).rejects.toThrow('db down');
    });

    it('knows every documented scope', () => {
        expect([...API_KEY_SCOPES].sort()).toEqual([
            'conversations:read', 'conversations:write', 'customers:read', 'customers:write',
            'messages:write', 'payments:write',
        ]);
        expect(API_KEY_SCOPES).not.toContain('events:read' as never); // a scope no route checks is a trap
    });
});

describe('listApiKeys', () => {
    it('is tenant scoped and never selects the hash', async () => {
        const prisma = stubPrisma();
        await listApiKeys(prisma, 't1');
        const args = prisma.apiKey.findMany.mock.calls[0][0];
        expect(args.where).toEqual({ tenantId: 't1' });
        expect(args.select.secretHash).toBeUndefined();
        expect(args.select).toMatchObject({ prefix: true, scopes: true, lastUsedAt: true, revokedAt: true });
    });
});

describe('revokeApiKey', () => {
    it('revokes an active key, scoped by tenant', async () => {
        const prisma = stubPrisma();
        expect(await revokeApiKey(prisma, 't1', 'k1')).toBe('revoked');
        const args = prisma.apiKey.updateMany.mock.calls[0][0];
        expect(args.where).toEqual({ id: 'k1', tenantId: 't1', revokedAt: null });
        expect(args.data.revokedAt).toBeInstanceOf(Date);
    });

    it('is idempotent for an already revoked key', async () => {
        const prisma = stubPrisma();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
        prisma.apiKey.findFirst.mockResolvedValue({ id: 'k1' });
        expect(await revokeApiKey(prisma, 't1', 'k1')).toBe('already_revoked');
        expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({ where: { id: 'k1', tenantId: 't1' }, select: { id: true } });
    });

    it('reports not_found for another tenant\'s key', async () => {
        const prisma = stubPrisma();
        prisma.apiKey.updateMany.mockResolvedValue({ count: 0 });
        expect(await revokeApiKey(prisma, 't2', 'k1')).toBe('not_found');
    });
});

describe('verifyApiKey', () => {
    function rowFor(key: string, over: Record<string, unknown> = {}) {
        const { prefix, secret } = parseApiKey(key)!;
        return { id: 'k1', tenantId: 't1', name: 'app', prefix, secretHash: hashSecret(secret), scopes: ['messages:write'], lastUsedAt: null, revokedAt: null, ...over };
    }

    it('accepts a valid key and returns identity without the hash', async () => {
        const prisma = stubPrisma();
        const { key, prefix } = generateApiKey();
        prisma.apiKey.findUnique.mockResolvedValue(rowFor(key));
        const out = await verifyApiKey(prisma, key);
        expect(out).toEqual({ id: 'k1', tenantId: 't1', prefix, scopes: ['messages:write'], name: 'app', lastUsedAt: null });
        expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({ where: { prefix } });
    });

    it('rejects a wrong secret on a real prefix', async () => {
        const prisma = stubPrisma();
        const { key } = generateApiKey();
        prisma.apiKey.findUnique.mockResolvedValue(rowFor(generateApiKey().key, { prefix: parseApiKey(key)!.prefix }));
        expect(await verifyApiKey(prisma, key)).toBeNull();
    });

    it('rejects an unknown prefix, a revoked key and an inactive tenant the same way (null)', async () => {
        const prisma = stubPrisma();
        const { key } = generateApiKey();
        expect(await verifyApiKey(prisma, key)).toBeNull();

        prisma.apiKey.findUnique.mockResolvedValue(rowFor(key, { revokedAt: new Date() }));
        expect(await verifyApiKey(prisma, key)).toBeNull();

        prisma.apiKey.findUnique.mockResolvedValue(rowFor(key));
        prisma.tenant.findUnique.mockResolvedValue({ isActive: false });
        expect(await verifyApiKey(prisma, key)).toBeNull();
    });

    it('does not touch the database for malformed input', async () => {
        const prisma = stubPrisma();
        expect(await verifyApiKey(prisma, 'garbage')).toBeNull();
        expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });
});

describe('touchLastUsed', () => {
    const base = { id: 'k1', tenantId: 't1', prefix: 'p', scopes: [] as any, name: 'n' };
    const now = new Date('2026-01-01T12:00:00Z');

    it('writes when never used, scoped by tenant, with a DB-level throttle condition', async () => {
        const prisma = stubPrisma();
        await touchLastUsed(prisma, { ...base, lastUsedAt: null }, now);
        const args = prisma.apiKey.updateMany.mock.calls[0][0];
        expect(args.where).toMatchObject({ id: 'k1', tenantId: 't1' });
        expect(args.where.OR).toEqual([{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }]);
        expect(args.data).toEqual({ lastUsedAt: now });
    });

    it('does not write when used within the throttle window', async () => {
        const prisma = stubPrisma();
        await touchLastUsed(prisma, { ...base, lastUsedAt: new Date(now.getTime() - 1000) }, now);
        expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
    });

    it('writes again once the window passed', async () => {
        const prisma = stubPrisma();
        await touchLastUsed(prisma, { ...base, lastUsedAt: new Date(now.getTime() - LAST_USED_THROTTLE_MS - 1) }, now);
        expect(prisma.apiKey.updateMany).toHaveBeenCalledTimes(1);
    });
});
