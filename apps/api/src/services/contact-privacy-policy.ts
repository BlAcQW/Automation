/**
 * Resolving the masking policy for a request.
 *
 * Split from [contact-privacy.ts] so the masking functions stay pure and
 * trivially testable while the database lookup lives here.
 *
 * The owner short-circuits without touching the database — they are never
 * masked, so there is nothing to look up. Only staff requests pay for the read,
 * and that read is a primary-key hit.
 *
 * A platform-admin SUPPORT viewer is the opposite short-circuit: always masked,
 * regardless of the tenant's setting or the role on the token, with no lookup.
 * (The tenant's "show contacts to staff" choice is theirs to make for their own
 * staff; it never extends to Bookly support.) Every call site passes the flag.
 */

import type { PrismaClient } from '@prisma/client';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { shouldMaskContacts } from './contact-privacy.js';

export type AnyPrismaClient = PrismaClient | ExtendedPrismaClient;

/**
 * Whether this viewer's responses must have customer contacts masked.
 *
 * Fails closed in every uncertain case: if the tenant row cannot be read we
 * mask rather than expose, because the alternative is leaking the customer
 * book on a transient database error.
 */
export async function resolveMaskPolicy(
    prisma: AnyPrismaClient,
    tenantId: string,
    role: string | undefined,
    /** `!!request.user.support`: true for a platform-admin support token. */
    support: boolean = false,
): Promise<boolean> {
    if (support) return true;
    if (role === 'OWNER') return false;

    try {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { maskCustomerContact: true },
        });
        return shouldMaskContacts(role, tenant?.maskCustomerContact ?? true);
    } catch {
        return true;
    }
}
