/**
 * Payaza reconciler (background task 'payaza-reconcile', every minute), and
 * the ride sweeper's "ask Payaza before cancelling" guard.
 *
 * WHY. Payaza does not reliably call our webhook: in TURBO's first LIVE sale
 * (2026-10-15) the customer paid, Payaza recorded it Completed, and no
 * notification ever arrived. The hold lapsed, the sweeper cancelled it, and the
 * customer was told the purchase failed. So, for every tenant on Payaza with
 * connected keys, we ask Payaza ourselves about each reference still waiting:
 *
 *   - RidePass HELD with a payment reference (a Founding hold being paid);
 *   - Ride PENDING_PAYMENT with a payment reference (PAYG seat or top-up);
 *   - the late window: a pass / ride CANCELLED by the hold / payment timeout,
 *     unpaid, cancelled less than LATE_WINDOW_MS ago (paid just after the
 *     timeout, or Payaza was down when the sweeper asked).
 *
 * A Completed answer goes through confirmPayazaReference, the webhook's own
 * path, so the fulfiller (idempotent per reference) applies it once: a webhook
 * racing the reconciler (or the sweeper guard) is safe. Initialized / Failed:
 * nothing. Errors: warn and carry on with the next reference.
 *
 * LIMITS (per process, in memory). At most MAX_PER_TENANT_PER_TICK queries per
 * tenant per tick; a reference is not asked again within REQUERY_AFTER_MS; a
 * reference whose payment was applied or refused is not asked again for
 * SETTLED_FOR_MS (so a refused payment does not page staff every minute).
 *
 * MULTI-PROCESS SAFE: it only reads, and writes through the fulfillers, which
 * claim atomically per reference. Two processes cost at most twice the queries.
 *
 * KNOWN GAP: a hold re-used for a second link keeps only the newest reference;
 * a payment on the older link still needs its webhook (or a person).
 */
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import type { FulfillerLogger } from './payment-fulfillers.js';
import { parseFulfillmentReference } from './payment-fulfillers.js';
import {
    confirmPayazaReference, queryPayazaReference, PayazaQueryFailed,
    type PayazaConfirmSource, type PayazaTenantKeys,
} from './payaza-confirm.js';

export const RECONCILE_EVERY_MS = 60_000;
export const MAX_PER_TENANT_PER_TICK = 25;
export const REQUERY_AFTER_MS = 60_000;
export const SETTLED_FOR_MS = 3 * 60 * 60 * 1000;
export const LATE_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_TENANTS_PER_TICK = 200;
const MAX_TRACKED = 5000;

// ---------------------------------------------------------------- throttle

export interface PayazaThrottle {
    /** True when the reference may be asked about now. */
    due(reference: string, now: number): boolean;
    queried(reference: string, now: number): void;
    settled(reference: string, now: number): void;
}

export function createPayazaThrottle(): PayazaThrottle {
    const until = new Map<string, number>();
    const prune = (now: number) => {
        if (until.size < MAX_TRACKED) return;
        for (const [ref, t] of until) if (t <= now) until.delete(ref);
        // Still full of live entries: drop the oldest inserted.
        while (until.size >= MAX_TRACKED) until.delete(until.keys().next().value as string);
    };
    const set = (reference: string, t: number, now: number) => {
        prune(now);
        until.delete(reference); // re-insert at the end (insertion order = age)
        until.set(reference, t);
    };
    return {
        due: (reference, now) => (until.get(reference) ?? 0) <= now,
        queried: (reference, now) => set(reference, now + REQUERY_AFTER_MS, now),
        settled: (reference, now) => set(reference, now + SETTLED_FOR_MS, now),
    };
}

/** One per process: the reconciler and the sweeper guard share it. */
export const sharedPayazaThrottle: PayazaThrottle = createPayazaThrottle();

// ---------------------------------------------------------------- one reference

