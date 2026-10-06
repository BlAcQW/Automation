/** BullMQ worker for the 'webhooks' queue. Jobs are `{ id }` of a WebhookDelivery row. */
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { WEBHOOK_JOB_NAME, WEBHOOK_QUEUE_NAME, processDelivery, type DeliveryDeps } from './delivery.js';

export type WebhookWorkerHandle = { worker: Worker; connection: IORedis };

export function startWebhookWorker(redisUrl: string | undefined, deps: DeliveryDeps): WebhookWorkerHandle | null {
    if (!redisUrl) {
        deps.log.warn('Redis not configured - webhooks are delivered in-process');
        return null;
    }
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(
        WEBHOOK_QUEUE_NAME,
        async (job) => {
            if (job.name !== WEBHOOK_JOB_NAME) return;
            await processDelivery(deps, String(job.data?.id));
        },
        { connection, concurrency: 10 },
    );
    worker.on('error', (err) => (deps.log as FastifyBaseLogger).error({ err }, 'Webhook worker error'));
    deps.log.info('Webhook worker started');
    return { worker, connection };
}

export async function stopWebhookWorker(handle: WebhookWorkerHandle | null): Promise<void> {
    if (!handle) return;
    await handle.worker.close();
    await handle.connection.quit().catch(() => undefined);
}
