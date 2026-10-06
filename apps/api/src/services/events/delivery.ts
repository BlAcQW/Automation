/**
 * Outgoing webhook delivery. Mirrors services/inbound-queue.ts: the
 * WebhookDelivery row is the source of truth, BullMQ jobs only carry its id,
 * the claim is atomic, failures back off, a sweep recovers stranded rows, and
 * retention purges old ones in bounded batches. Delivery is at-least-once;
 * receivers dedupe on the X-Bookly-Delivery / event id.
 *
 * Status model (WebhookDelivery.status): PENDING -> SUCCEEDED | FAILED.
 * "In flight" is PENDING with claimedAt set. nextAttemptAt is the retry time.
 */
import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { raiseAlert } from '../alerts.js';
import { decrypt } from '../crypto.js';
import { makePostJson, type PostJson } from './http.js';
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signPayload } from './signing.js';

export const MAX_ATTEMPTS = 8;
/** Delay after attempt N (1-based) fails; holds at the last step. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000] as const;
export function backoffMs(attempts: number): number {
    return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}
/** A PENDING row with no schedule this old was never picked up. */
export const PENDING_STALE_MS = 30_000;
/** Claimed this long ago = presumed orphaned by a crash (> the 10s request timeout, with margin). */
export const CLAIM_STUCK_MS = 5 * 60_000;
export const SWEEP_EVERY_MS = 30_000;
/**
 * Fairness: at most this many deliveries of ONE tenant are in flight (claimed)
 * at once, across all workers and instances (it is counted in the database). A
 * tenant with a slow or dead endpoint can therefore hold at most this many of
 * the worker's slots (concurrency 10) instead of all of them.
 */
export const MAX_IN_FLIGHT_PER_TENANT = 3;
/** An over-cap delivery is retried after DEFER_MS plus up to DEFER_MS of jitter. */
export const DEFER_MS = 5_000;
const SWEEP_BATCH = 100;
const MAX_ERROR_LEN = 300;

/** Retention: delivery history is not needed beyond a month. */
export const RETENTION_MS = 30 * 86_400_000;
export const PURGE_EVERY_MS = 10 * 60_000;
export const PURGE_BATCH = 500;
export const PURGE_MAX_BATCHES = 20;

export const WEBHOOK_QUEUE_NAME = 'webhooks';
export const WEBHOOK_JOB_NAME = 'deliver';

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error' | 'debug'>;

export interface DeliveryDeps {
    prisma: any;
    log: Logger;
    /** Delayed retries are enqueued here; without it they run in-process. */
    queue?: Pick<Queue, 'add'> | null;
    /** Injectable for tests; defaults to the SSRF-guarded HTTPS client. */
    post?: PostJson;
}

let defaultPost: PostJson | null = null;
const getPost = (deps: DeliveryDeps): PostJson => deps.post ?? (defaultPost ??= makePostJson());

export type DeliveryOutcome = 'succeeded' | 'retry' | 'failed' | 'skipped' | 'deferred';

export function nextStateOnFailure(attempts: number, max: number = MAX_ATTEMPTS): 'PENDING' | 'FAILED' {
    return attempts >= max ? 'FAILED' : 'PENDING';
}

function alertFailed(prisma: any, d: { tenantId: string; subscriptionId: string; id: string }, attempts: number, lastError: string) {
    return raiseAlert(prisma, {
        kind: 'webhook.delivery_failed',
        severity: 'warning',
        tenantId: d.tenantId,
        message: `A webhook endpoint kept failing; delivery gave up after ${attempts} attempts`,
        context: { subscriptionId: d.subscriptionId, deliveryId: d.id, attempts, lastError: lastError.slice(0, 200) },
        dedupeKey: `webhook.delivery_failed:${d.subscriptionId}`,
    });
}

interface ClaimedDelivery {
    id: string;
    tenantId: string;
    subscriptionId: string;
    eventId: string;
    attempts: number;
}

