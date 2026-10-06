/**
 * One email, one account.
 *
 * Login resolves a user by email alone, so an address must own at most one
 * account across ALL tenants. The only database constraint is
 * @@unique([tenantId, email]), which a brand-new tenant can never violate —
 * so a find-then-create check alone lets a double-submitted form (or two
 * people racing) create several organisations for one address (proven on a
 * real database).
 *
 * Call this INSIDE the transaction that creates the user: it takes a
 * transaction-scoped advisory lock on the normalised address, then checks.
 * A second transaction for the same address waits for the first to commit
 * and then sees its row.
 */

export class EmailTakenError extends Error {
    constructor() {
        super('An account with this email already exists.');
        this.name = 'EmailTakenError';
    }
}

export function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
}

export async function claimOwnerEmail(tx: any, email: string): Promise<void> {
    const normalised = normaliseEmail(email);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'owner-email:' + normalised}, 0))`;
    const taken = await tx.user.findFirst({
        where: { email: { equals: normalised, mode: 'insensitive' } },
        select: { id: true },
    });
    if (taken) throw new EmailTakenError();
}
