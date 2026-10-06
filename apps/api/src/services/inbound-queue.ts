/**
 * Durable inbound-webhook inbox.
 *
 * The webhook route persists the verified payload as a WebhookInbox row BEFORE
 * acknowledging Meta, so a crash or deploy between ack and processing cannot
 * lose a message. Processing then claims the row atomically, runs the handler,
 * and records DONE, or returns the row to PENDING (retry) until MAX_ATTEMPTS.
 * A periodic sweep re-dispatches rows nobody picked up and recovers rows left
 * PROCESSING by a crashed process.
 *
 * Delivery is at-least-once; handlers must be idempotent (the message handlers
 * dedupe on conversationId + whatsappMsgId).
 *
 * ORDERING CAVEAT: a message whose processing is retried (failure backoff, or a
 * busy conversation lock) can be answered AFTER a newer message from the same
 * conversation that was processed first. Retries are per row, not per
 * conversation, so there is no cross-message ordering guarantee. The agent
 * reads the full history on every turn, so a late reply is still coherent, but
 * the customer may see replies out of order.
 */

import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { raiseAlert } from './alerts.js';
import { LockTimeoutError } from './conversation-lock.js';

/** A customer message we gave up on must reach a person, not only the log. */
function alertPermanentFailure(prisma: any, inboxId: string, attempts: number, lastError: string): Promise<void> {
    return raiseAlert(prisma, {
        kind: 'inbound.failed',
        severity: 'critical',
        message: `An incoming message could not be processed after ${attempts} attempts`,
        context: { inboxId, attempts, lastError: lastError.slice(0, 300) },
        dedupeKey: `inbound.failed:${inboxId}`,
    });
}

/**
 * Retry budget. Failures back off (BACKOFF_MS, then hold at the last step), so 7
 * attempts reach ~2h40m past the first failure: a ~1h provider/DB outage
 * recovers instead of permanently failing every message that arrived in it.
 * Lock contention does NOT consume an attempt (see 'busy').
 */
export const MAX_ATTEMPTS = 7;
export const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000] as const;
/** Delay after attempt N (1-based) fails; holds at the last step. */
export function backoffMs(attempts: number): number {
    return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}
/**
 * Delay before a row whose conversation lock was busy is re-run. Fixed (no
 * jitter) so rows that gave up in arrival order come back in arrival order.
 */
export const BUSY_RETRY_MS = 3_000;
/**
 * A row still 'busy' this long after it arrived means the conversation lock
 * holder is probably hung; retrying alone would loop silently, so raise a
 * warning (the retry continues).
 */
export const STUCK_BUSY_MS = 15 * 60_000;
/** A PENDING row with no schedule this old was never picked up (lost job / no Redis). */
export const PENDING_STALE_MS = 60_000;
/**
 * A PROCESSING row claimed this long ago is presumed orphaned by a crash.
 * Measured from claimedAt (not receivedAt) so a row that waited in the queue
 * is not mistaken for a stalled one. Re-running a still-live row is safe:
 * the conversation lock + Message.handledAt make the second run a no-op.
 */
export const PROCESSING_STUCK_MS = 5 * 60_000;
export const SWEEP_EVERY_MS = 30_000;
const SWEEP_BATCH = 50;
const MAX_ERROR_LEN = 1000;

/**
 * Retention. The payload holds message text and phone numbers, so it must not
 * live here forever. FAILED is kept longer because a person may still need to
 * read it; both are bounded per run and run at most every PURGE_EVERY_MS.
 */
export const DONE_RETENTION_MS = 7 * 86_400_000;
export const FAILED_RETENTION_MS = 30 * 86_400_000;
export const PURGE_EVERY_MS = 10 * 60_000;
export const PURGE_BATCH = 500;
/** Batches per status per run: drains a backlog without one run monopolising the DB. */
export const PURGE_MAX_BATCHES = 20;

export const INBOUND_JOB_NAME = 'inbound';

type Logger = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error' | 'debug'>;

export interface InboxDeps {
    prisma: any;
    log: Logger;
    /** The handler: runs the existing processWebhook logic for one payload. */
    process: (payload: any) => Promise<void>;
    /** Where retries are re-enqueued (delayed). Without it they run in-process. */
    queue?: Pick<Queue, 'add'> | null;
}

export interface DispatchDeps extends InboxDeps {
    queue: Pick<Queue, 'add'> | null | undefined;
}

export function nextStateOnFailure(attempts: number, max: number = MAX_ATTEMPTS): 'PENDING' | 'FAILED' {
    return attempts >= max ? 'FAILED' : 'PENDING';
}

export async function persistInbound(prisma: any, payload: unknown, source = 'META'): Promise<string> {
    const row = await prisma.webhookInbox.create({
        data: { source, payload: payload as object, status: 'PENDING' },
        select: { id: true },
    });
    return row.id as string;
}

