import { describe, it, expect, vi } from 'vitest';
import { rememberOwned, ownedIds } from './chat-ownership.js';

/** In-memory conversation with the optimistic contextVersion lock the real column has. */
function fakePrisma(initial: { botContext: unknown; contextVersion: number } | null, opts: { failClaims?: number } = {}) {
    const row = initial ? { id: 'c1', tenantId: 't1', ...initial } : null;
    let failClaims = opts.failClaims ?? 0;
    const prisma: any = {
        conversation: {
            findFirst: vi.fn(async ({ where }: any) => (row && where.id === row.id && where.tenantId === row.tenantId ? { botContext: row.botContext, contextVersion: row.contextVersion } : null)),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (!row || where.id !== row.id || where.tenantId !== row.tenantId || where.contextVersion !== row.contextVersion) return { count: 0 };
                if (failClaims > 0) { failClaims -= 1; row.contextVersion += 1; return { count: 0 }; } // someone else won
                row.botContext = data.botContext;
                row.contextVersion += data.contextVersion.increment;
                return { count: 1 };
            }),
        },
    };
    return { prisma, row };
}

describe('chat ownership', () => {
    it('records ids per kind and keeps other botContext keys (the flow state)', async () => {
        const { prisma, row } = fakePrisma({ botContext: { flow: { step: 2 } }, contextVersion: 4 });
        await rememberOwned(prisma, 't1', 'c1', 'orders', 'o1');
        await rememberOwned(prisma, 't1', 'c1', 'bookings', 'b1');
        await rememberOwned(prisma, 't1', 'c1', 'orders', 'o2');
        expect((row!.botContext as any).flow).toEqual({ step: 2 });
        expect(await ownedIds(prisma, 't1', 'c1', 'orders')).toEqual(['o1', 'o2']);
        expect(await ownedIds(prisma, 't1', 'c1', 'bookings')).toEqual(['b1']);
        expect(row!.contextVersion).toBe(7);
    });

    it('does not duplicate an id and caps the list, keeping the newest', async () => {
        const { prisma } = fakePrisma({ botContext: null, contextVersion: 0 });
        for (let i = 0; i < 60; i += 1) await rememberOwned(prisma, 't1', 'c1', 'orders', `o${i}`);
        await rememberOwned(prisma, 't1', 'c1', 'orders', 'o59');
        const ids = await ownedIds(prisma, 't1', 'c1', 'orders');
        expect(ids).toHaveLength(50);
        expect(ids.at(-1)).toBe('o59');
        expect(ids[0]).toBe('o10');
    });

    it('retries when it loses the optimistic lock', async () => {
        const { prisma } = fakePrisma({ botContext: {}, contextVersion: 0 }, { failClaims: 2 });
        await rememberOwned(prisma, 't1', 'c1', 'orders', 'o1');
        expect(await ownedIds(prisma, 't1', 'c1', 'orders')).toEqual(['o1']);
    });

    it('never throws when it cannot record (the order exists; lookups just fail closed)', async () => {
        const { prisma } = fakePrisma({ botContext: {}, contextVersion: 0 }, { failClaims: 99 });
        await expect(rememberOwned(prisma, 't1', 'c1', 'orders', 'o1')).resolves.toBeUndefined();
        expect(await ownedIds(prisma, 't1', 'c1', 'orders')).toEqual([]);
    });

    it('is tenant scoped and tolerates a missing conversation or malformed context', async () => {
        const { prisma } = fakePrisma({ botContext: { chatOwned: { orders: 'oops', bookings: [1, 'b1'] } }, contextVersion: 0 });
        expect(await ownedIds(prisma, 'other', 'c1', 'orders')).toEqual([]);
        expect(await ownedIds(prisma, 't1', 'c1', 'orders')).toEqual([]);
        expect(await ownedIds(prisma, 't1', 'c1', 'bookings')).toEqual(['b1']);
        const none = fakePrisma(null);
        expect(await ownedIds(none.prisma, 't1', 'c1', 'orders')).toEqual([]);
        await expect(rememberOwned(none.prisma, 't1', 'c1', 'orders', 'o1')).resolves.toBeUndefined();
    });
});
