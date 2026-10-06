/**
 * Registry of background work: everything that must run outside a request.
 *
 * Shared by both entry points: index.ts runs it for PROCESS_ROLE=all, worker.ts
 * for PROCESS_ROLE=worker. The `api` role never runs it.
 *
 * ADDING A SWEEPER / WORKER: append one entry to BACKGROUND_TASKS below.
 *   { name: 'my-sweeper', start: (ctx) => startMySweeper(ctx.prisma, ctx.log) }
 * `start` returns a stop function (sync or async) or null when there is nothing
 * to stop. Names must be unique.
 *
 * MULTI-PROCESS SAFETY: a task may run in more than one process during a
 * rolling restart, or if a second worker is ever started. It MUST claim work
 * atomically (updateMany with the expected state in `where`, check count) or be
 * idempotent. Document how in the task's own module.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import type { Queue } from 'bullmq';
import { startNotificationWorkers, stopNotificationWorkers } from '../services/notification-worker.js';
import { startHoldExpirySweeper } from '../services/hold-expiry.js';
import { startOrderExpirySweeper } from '../services/order-expiry.js';
import { startRefundRetrySweeper } from '../services/refund-retry.js';
import { startPayoutReaper } from '../services/payout-reaper.js';
import { startInboundWorker, stopInboundWorker } from '../services/inbound-worker.js';
import { startInboundSweeper } from '../services/inbound-queue.js';
import { startDeliverySweeper, dispatchDelivery } from '../services/events/delivery.js';
import { startWebhookWorker, stopWebhookWorker } from '../services/events/worker.js';
import { setDeliveryDispatcher } from '../services/events/dispatcher.js';

export interface BackgroundContext {
    prisma: ExtendedPrismaClient;
    log: FastifyBaseLogger;
    redisUrl: string | undefined;
    queues: { inbound: Queue | null; webhooks: Queue | null };
    /** Runs one inbound webhook payload (routes/whatsapp processWebhook bound to this process's app). */
    processWebhook: (payload: unknown) => Promise<void>;
}

type Stop = () => Promise<void> | void;

export interface BackgroundTask {
    name: string;
    start: (ctx: BackgroundContext) => Stop | null | Promise<Stop | null>;
}

function inboundDeps(ctx: BackgroundContext) {
    return {
        prisma: ctx.prisma,
        log: ctx.log,
        process: ctx.processWebhook,
        // Delayed retries (backoff / busy conversation) are re-enqueued here.
        queue: ctx.queues.inbound,
    };
}

function webhookDeps(ctx: BackgroundContext) {
    return { prisma: ctx.prisma, log: ctx.log, queue: ctx.queues.webhooks };
}

// ---- REGISTER NEW BACKGROUND TASKS HERE (order = start order; stop is reversed) ----
export const BACKGROUND_TASKS: BackgroundTask[] = [
    {
        // BullMQ: safe in many processes (jobs are locked per worker).
        name: 'notification-workers',
        start: (ctx) => {
            const workers = startNotificationWorkers(ctx.redisUrl);
            return () => stopNotificationWorkers(workers);
        },
    },
    {
        // Safe in many processes: the flip is updateMany WHERE status=PENDING_PAYMENT AND unpaid; count 0 skips.
        name: 'hold-expiry-sweeper',
        start: (ctx) => startHoldExpirySweeper(ctx.prisma, ctx.log),
    },
    {
        // Safe in many processes: the cancel is updateMany WHERE status=PENDING AND unpaid, and the restock runs in the
        // same transaction only when that claim returned count 1, so two sweepers (or a payment landing mid-sweep) never
        // cancel or restock an order twice. See services/order-expiry.ts.
        name: 'order-expiry-sweeper',
        start: (ctx) => startOrderExpirySweeper(ctx.prisma, ctx.log),
    },
    {
        // Safe in many processes: the refund claim is an atomic conditional update.
        name: 'refund-retry-sweeper',
        start: (ctx) => startRefundRetrySweeper(ctx.prisma, ctx.log),
    },
    {
        // Safe in many processes: only raises alerts, deduped once per payout.
        name: 'payout-reaper',
        start: (ctx) => startPayoutReaper(ctx.prisma, ctx.log),
    },
    {
        // BullMQ + atomic claimInboxRow (updateMany WHERE PENDING).
        name: 'inbound-worker',
        start: (ctx) => {
            const handle = startInboundWorker(ctx.redisUrl, inboundDeps(ctx));
            return () => stopInboundWorker(handle);
        },
    },
    {
        // Claims are atomic. KNOWN GAP: stuck-row recovery (PROCESSING->PENDING) matches on status only, not claimedAt, so
        // with SEVERAL sweepers it could reset a row another process re-claimed a moment ago. Harmless with one worker.
        name: 'inbound-sweeper',
        start: (ctx) => startInboundSweeper(inboundDeps(ctx)),
    },
    {
        name: 'webhook-worker',
        start: (ctx) => {
            const handle = startWebhookWorker(ctx.redisUrl, webhookDeps(ctx));
            return () => stopWebhookWorker(handle);
        },
    },
    {
        // Atomic: stuck recovery re-checks claimedAt in its WHERE; dispatch is idempotent (jobId = row id).
        name: 'webhook-sweeper',
        start: (ctx) => startDeliverySweeper(webhookDeps(ctx)),
    },
];
// ---- END REGISTRY ----

export async function startTasks(
    ctx: BackgroundContext,
    tasks: BackgroundTask[] = BACKGROUND_TASKS,
): Promise<{ stop: () => Promise<void> }> {
    const names = tasks.map((t) => t.name);
    if (new Set(names).size !== names.length) {
        throw new Error(`Duplicate background task name in registry: ${names.join(', ')}`);
    }

    const started: Array<{ name: string; stop: Stop }> = [];
    const stopAll = async () => {
        for (const t of [...started].reverse()) {
            try {
                await t.stop();
            } catch (err) {
                ctx.log.error({ err, task: t.name }, 'Background task failed to stop');
            }
        }
        started.length = 0;
    };

    for (const task of tasks) {
        try {
            const stop = await task.start(ctx);
            started.push({ name: task.name, stop: stop ?? (() => undefined) });
        } catch (err) {
            await stopAll();
            throw new Error(`Background task "${task.name}" failed to start: ${(err as Error).message}`);
        }
    }
    return { stop: stopAll };
}

/**
 * Lets publishEvent() nudge webhook delivery right after it writes the rows.
 * Needed in EVERY process that can publish events (api, worker, all); not a
 * background task. Returns an uninstall function.
 */
export function installDeliveryDispatcher(ctx: Pick<BackgroundContext, 'prisma' | 'log' | 'queues'>): () => void {
    const deps = webhookDeps(ctx as BackgroundContext);
    setDeliveryDispatcher((id, delayMs) => dispatchDelivery(deps, id, delayMs));
    return () => setDeliveryDispatcher(null);
}
