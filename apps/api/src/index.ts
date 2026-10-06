// Sentry must be imported and initialized BEFORE any other imports that may
// emit telemetry. The SDK is a no-op when SENTRY_DSN is unset.
import { initSentry } from './lib/sentry.js';
initSentry();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import errorHandler from './plugins/error-handler.js';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import * as Sentry from '@sentry/node';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import redisPlugin from './plugins/redis.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import IORedis from 'ioredis';
import { startTasks, installDeliveryDispatcher } from './background/tasks.js';
import { startRealtimeSubscriber } from './background/realtime-bridge.js';
import { resolveProcessRole, runsBackground, assertRoleRequirements, type ProcessRole } from './lib/process-role.js';
import { createShutdown, type ShutdownStep } from './lib/graceful-shutdown.js';

// Import routes
import authRoutes from './routes/auth/index.js';
import adminRoutes from './routes/admin/index.js';
import adminBillingRoutes from './routes/admin-billing/index.js';
import servicesRoutes from './routes/services/index.js';
import availabilityRoutes from './routes/availability/index.js';
import bookingsRoutes from './routes/bookings/index.js';
import conversationsRoutes from './routes/conversations/index.js';
import customersRoutes from './routes/customers/index.js';
import dashboardRoutes from './routes/dashboard/index.js';
import whatsappRoutes, { processWebhook } from './routes/whatsapp/index.js';
import productsRoutes from './routes/products/index.js';
import ordersRoutes from './routes/orders/index.js';
import calendarRoutes from './routes/calendar/index.js';
import notificationsRoutes from './routes/notifications/index.js';
import templatesRoutes from './routes/templates/index.js';
import paymentsRoutes from './routes/payments/index.js';
import billingRoutes from './routes/billing/index.js';
import publicRoutes from './routes/public/index.js';
import smsRoutes from './routes/sms/index.js';
import emailRoutes from './routes/email/index.js';
import devicesRoutes from './routes/devices/index.js';
import privacyRoutes from './routes/privacy/index.js';
import channelRoutes from './routes/channels/index.js';
import moneyRoutes from './routes/money/index.js';
import usersRoutes from './routes/users/index.js';
import webhooksRoutes from './routes/webhooks/index.js';
import v1Routes from './routes/v1/index.js';
import developerRoutes from './routes/developer/index.js';
import csrfPlugin from './plugins/csrf.js';
import { registerExternalAppFulfiller } from './services/external-app.js';
import { registerFlowPaymentFulfiller } from './services/flow-payments.js';
import websocket from '@fastify/websocket';
import realtimeRoutes from './routes/realtime/index.js';

const app = Fastify({
    // Behind nginx: believe X-Forwarded-For from the local hop so request.ip is the real client.
    trustProxy: config.trustProxy,
    logger: {
        level: config.nodeEnv === 'development' ? 'debug' : 'info',
        transport: config.nodeEnv === 'development'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
    },
});