export type ReferenceOutcome = 'confirmed' | 'already' | 'refused' | 'not_paid' | 'error' | 'not_ours';

export interface CheckDeps {
    prisma: ExtendedPrismaClient;
    log: FulfillerLogger;
    throttle?: PayazaThrottle;
    now?: () => number;
}

/**
 * Ask Payaza about one reference and apply it when it is paid. Never throws.
 * 'confirmed' = this call applied it; 'already' = it was applied before (a
 * webhook won the race); 'refused' = money arrived but was not honoured (the
 * fulfiller alerted); 'not_paid' = Initialized / Failed; 'error' = Payaza or
 * the database failed (logged at warn; try again later).
 */
export async function checkPayazaReference(
    deps: CheckDeps,
    tenant: PayazaTenantKeys,
    reference: string,
    source: PayazaConfirmSource,
): Promise<ReferenceOutcome> {
    const throttle = deps.throttle ?? sharedPayazaThrottle;
    const now = (deps.now ?? Date.now)();
    throttle.queried(reference, now);
    try {
        const verified = await queryPayazaReference(tenant, reference);
        if (verified.status !== 'success') return 'not_paid';
        const res = await confirmPayazaReference(deps, { tenant, reference, source, prefetched: verified });
        if (res.outcome !== 'dispatched') return 'not_ours';
        throttle.settled(reference, now);
        if (res.body.ok === true) return res.body.idempotent === true ? 'already' : 'confirmed';
        return 'refused';
    } catch (err) {
        const cause = err instanceof PayazaQueryFailed ? err.cause : err;
        deps.log.warn({ err: cause, tenantId: tenant.id, reference: reference.slice(0, 100), source }, 'Payaza reconciliation of one reference failed');
        return 'error';
    }
}

// ---------------------------------------------------------------- who is waiting

const TENANT_SELECT = { id: true, payazaPublicKey: true, payazaMode: true } as const;

/** Tenants on Payaza with both keys stored (the secret is what makes the link valid in the first place). */
export async function payazaTenants(prisma: ExtendedPrismaClient): Promise<PayazaTenantKeys[]> {
    return (prisma as any).tenant.findMany({
        where: { paymentProvider: 'PAYAZA', payazaPublicKey: { not: null }, payazaSecretKey: { not: null } },
        select: TENANT_SELECT,
        orderBy: { id: 'asc' },
        take: MAX_TENANTS_PER_TICK,
    });
}

/** Payaza keys of one tenant when it is on Payaza and connected, else null. */
export async function payazaTenant(prisma: ExtendedPrismaClient, tenantId: string): Promise<PayazaTenantKeys | null> {
    return (prisma as any).tenant.findFirst({
        where: { id: tenantId, paymentProvider: 'PAYAZA', payazaPublicKey: { not: null }, payazaSecretKey: { not: null } },
        select: TENANT_SELECT,
    });
}

/**
 * Bookly-issued references of `tenantId` still awaiting payment (newest first,
 * passes then rides), including the late window. Only references that parse as
 * ours are returned.
 */
export async function awaitingReferences(prisma: ExtendedPrismaClient, tenantId: string, now: Date, take = 100): Promise<string[]> {
    const lateSince = new Date(now.getTime() - LATE_WINDOW_MS);
    const db = prisma as any;
    const [passes, rides] = await Promise.all([
        db.ridePass.findMany({
            where: {
                tenantId, paidAt: null, paymentReference: { not: null },
                OR: [{ status: 'HELD' }, { status: 'CANCELLED', cancelReason: 'hold_expired', cancelledAt: { gte: lateSince } }],
            },
            select: { paymentReference: true },
            orderBy: { createdAt: 'desc' },
            take,
        }),
        db.ride.findMany({
            where: {
                tenantId, paidAt: null, paymentReference: { not: null },
                OR: [{ status: 'PENDING_PAYMENT' }, { status: 'CANCELLED', cancelReason: 'payment_timeout', cancelledAt: { gte: lateSince } }],
            },
            select: { paymentReference: true },
            orderBy: { createdAt: 'desc' },
            take,
        }),
    ]);
    const refs = [...passes, ...rides].map((r: { paymentReference: string | null }) => r.paymentReference as string);
    return [...new Set(refs)].filter((ref) => parseFulfillmentReference(ref) !== null);
}