export async function claimDelivery(prisma: any, id: string, now: Date = new Date()): Promise<ClaimedDelivery | null> {
    const claim = await prisma.webhookDelivery.updateMany({
        where: {
            id,
            status: 'PENDING',
            claimedAt: null,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        data: { claimedAt: now, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) return null;
    return (
        (await prisma.webhookDelivery.findUnique({
            where: { id },
            select: { id: true, tenantId: true, subscriptionId: true, eventId: true, attempts: true },
        })) ?? null
    );
}

/** Wire format: the body receivers verify against the signature. */
export function buildBody(event: { id: string; type: string; tenantId: string; createdAt: Date; payload: unknown }): string {
    return JSON.stringify({
        id: event.id,
        type: event.type,
        tenantId: event.tenantId,
        createdAt: new Date(event.createdAt).toISOString(),
        data: event.payload,
    });
}

async function redispatch(deps: DeliveryDeps, id: string, delayMs: number): Promise<void> {
    try {
        await dispatchDelivery({ ...deps, queue: deps.queue ?? null }, id, delayMs);
    } catch (err) {
        deps.log.warn({ err, deliveryId: id }, 'Could not schedule webhook retry; the sweep will pick it up');
    }
}

async function finish(deps: DeliveryDeps, d: ClaimedDelivery, data: Record<string, unknown>): Promise<boolean> {
    try {
        const res = await deps.prisma.webhookDelivery.updateMany({
            where: { id: d.id, tenantId: d.tenantId, status: 'PENDING', claimedAt: { not: null } },
            data,
        });
        return res.count === 1;
    } catch (err) {
        // Stays claimed; the stuck sweep recovers it.
        deps.log.error({ err, deliveryId: d.id }, 'Could not record webhook delivery result');
        return false;
    }
}

export async function processDelivery(deps: DeliveryDeps, id: string): Promise<DeliveryOutcome> {
    const { prisma, log } = deps;
    const d = await claimDelivery(prisma, id);
    if (!d) return 'skipped';

    // Claim first, then count (including this claim), so two workers racing for
    // the last slot cannot both exceed the cap; the loser hands its claim back.
    const inFlight: number = await prisma.webhookDelivery.count({
        where: {
            tenantId: d.tenantId,
            status: 'PENDING',
            claimedAt: { gt: new Date(Date.now() - CLAIM_STUCK_MS) }, // ignore orphaned claims
        },
    });
    if (inFlight > MAX_IN_FLIGHT_PER_TENANT) {
        const delay = DEFER_MS + Math.floor(Math.random() * DEFER_MS);
        const released = await prisma.webhookDelivery.updateMany({
            where: { id: d.id, tenantId: d.tenantId, status: 'PENDING', claimedAt: { not: null } },
            // Not an attempt: nothing was sent.
            data: { claimedAt: null, attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + delay) },
        });
        if (released.count === 1) {
            log.debug({ deliveryId: d.id, tenantId: d.tenantId, inFlight }, 'Webhook delivery deferred: tenant at its in-flight cap');
            await redispatch(deps, d.id, delay);
        }
        return 'deferred';
    }

    const sub = await prisma.webhookSubscription.findFirst({
        where: { id: d.subscriptionId, tenantId: d.tenantId },
        select: { url: true, secretEnc: true, isActive: true },
    });
    if (!sub || !sub.isActive) {
        await finish(deps, d, { status: 'FAILED', lastError: 'Subscription removed or disabled', claimedAt: null, nextAttemptAt: null });
        return 'failed';
    }
    const event = await prisma.domainEvent.findFirst({
        where: { id: d.eventId, tenantId: d.tenantId },
        select: { id: true, type: true, tenantId: true, createdAt: true, payload: true },
    });
    if (!event) {
        await finish(deps, d, { status: 'FAILED', lastError: 'Event missing', claimedAt: null, nextAttemptAt: null });
        return 'failed';
    }

    let statusCode: number | null = null;
    let error: string | null = null;
    try {
        const body = buildBody(event);
        const secret = decrypt(sub.secretEnc);
        const res = await getPost(deps)({
            url: sub.url,
            body,
            headers: {
                [SIGNATURE_HEADER]: signPayload(secret, body),
                [EVENT_HEADER]: event.type,
                [DELIVERY_HEADER]: d.id,
            },
        });
        statusCode = res.statusCode;
        if (res.statusCode < 200 || res.statusCode >= 300) error = `HTTP ${res.statusCode}`;
    } catch (err) {
        error = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, MAX_ERROR_LEN);
    }

    if (error === null) {
        await finish(deps, d, {
            status: 'SUCCEEDED',
            deliveredAt: new Date(),
            lastStatusCode: statusCode,
            lastError: null,
            claimedAt: null,
            nextAttemptAt: null,
        });
        return 'succeeded';
    }

    const state = nextStateOnFailure(d.attempts);
    const delay = backoffMs(d.attempts);
    await finish(deps, d, {
        status: state,
        lastStatusCode: statusCode,
        lastError: error,
        claimedAt: null,
        nextAttemptAt: state === 'PENDING' ? new Date(Date.now() + delay) : null,
    });
    if (state === 'FAILED') {
        log.error({ deliveryId: d.id, subscriptionId: d.subscriptionId, attempts: d.attempts }, 'Webhook delivery permanently failed');
        await alertFailed(prisma, d, d.attempts, error);
        return 'failed';
    }
    log.warn({ deliveryId: d.id, attempts: d.attempts, retryInMs: delay, error }, 'Webhook delivery failed, will retry');
    await redispatch(deps, d.id, delay);
    return 'retry';
}

/**
 * Hand a delivery to BullMQ, or run in-process with no queue. Retries get a
 * fresh jobId (BullMQ drops an add whose id exists); duplicates are harmless,
 * the claim is atomic.
 */
export async function dispatchDelivery(deps: DeliveryDeps, id: string, delayMs = 0): Promise<void> {
    if (deps.queue) {
        try {
            await deps.queue.add(WEBHOOK_JOB_NAME, { id }, {
                jobId: delayMs > 0 ? `${id}-d${Date.now()}` : id,
                ...(delayMs > 0 ? { delay: delayMs } : {}),
                removeOnComplete: true,
                removeOnFail: true,
            });
            return;
        } catch (err) {
            deps.log.warn({ err, deliveryId: id }, 'Webhook enqueue failed, delivering in-process');
        }
    }
    const run = () => {
        processDelivery(deps, id).catch((err) => deps.log.error({ err, deliveryId: id }, 'Webhook in-process run failed'));
    };
    if (delayMs > 0) setTimeout(run, delayMs).unref?.();
    else setImmediate(run);
}

export async function sweepDeliveries(
    deps: { prisma: any; log: Logger; dispatch: (id: string) => Promise<void> | void },
    now: Date = new Date(),
): Promise<{ requeued: number; recovered: number }> {
    const { prisma, log, dispatch } = deps;
    let recovered = 0;
    let requeued = 0;

    const stuck: Array<{ id: string; tenantId: string; subscriptionId: string; attempts: number }> =
        await prisma.webhookDelivery.findMany({
            where: { status: 'PENDING', claimedAt: { lt: new Date(now.getTime() - CLAIM_STUCK_MS) } },
            select: { id: true, tenantId: true, subscriptionId: true, attempts: true },
            take: SWEEP_BATCH,
        });
    for (const row of stuck) {
        const state = nextStateOnFailure(row.attempts);
        const res = await prisma.webhookDelivery.updateMany({
            where: { id: row.id, tenantId: row.tenantId, status: 'PENDING', claimedAt: { lt: new Date(now.getTime() - CLAIM_STUCK_MS) } },
            data: {
                status: state,
                lastError: 'Recovered after delivery stalled',
                claimedAt: null,
                nextAttemptAt: state === 'PENDING' ? now : null,
            },
        });
        if (res.count !== 1) continue;
        if (state === 'FAILED') {
            await alertFailed(prisma, row, row.attempts, 'Recovered after delivery stalled');
            continue;
        }
        recovered++;
    }

    const pending: Array<{ id: string }> = await prisma.webhookDelivery.findMany({
        where: {
            status: 'PENDING',
            claimedAt: null,
            OR: [
                { nextAttemptAt: { lte: now } },
                { nextAttemptAt: null, createdAt: { lt: new Date(now.getTime() - PENDING_STALE_MS) } },
            ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: SWEEP_BATCH,
    });
    for (const row of pending) {
        await dispatch(row.id);
        requeued++;
    }
    if (requeued || recovered) log.info({ requeued, recovered }, 'Webhook delivery sweep');
    return { requeued, recovered };
}

/**
 * Delete SUCCEEDED deliveries, then events, older than RETENTION_MS, a bounded
 * number of batches per call. An event with a still-PENDING delivery is kept;
 * deleting an old event cascades to its (FAILED) deliveries.
 */
export async function purgeEvents(
    deps: { prisma: any; log: Logger },
    now: Date = new Date(),
): Promise<{ deliveries: number; events: number }> {
    const { prisma, log } = deps;
    const cutoff = new Date(now.getTime() - RETENTION_MS);

    let deliveries = 0;
    for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
        const rows: Array<{ id: string }> = await prisma.webhookDelivery.findMany({
            where: { status: 'SUCCEEDED', createdAt: { lt: cutoff } },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: PURGE_BATCH,
        });
        if (rows.length === 0) break;
        const res = await prisma.webhookDelivery.deleteMany({
            where: { id: { in: rows.map((r) => r.id) }, status: 'SUCCEEDED' },
        });
        deliveries += res.count as number;
        if (rows.length < PURGE_BATCH) break;
    }

    let events = 0;
    for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
        const rows: Array<{ id: string }> = await prisma.domainEvent.findMany({
            where: { createdAt: { lt: cutoff }, deliveries: { none: { status: 'PENDING' } } },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
            take: PURGE_BATCH,
        });
        if (rows.length === 0) break;
        const res = await prisma.domainEvent.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        events += res.count as number;
        if (rows.length < PURGE_BATCH) break;
    }
    if (deliveries || events) log.info({ deliveries, events }, 'Webhook retention purge');
    return { deliveries, events };
}

/** Timer for index.ts. Returns a stop function. */
export function startDeliverySweeper(deps: DeliveryDeps): () => void {
    let lastPurge = 0;
    const timer = setInterval(() => {
        sweepDeliveries({ prisma: deps.prisma, log: deps.log, dispatch: (id) => dispatchDelivery(deps, id) })
            .catch((err) => deps.log.error({ err }, 'Webhook sweep failed'));
        if (Date.now() - lastPurge >= PURGE_EVERY_MS) {
            lastPurge = Date.now();
            purgeEvents({ prisma: deps.prisma, log: deps.log })
                .catch((err) => deps.log.error({ err }, 'Webhook purge failed'));
        }
    }, SWEEP_EVERY_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}
