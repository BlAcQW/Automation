// Sentry must be imported and initialized BEFORE any other imports that may
// emit telemetry. The SDK is a no-op when SENTRY_DSN is unset.
import { initSentry } from './lib/sentry.js';
initSentry();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import errorHandler from './plugins/error-handler.js';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import * as Sentry from '@sentry/node';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import redisPlugin from './plugins/redis.js';
import { startNotificationWorkers, stopNotificationWorkers } from './services/notification-worker.js';
import { startHoldExpirySweeper } from './services/hold-expiry.js';
import { startInboundWorker, stopInboundWorker } from './services/inbound-worker.js';
import { startInboundSweeper } from './services/inbound-queue.js';
import { startDeliverySweeper, dispatchDelivery } from './services/events/delivery.js';
import { startWebhookWorker, stopWebhookWorker } from './services/events/worker.js';
import { setDeliveryDispatcher } from './services/events/dispatcher.js';

// Import routes
import authRoutes from './routes/auth/index.js';
import adminRoutes from './routes/admin/index.js';
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

    // Register rate limiting
    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });

    // Register plugins
    await app.register(prismaPlugin);
    await app.register(authPlugin);
    await app.register(redisPlugin);
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

// BullMQ workers — drains the notification + reminder queues. Started only
// when Redis is configured, since BullMQ requires it.
let workers: ReturnType<typeof startNotificationWorkers> | null = null;
// Releases booking slots whose deposit was never paid. In-process timer.
let stopHoldSweeper: (() => void) | null = null;
// Durable inbound webhook processing: BullMQ worker (Redis only) + a sweep that
// re-dispatches stranded WebhookInbox rows (works with or without Redis).
let inboundWorker: ReturnType<typeof startInboundWorker> = null;
let stopInboundSweeper: (() => void) | null = null;
// Outgoing webhooks (D3): same shape as the inbound pair above.
let webhookWorker: ReturnType<typeof startWebhookWorker> = null;
let stopWebhookSweeper: (() => void) | null = null;

async function start() {
    try {
        const server = await buildApp();

        await server.listen({
            port: config.port,
            host: config.host,
        });

        workers = startNotificationWorkers(config.redisUrl);
        stopHoldSweeper = startHoldExpirySweeper(server.prisma, server.log);

        const inboundDeps = {
            prisma: server.prisma,
            log: server.log,
            process: (payload: unknown) => processWebhook(server, payload as any),
            // Delayed retries (backoff / busy conversation) are re-enqueued here.
            queue: server.queues.inbound,
        };
        inboundWorker = startInboundWorker(config.redisUrl, inboundDeps);
        stopInboundSweeper = startInboundSweeper(inboundDeps);

        const webhookDeps = { prisma: server.prisma, log: server.log, queue: server.queues.webhooks };
        webhookWorker = startWebhookWorker(config.redisUrl, webhookDeps);
        stopWebhookSweeper = startDeliverySweeper(webhookDeps);
        // Lets publishEvent() nudge delivery right after it writes the rows.
        setDeliveryDispatcher((id, delayMs) => dispatchDelivery(webhookDeps, id, delayMs));

        server.log.info(`Bookly API running at http://${config.host}:${config.port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

async function shutdown(signal: string) {
    app.log.info({ signal }, 'Shutting down gracefully');
    try {
        stopHoldSweeper?.();
        stopInboundSweeper?.();
        stopWebhookSweeper?.();
        setDeliveryDispatcher(null);
        await stopInboundWorker(inboundWorker);
        await stopWebhookWorker(webhookWorker);
        if (workers) {
            await stopNotificationWorkers(workers);
        }
        await app.close();
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Only boot when run as the entry point. Importing this module (tests do, to
// exercise real routes through app.inject) must not bind a port or spawn the
// notification workers.
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    start();
}

export { buildApp };
