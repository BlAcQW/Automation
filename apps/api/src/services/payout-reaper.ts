/**
 * Find payouts whose webhook never arrived.
 *
 * A payout leaves REQUESTED / PROCESSING only when Paystack's transfer webhook
 * tells us how it ended. If that webhook is lost (our outage, a missed
 * delivery, a transfer Paystack never created) the money sits in PAYOUT_PENDING
 * indefinitely: not with the tenant, not sent, and nobody told.
 *
 * This sweep flags every payout that has been in flight too long. It does
 * NOT touch the payout or the ledger. Whether such a transfer was sent is
 * exactly what we do not know, and returning the funds on a guess would pay the
 * tenant twice (once to their MoMo, once back into their balance). The
 * decision belongs to a person comparing against Paystack, so the sweep
 * raises a critical alert and an audit row and leaves the rest alone. The alert
 * is the "needs reconciliation" marker: PayoutRequest has no column for one and
 * its `failureReason` is shown to the owner.
 *
 * Flagged once per payout (the alert's dedupe key is the payout id), so a stuck
 * payout does not re-open a resolved alert or inflate its count every tick.
 *
 * Wire next to the other sweepers in index.ts:
 *   stopPayoutReaper = startPayoutReaper(server.prisma, server.log);
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { raiseAlert } from './alerts.js';
import { audit } from './audit.js';

/** Paystack settles transfers in seconds to minutes; an hour with no word is not normal. */
export const PAYOUT_STALE_AFTER_MS = 60 * 60_000;
const SWEEP_EVERY_MS = 5 * 60_000;
const BATCH = 50;
/** Pages per sweep: far beyond any real backlog, but bounded. */
const MAX_PAGES = 40;

export async function reapStalePayouts(
    prisma: ExtendedPrismaClient,
    log?: FastifyBaseLogger,
    now: Date = new Date(),
): Promise<{ flagged: number }> {
    // Paged, not one batch: flagged payouts stay in flight until a person
    // resolves them, so a single "oldest 50" page could fill up with
    // already-flagged rows and hide every newer stuck payout behind them.
    const stale: Array<{
        id: string; tenantId: string; status: string; amountMinor: number; currency: string;
        providerRef: string | null; createdAt: Date;
    }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const rows = await prisma.payoutRequest.findMany({
            where: {
                status: { in: ['REQUESTED', 'PROCESSING'] },
                updatedAt: { lt: new Date(now.getTime() - PAYOUT_STALE_AFTER_MS) },
            },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: BATCH,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true, tenantId: true, status: true, amountMinor: true, currency: true,
                providerRef: true, createdAt: true,
            },
        });
        stale.push(...rows);
        if (rows.length < BATCH) break;
        cursor = rows[rows.length - 1].id;
    }

    let flagged = 0;
    for (const p of stale) {
        const dedupeKey = `payout.stale:${p.id}`;
        const already = await prisma.platformAlert.findUnique({ where: { dedupeKey }, select: { id: true } });
        if (already) continue;

        const ageMinutes = Math.round((now.getTime() - p.createdAt.getTime()) / 60_000);
        log?.error({ payoutId: p.id, tenantId: p.tenantId, status: p.status, ageMinutes }, 'Payout in flight with no webhook — needs reconciliation');
        await raiseAlert(prisma, {
            kind: 'payout.stale',
            severity: 'critical',
            tenantId: p.tenantId,
            message: `A payout of ${p.currency} ${(p.amountMinor / 100).toFixed(2)} has been ${p.status} for ${ageMinutes} minutes with no word from Paystack. Check the transfer with Paystack before doing anything: it may have been sent. It was not changed.`,
            context: {
                payoutId: p.id, status: p.status, providerRef: p.providerRef,
                amountMinor: p.amountMinor, currency: p.currency, ageMinutes,
            },
            dedupeKey,
        });
        await audit({
            prisma,
            action: 'payout.needs_reconciliation',
            actorType: 'SYSTEM',
            tenantId: p.tenantId,
            targetType: 'PayoutRequest',
            targetId: p.id,
            metadata: { status: p.status, providerRef: p.providerRef, ageMinutes },
        });
        flagged += 1;
    }
    return { flagged };
}

export function startPayoutReaper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    const timer = setInterval(() => {
        reapStalePayouts(prisma, log).catch((err) => log.error({ err }, 'Payout reaper sweep failed'));
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