export async function claimInboxRow(
    prisma: any,
    id: string,
): Promise<{ id: string; payload: unknown; attempts: number; receivedAt?: Date } | null> {
    const claim = await prisma.webhookInbox.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, claimedAt: new Date() },
    });
    if (claim.count !== 1) return null;
    const row = await prisma.webhookInbox.findUnique({
        where: { id },
        select: { id: true, payload: true, attempts: true, receivedAt: true },
    });
    return row ?? null;
}

export type ProcessOutcome = 'done' | 'retry' | 'failed' | 'skipped' | 'busy';

/** Re-dispatch after `delayMs`; never throws (the sweep is the safety net). */
async function redispatch(deps: InboxDeps, id: string, delayMs: number): Promise<void> {
    try {
        await dispatchInbound({ ...deps, queue: deps.queue ?? null }, id, delayMs);
    } catch (err) {
        deps.log.warn({ err, inboxId: id }, 'Could not schedule inbound retry; the sweep will pick it up');
    }
}

export async function processInboxRow(deps: InboxDeps, id: string): Promise<ProcessOutcome> {
    const { prisma, log } = deps;
    const row = await claimInboxRow(prisma, id);
    if (!row) return 'skipped';

    try {
        await deps.process(row.payload);
    } catch (err) {
        if (err instanceof LockTimeoutError) {
            // The conversation is busy with an earlier message. Do not hold a
            // worker slot and do not burn an attempt: hand the row back and let
            // it come round again shortly.
            try {
                await prisma.webhookInbox.updateMany({
                    where: { id, status: 'PROCESSING' },
                    data: {
                        status: 'PENDING',
                        attempts: { decrement: 1 },
                        claimedAt: null,
                        nextAttemptAt: new Date(Date.now() + BUSY_RETRY_MS),
                    },
                });
            } catch (dbErr) {
                log.error({ err: dbErr, inboxId: id }, 'Could not return busy inbox row to PENDING');
                return 'busy'; // stays PROCESSING; the stuck sweep recovers it
            }
            log.debug({ inboxId: id }, 'Conversation busy; inbound row deferred');
            if (row.receivedAt && Date.now() - new Date(row.receivedAt).getTime() > STUCK_BUSY_MS) {
                log.warn({ inboxId: id }, 'Inbound row has been busy for over 15 minutes');
                await raiseAlert(prisma, {
                    kind: 'inbound.stuck_busy',
                    severity: 'warning',
                    message: 'An incoming message has waited over 15 minutes behind a busy conversation',
                    context: { inboxId: id, receivedAt: new Date(row.receivedAt).toISOString() },
                    dedupeKey: `inbound.stuck_busy:${id}`,
                });
            }
            await redispatch(deps, id, BUSY_RETRY_MS);
            return 'busy';
        }
        const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LEN);
        const state = nextStateOnFailure(row.attempts);
        const delay = backoffMs(row.attempts);
        try {
            await prisma.webhookInbox.updateMany({
                where: { id, status: 'PROCESSING' },
                data: {
                    status: state,
                    lastError: message,
                    claimedAt: null,
                    ...(state === 'PENDING' ? { nextAttemptAt: new Date(Date.now() + delay) } : {}),
                },
            });
        } catch (dbErr) {
            // Row stays PROCESSING; the sweep will recover it.
            log.error({ err: dbErr, inboxId: id }, 'Could not record inbox failure');
        }
        if (state === 'FAILED') {
            log.error({ err, inboxId: id, attempts: row.attempts }, 'Inbound webhook permanently failed');
            await alertPermanentFailure(prisma, id, row.attempts, message);
            return 'failed';
        }
        log.warn({ err, inboxId: id, attempts: row.attempts, retryInMs: delay }, 'Inbound webhook failed, will retry');
        await redispatch(deps, id, delay);
        return 'retry';
    }

    try {
        await prisma.webhookInbox.updateMany({
            where: { id, status: 'PROCESSING' },
            data: { status: 'DONE', processedAt: new Date(), lastError: null, claimedAt: null },
        });
    } catch (err) {
        // Processed but not marked: a sweep re-run is a harmless dedupe skip.
        log.error({ err, inboxId: id }, 'Inbound webhook processed but could not be marked DONE');
    }
    return 'done';
}

/**
 * Hand a row to BullMQ, or process in-process when there is no queue.
 * `delayMs` > 0 schedules a retry. Retries get a fresh jobId: the job that is
 * running right now still owns jobId=id, and BullMQ silently drops an add with
 * an existing id. Duplicate jobs are harmless; the claim is atomic.
 */
