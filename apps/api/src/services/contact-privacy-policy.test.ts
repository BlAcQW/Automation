import { describe, expect, it, vi } from 'vitest';
import { resolveMaskPolicy } from './contact-privacy-policy.js';

const prismaWith = (mask: boolean | null) => ({
    tenant: { findUnique: vi.fn(async () => (mask === null ? null : { maskCustomerContact: mask })) },
}) as any;

describe('resolveMaskPolicy', () => {
    it('an OWNER is never masked and costs no lookup', async () => {
        const prisma = prismaWith(true);
        expect(await resolveMaskPolicy(prisma, 't1', 'OWNER')).toBe(false);
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
    it('STAFF follow the tenant setting', async () => {
        expect(await resolveMaskPolicy(prismaWith(true), 't1', 'STAFF')).toBe(true);
        expect(await resolveMaskPolicy(prismaWith(false), 't1', 'STAFF')).toBe(false);
    });
    it('a support viewer is ALWAYS masked, whatever the tenant setting and whatever role the token carries', async () => {
        for (const role of ['STAFF', 'OWNER', undefined]) {
            expect(await resolveMaskPolicy(prismaWith(false), 't1', role, true)).toBe(true);
        }
    });
    it('a support viewer is masked without touching the database (nothing to fail open on)', async () => {
        const prisma = prismaWith(false);
        await resolveMaskPolicy(prisma, 't1', 'STAFF', true);
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
    it('fails closed when the tenant cannot be read, or is missing', async () => {
        const broken = { tenant: { findUnique: vi.fn(async () => { throw new Error('db'); }) } } as any;
        expect(await resolveMaskPolicy(broken, 't1', 'STAFF')).toBe(true);
        expect(await resolveMaskPolicy(prismaWith(null), 't1', 'STAFF')).toBe(true);
    });
    it('support=false behaves exactly like the old three-argument call', async () => {
        expect(await resolveMaskPolicy(prismaWith(false), 't1', 'STAFF', false)).toBe(false);
    });
});
