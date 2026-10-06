import { describe, it, expect, vi } from 'vitest';
import { claimOwnerEmail, EmailTakenError } from './email-claim.js';

function tx(existing: unknown = null) {
    return {
        $executeRaw: vi.fn(async () => 1),
        user: { findFirst: vi.fn(async () => existing) },
    } as any;
}

describe('claimOwnerEmail', () => {
    it('takes a transaction lock on the normalised address BEFORE checking, so double submits serialise', async () => {
        const t = tx();
        await claimOwnerEmail(t, '  Ama@Example.COM ');
        expect(t.$executeRaw).toHaveBeenCalledTimes(1);
        // lock first, then the check
        expect(t.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(t.user.findFirst.mock.invocationCallOrder[0]);
        const where = t.user.findFirst.mock.calls[0][0].where;
        expect(where.email).toEqual({ equals: 'ama@example.com', mode: 'insensitive' });
    });

    it('refuses an address that already owns an account (case-insensitive)', async () => {
        await expect(claimOwnerEmail(tx({ id: 'u1' }), 'ama@example.com')).rejects.toBeInstanceOf(EmailTakenError);
    });
});
