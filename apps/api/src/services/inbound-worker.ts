/**
 * BullMQ worker for the 'inbound' queue. Each job is just `{ id }` of a
 * WebhookInbox row; the row (not the job) is the source of truth, so a lost or
 * duplicated job is harmless. Per-conversation ordering is enforced inside the
 * handler by conversation-lock, not by queue concurrency.
 */

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { INBOUND_JOB_NAME, processInboxRow, type InboxDeps } from './inbound-queue.js';

export const INBOUND_QUEUE_NAME = 'inbound';

export function startInboundWorker(
    redisUrl: string | undefined,
    deps: InboxDeps,
): { worker: Worker; connection: IORedis } | null {
    if (!redisUrl) {
        deps.log.warn('Redis not configured - inbound messages are processed in-process');
        return null;
    }
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(
        INBOUND_QUEUE_NAME,
        async (job) => {
            if (job.name !== INBOUND_JOB_NAME) return;
            await processInboxRow(deps, String(job.data?.id));
        },
        { connection, concurrency: 10 },
    );
    worker.on('error', (err) => (deps.log as FastifyBaseLogger).error({ err }, 'Inbound worker error'));
    deps.log.info('Inbound worker started');
    return { worker, connection };
}

export async function stopInboundWorker(
    handle: { worker: Worker; connection: IORedis } | null,
): Promise<void> {
    if (!handle) return;
    await handle.worker.close();
    await handle.connection.quit().catch(() => undefined);
}