export async function dispatchInbound(deps: DispatchDeps, id: string, delayMs = 0): Promise<void> {
    if (deps.queue) {
        try {
            await deps.queue.add(INBOUND_JOB_NAME, { id }, {
                jobId: delayMs > 0 ? `${id}-d${Date.now()}` : id,
                ...(delayMs > 0 ? { delay: delayMs } : {}),
                removeOnComplete: true,
                removeOnFail: true,
            });
            return;
        } catch (err) {
            deps.log.warn({ err, inboxId: id }, 'Inbound enqueue failed, processing in-process');
        }
    }
    const run = () => {
        processInboxRow(deps, id).catch((err) => deps.log.error({ err, inboxId: id }, 'Inbound in-process run failed'));
    };
    if (delayMs > 0) {
        setTimeout(run, delayMs).unref?.();
    } else {
        setImmediate(run);
    }
}

export async function sweepInbox(
    deps: { prisma: any; log: Logger; dispatch: (id: string) => Promise<void> | void },
    now: Date = new Date(),
): Promise<{ requeued: number; recovered: number }> {
    const { prisma, log, dispatch } = deps;
    let recovered = 0;
    let requeued = 0;

    const stuckBefore = new Date(now.getTime() - PROCESSING_STUCK_MS);
    const stuck: Array<{ id: string; attempts: number }> = await prisma.webhookInbox.findMany({
        where: { status: 'PROCESSING', claimedAt: { lt: stuckBefore } },
        select: { id: true, attempts: true },
        take: SWEEP_BATCH,
    });
    for (const row of stuck) {
        const state = nextStateOnFailure(row.attempts);
        const res = await prisma.webhookInbox.updateMany({
            // Re-check the claim is still stale: with several sweepers, another
            // process may have legitimately re-claimed it since the read.
            where: { id: row.id, status: 'PROCESSING', claimedAt: { lt: stuckBefore } },
            data: {
                status: state,
                lastError: 'Recovered after processing stalled',
                claimedAt: null,
                ...(state === 'PENDING' ? { nextAttemptAt: now } : {}),
            },
        });
        if (res.count !== 1) continue;
        if (state === 'FAILED') {
            log.error({ inboxId: row.id, attempts: row.attempts }, 'Stalled inbound webhook out of attempts');
            await alertPermanentFailure(prisma, row.id, row.attempts, 'Recovered after processing stalled');
            continue;
        }
        recovered++;
    }

    const pending: Array<{ id: string }> = await prisma.webhookInbox.findMany({
        where: {
            status: 'PENDING',
            OR: [
                { nextAttemptAt: { lte: now } },
                { nextAttemptAt: null, receivedAt: { lt: new Date(now.getTime() - PENDING_STALE_MS) } },
            ],
        },
        select: { id: true },
        orderBy: { receivedAt: 'asc' },
        take: SWEEP_BATCH,
    });
    for (const row of pending) {
        await dispatch(row.id);
        requeued++;
    }

    if (requeued || recovered) log.info({ requeued, recovered }, 'Inbound inbox sweep');
    return { requeued, recovered };
}

/** Delete expired DONE/FAILED rows, a bounded batch of each per call. */
export async function purgeInbox(
    deps: { prisma: any; log: Logger },
    now: Date = new Date(),
): Promise<{ done: number; failed: number }> {
    const { prisma, log } = deps;
    const purge = async (status: string, retentionMs: number): Promise<number> => {
        let total = 0;
        for (let i = 0; i < PURGE_MAX_BATCHES; i++) {
            const rows: Array<{ id: string }> = await prisma.webhookInbox.findMany({
                where: { status, receivedAt: { lt: new Date(now.getTime() - retentionMs) } },
                select: { id: true },
                orderBy: { receivedAt: 'asc' },
                take: PURGE_BATCH,
            });
            if (rows.length === 0) break;
            const res = await prisma.webhookInbox.deleteMany({
                where: { id: { in: rows.map((r) => r.id) }, status },
            });
            total += res.count as number;
            if (rows.length < PURGE_BATCH) break;
        }
        return total;
    };
    const done = await purge('DONE', DONE_RETENTION_MS);
    const failed = await purge('FAILED', FAILED_RETENTION_MS);
    if (done || failed) log.info({ done, failed }, 'Inbound inbox purge');
    return { done, failed };
}

/** Timer for index.ts. Returns a stop function. */
export function startInboundSweeper(deps: DispatchDeps): () => void {
    let lastPurge = 0;
    const timer = setInterval(() => {
        sweepInbox({ prisma: deps.prisma, log: deps.log, dispatch: (id) => dispatchInbound(deps, id) })
            .catch((err) => deps.log.error({ err }, 'Inbound sweep failed'));
        if (Date.now() - lastPurge >= PURGE_EVERY_MS) {
            lastPurge = Date.now();
            purgeInbox({ prisma: deps.prisma, log: deps.log })
                .catch((err) => deps.log.error({ err }, 'Inbound purge failed'));
        }
    }, SWEEP_EVERY_MS);
    timer.unref?.();
    return () => clearInterval(timer);
}
