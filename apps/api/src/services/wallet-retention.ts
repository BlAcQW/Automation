/**
 * Keeping the books when a tenant goes away.
 *
 * `LedgerMovement` and `LedgerEntry` carry a `tenantId` but deliberately have
 * NO foreign key to `Tenant`: a financial record must be able to outlive the
 * row that describes who it belonged to, and a plain FK to Tenant would either
 * block deletion or (with cascade) erase history. That part is fine.
 *
 * The part that is not: `Wallet.tenant` is `onDelete: Cascade`, and ledger
 * entries and payout requests cascade from the Wallet. Deleting a tenant row
 * therefore deletes its wallet, its entries and its payouts, leaving orphaned
 * movements whose entries are gone. Nothing in the app deletes tenants today
 * (the admin deactivates them with `isActive: false`), and this is the rule that
 * keeps it that way without a schema change:
 *
 *   A tenant that has handled money is DEACTIVATED, never deleted.
 *
 * Any future delete path (a "right to erasure" job, an admin tool) must call
 * `tenantDeletionBlockers` first and refuse while it returns anything. Erasure
 * of personal data for such a tenant means anonymising the tenant and user
 * rows in place, which keeps every ledger row intact.
 */

import type { ExtendedPrismaClient } from '../plugins/prisma.js';

/** Reasons this tenant must not be deleted. Empty means it may be. */
export async function tenantDeletionBlockers(
    prisma: ExtendedPrismaClient,
    tenantId: string,
): Promise<string[]> {
    const blockers: string[] = [];

    const wallet = await prisma.wallet.findUnique({ where: { tenantId }, select: { id: true } });
    if (!wallet) return blockers;

    const entries = await prisma.ledgerEntry.count({ where: { tenantId } });
    if (entries > 0) {
        blockers.push(`The ledger has ${entries} entries; deleting the tenant would cascade them away. Deactivate instead.`);
    }

    const inFlight = await prisma.payoutRequest.count({
        where: { tenantId, status: { in: ['REQUESTED', 'PROCESSING'] } },
    });
    if (inFlight > 0) {
        blockers.push(`${inFlight} payout(s) are still in flight; money is on its way out.`);
    }
    return blockers;
}