async function buildApp() {
    // Register CORS
    await app.register(cors, {
        origin: config.corsOrigins,
        credentials: true,
    });

    // Register cookie plugin
    await app.register(cookie, {
        secret: config.jwtSecret,
    });
    // CSRF guard for cookie-authenticated refresh/logout when cross-site auth
    // is enabled (CROSS_SITE_AUTH). A no-op otherwise. Must precede the routes.
    await app.register(csrfPlugin);

    // Register sensible for better error handling
    await app.register(sensible);

    // Must come after sensible (it reads httpErrors' statusCode) and before the
    // routes, so every throw below lands here instead of Fastify's default.
    await app.register(errorHandler);

    // Attachments on human replies. The ceiling matches WhatsApp's largest
    // accepted type (documents); services/media.ts enforces the tighter
    // per-type limits once the MIME type is known.
    await app.register(multipart, {
        limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    });

    // Capture raw request body for HMAC signature verification (WhatsApp webhook).
    // Must be added BEFORE routes register so the parser is in place when the
    // webhook handler resolves `request.rawBody`.
    app.addContentTypeParser(
        'application/json',
        { parseAs: 'buffer' },
        (req, body, done) => {
            try {
                const buf = body as Buffer;
                (req as any).rawBody = buf;
                const text = buf.toString('utf8');
                const json = text.length ? JSON.parse(text) : {};
                done(null, json);
            } catch (err) {
                done(err as Error, undefined);
            }
        },
    );

    // Register plugins
    await app.register(prismaPlugin);
    await app.register(authPlugin);
    await app.register(redisPlugin);
    // Rate limiting keyed by verified user (per-IP when unauthenticated and on
    // /auth). Needs the jwt decorator from authPlugin, so it registers after it,
    // and before any route so every route is covered.
    await app.register(rateLimitPlugin, { max: 100, timeWindow: '1 minute' });
    // Payments for apps hosted elsewhere (fulfillment kind 'external_app').
    registerExternalAppFulfiller();
    // Payment steps of a conversation flow (fulfillment kind 'flow_payment').
    registerFlowPaymentFulfiller();

    // Wire Sentry error handler — no-op when DSN unset.
    Sentry.setupFastifyErrorHandler(app);

    // ---------- Health endpoints ----------
    // Liveness: process is up. Never depends on external services.
    app.get('/health/live', { config: { rateLimit: false } }, async () => {
        return { status: 'ok' };
    });

    // Readiness: process AND its dependencies are reachable. 503 on any miss.
    app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
        const checks: Record<string, 'ok' | string> = {};
        let allHealthy = true;

        try {
            await app.prisma.$queryRaw`SELECT 1`;
            checks.database = 'ok';
        } catch (err) {
            checks.database = (err as Error).message;
            allHealthy = false;
        }

        if (config.redisUrl && app.redis) {
            try {
                await app.redis.ping();
                checks.redis = 'ok';
            } catch (err) {
                checks.redis = (err as Error).message;
                allHealthy = false;
            }
        }

        return reply.status(allHealthy ? 200 : 503).send({
            status: allHealthy ? 'ok' : 'degraded',
            checks,
        });
    });

    // Legacy /health → /health/live alias (keep callers happy until they migrate).
    app.get('/health', { config: { rateLimit: false } }, async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Register routes
    await app.register(authRoutes, { prefix: '/auth' });
    await app.register(adminRoutes, { prefix: '/admin' });
    // Custom billing terms and statements (admin-authenticated).
    await app.register(adminBillingRoutes, { prefix: '/admin/billing' });
    await app.register(servicesRoutes, { prefix: '/services' });
    await app.register(availabilityRoutes, { prefix: '/availability' });
    await app.register(bookingsRoutes, { prefix: '/bookings' });
    await app.register(conversationsRoutes, { prefix: '/conversations' });
    await app.register(customersRoutes, { prefix: '/customers' });
    await app.register(dashboardRoutes, { prefix: '/dashboard' });
    await app.register(whatsappRoutes, { prefix: '/whatsapp' });
    await app.register(productsRoutes, { prefix: '/products' });
    await app.register(ordersRoutes, { prefix: '/orders' });
    await app.register(calendarRoutes, { prefix: '/calendar' });
    await app.register(notificationsRoutes, { prefix: '/notifications' });
    await app.register(templatesRoutes, { prefix: '/templates' });
    await app.register(paymentsRoutes, { prefix: '/payments' });
    await app.register(billingRoutes, { prefix: '/billing' });
    await app.register(publicRoutes, { prefix: '/public' });
    await app.register(smsRoutes, { prefix: '/sms' });
    await app.register(emailRoutes, { prefix: '/email' });
    await app.register(devicesRoutes, { prefix: '/devices' });
    await app.register(privacyRoutes, { prefix: '/privacy' });
    await app.register(channelRoutes, { prefix: '/channels' });
    await app.register(moneyRoutes, { prefix: '/money' });
    await app.register(usersRoutes, { prefix: '/users' });
    await app.register(webhooksRoutes, { prefix: '/webhooks' });
    // Public API for external apps (API-key auth, server-to-server).
    await app.register(v1Routes, { prefix: '/v1' });
    await app.register(developerRoutes, { prefix: '/developer' });
    // Live updates over WebSocket (GET /ws). Registered after the plugin so the
    // route can opt in with { websocket: true }.
    await app.register(websocket);
    await app.register(realtimeRoutes);

    return app;
}

/**
 * Boots this process according to PROCESS_ROLE (default 'all').
 *
 *   all     HTTP + every background task (today's single-process deployment)
 *   api     HTTP only; work is enqueued to Redis for a worker process
 *   worker  background tasks only (runs worker.ts's runWorker; no listener)
 *
 * WHERE TO REGISTER THINGS
 *   - HTTP routes:            buildApp() above, in the "Register routes" block.
 *   - Sweepers/queue workers: background/tasks.ts BACKGROUND_TASKS (runs in
 *                             `all` and `worker`, never in `api`).
 */
async function start() {
    let role: ProcessRole;
    try {
        role = resolveProcessRole(process.env.PROCESS_ROLE);
        assertRoleRequirements(role, config.redisUrl);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }

    if (role === 'worker') {
        const { runWorker } = await import('./worker.js');
        await runWorker();
        return;
    }

    try {
        const server = await buildApp();

        await server.listen({
            port: config.port,
            host: config.host,
        });

        const steps: ShutdownStep[] = [];

        // Every HTTP process can publish events; nudge delivery after writing rows.
        const uninstallDispatcher = installDeliveryDispatcher({
            prisma: server.prisma,
            log: server.log,
            queues: server.queues,
        });
        steps.push({ name: 'event-dispatcher', run: uninstallDispatcher });

        if (runsBackground(role)) {
            const tasks = await startTasks({
                prisma: server.prisma,
                log: server.log,
                redisUrl: config.redisUrl,
                queues: server.queues,
                processWebhook: (payload) => processWebhook(server, payload as any),
            });
            // Drain background work before the HTTP server (and prisma) go away.
            steps.unshift({ name: 'background-tasks', run: tasks.stop });
        } else if (config.redisUrl) {
            // api role: the worker owns background work, so live-update events it
            // raises arrive over Redis and are replayed to this process's sockets.
            const sub = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
            sub.on('error', (err) => server.log.error({ err }, 'Realtime subscriber error'));
            const stopSub = startRealtimeSubscriber(sub);
            steps.unshift({ name: 'realtime-subscriber', run: stopSub });
        }
        steps.push({ name: 'http-server', run: () => server.close() });

        const shutdown = createShutdown({ log: server.log, steps });
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        server.log.info({ role }, `Bookly API running at http://${config.host}:${config.port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

// Only boot when run as the entry point. Importing this module (tests do, to
// exercise real routes through app.inject) must not bind a port or spawn the
// notification workers.
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    start();
}

export { buildApp };