// ---------------------------------------------------------------- the tick

export interface ReconcileResult {
    tenants: number;
    queried: number;
    confirmed: number;
    refused: number;
    errors: number;
}

export async function reconcilePayaza(deps: CheckDeps, at = new Date()): Promise<ReconcileResult> {
    const throttle = deps.throttle ?? sharedPayazaThrottle;
    const out: ReconcileResult = { tenants: 0, queried: 0, confirmed: 0, refused: 0, errors: 0 };
    const tenants = await payazaTenants(deps.prisma);
    for (const tenant of tenants) {
        out.tenants++;
        let refs: string[];
        try {
            refs = await awaitingReferences(deps.prisma, tenant.id, at);
        } catch (err) {
            deps.log.warn({ err, tenantId: tenant.id }, 'Payaza reconciliation could not list pending payments');
            out.errors++;
            continue;
        }
        const due = refs.filter((ref) => throttle.due(ref, at.getTime())).slice(0, MAX_PER_TENANT_PER_TICK);
        for (const ref of due) {
            out.queried++;
            const outcome = await checkPayazaReference({ ...deps, throttle, now: () => at.getTime() }, tenant, ref, 'reconcile');
            if (outcome === 'confirmed') out.confirmed++;
            else if (outcome === 'refused') out.refused++;
            else if (outcome === 'error') out.errors++;
        }
    }
    if (out.confirmed + out.refused + out.errors > 0) deps.log.info({ ...out }, 'Payaza reconciliation');
    return out;
}

export function startPayazaReconciler(prisma: ExtendedPrismaClient, log: FulfillerLogger): () => void {
    let running = false;
    const timer = setInterval(() => {
        if (running) return;
        running = true;
        reconcilePayaza({ prisma, log })
            .catch((err) => log.error({ err }, 'Payaza reconciliation failed'))
            .finally(() => { running = false; });
    }, RECONCILE_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}

// ---------------------------------------------------------------- sweeper guard

export interface ExpiryCandidate {
    tenantId: string;
    paymentReference: string | null;
}

/**
 * For the ride sweeper: before it cancels these expired holds / unpaid rides,
 * ask Payaza once about each one of a PAYAZA tenant that has a reference, and
 * confirm the paid ones (which then no longer match the sweeper's cancel).
 * Paystack tenants, rows without a reference and anything over the per-tenant
 * limit are left to the sweeper as before. Never throws: if Payaza is down the
 * sweeper cancels as today and the reconciler's late window recovers it.
 */
export function createPayazaExpiryGuard(deps: Omit<CheckDeps, 'now'>) {
    return async (rows: ExpiryCandidate[]): Promise<number> => {
        let confirmed = 0;
        const byTenant = new Map<string, string[]>();
        for (const r of rows) {
            if (!r.paymentReference || !parseFulfillmentReference(r.paymentReference)) continue;
            byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r.paymentReference]);
        }
        for (const [tenantId, refs] of byTenant) {
            let tenant: PayazaTenantKeys | null;
            try {
                tenant = await payazaTenant(deps.prisma, tenantId);
            } catch (err) {
                deps.log.warn({ err, tenantId }, 'Payaza expiry guard could not load the tenant');
                continue;
            }
            if (!tenant) continue;
            for (const ref of [...new Set(refs)].slice(0, MAX_PER_TENANT_PER_TICK)) {
                if ((await checkPayazaReference(deps, tenant, ref, 'sweeper')) === 'confirmed') confirmed++;
            }
        }
        return confirmed;
    };
}
