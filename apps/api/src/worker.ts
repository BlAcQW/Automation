// Background-work entry point (PROCESS_ROLE=worker). No HTTP listener.
//
//   node dist/worker.js        (npm run start:worker)
//   tsx watch src/worker.ts    (npm run dev:worker)
//
// Needs the database, Redis and config. Runs every task in
// background/tasks.ts (queue workers, sweepers, retention purges), delivers
// live-update events to the API process over Redis, and shuts down gracefully.
import { initSentry } from './lib/sentry.js';
initSentry();

import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import { processWebhook } from './routes/whatsapp/index.js';
import { registerExternalAppFulfiller } from './services/external-app.js';
import { registerFlowPaymentFulfiller } from './services/flow-payments.js';
import { startTasks, installDeliveryDispatcher } from './background/tasks.js';
import { installRealtimeForwarder } from './background/realtime-bridge.js';
import { assertRoleRequirements } from './lib/process-role.js';
import { createShutdown } from './lib/graceful-shutdown.js';

export interface WorkerOptions {
    redisUrl?: string;
}

/**
 * Builds a Fastify instance that never listens. It exists because the message
 * handlers take one (`fastify.prisma`, `.log`, `.queues`, `.httpErrors`), and
 * because the prisma/redis plugins already own connect + disconnect.
 */
export async function startWorker(opts: WorkerOptions = { redisUrl: config.redisUrl }) {
    assertRoleRequirements('worker', opts.redisUrl);

    const app = Fastify({
        logger: {
            level: process.env.VITEST ? 'silent' : config.nodeEnv === 'development' ? 'debug' : 'info',
            transport: config.nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
        },
    });
    await app.register(sensible);
    await app.register(prismaPlugin);
    await app.register(redisPlugin);
    await app.ready();

    // Same fulfiller registrations as buildApp(): the flow engine can start a
    // payment from an inbound message processed here.
    registerExternalAppFulfiller();
    registerFlowPaymentFulfiller();

    const uninstallDispatcher = installDeliveryDispatcher({ prisma: app.prisma, log: app.log, queues: app.queues });
    const uninstallForwarder = installRealtimeForwarder(app.redis!);

    let tasks: Awaited<ReturnType<typeof startTasks>>;
    try {
        tasks = await startTasks({
            prisma: app.prisma,
            log: app.log,
            redisUrl: opts.redisUrl,
            queues: app.queues,
            processWebhook: (payload) => processWebhook(app, payload as any),
        });
    } catch (err) {
        uninstallDispatcher();
        uninstallForwarder();
        await app.close();
        throw err;
    }

    app.log.info('Bookly worker running (no HTTP listener)');

    return {
        app,
        /** Drain in-flight jobs first, then unwire, then close prisma/redis. */
        stop: async () => {
            await tasks.stop();
            uninstallDispatcher();
            uninstallForwarder();
            await app.close();
        },
    };
}

/** Entry used by worker.ts when run directly, and by index.ts for PROCESS_ROLE=worker. */
export async function runWorker(): Promise<void> {
    try {
        const worker = await startWorker();
        const shutdown = createShutdown({
            log: worker.app.log,
            steps: [{ name: 'worker', run: worker.stop }],
        });
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));
    } catch (err) {
        logger.error({ err }, 'Worker failed to start');
        process.exit(1);
    }
}

// The package builds to CommonJS (no "type": "module"), so the entry-point check
// is require.main. Importing this file (index.ts, tests) must not boot a worker.
function isEntryPoint(): boolean {
    return typeof require !== 'undefined' && require.main === module;
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && isEntryPoint()) {
    void runWorker();
}
