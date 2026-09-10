// Sentry must be imported and initialized BEFORE any other imports that may
// emit telemetry. The SDK is a no-op when SENTRY_DSN is unset.
import { initSentry } from './lib/sentry.js';
initSentry();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import * as Sentry from '@sentry/node';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import redisPlugin from './plugins/redis.js';
import { startNotificationWorkers, stopNotificationWorkers } from './services/notification-worker.js';

// Import routes
import authRoutes from './routes/auth/index.js';
import adminRoutes from './routes/admin/index.js';
import servicesRoutes from './routes/services/index.js';
import availabilityRoutes from './routes/availability/index.js';
import bookingsRoutes from './routes/bookings/index.js';
import conversationsRoutes from './routes/conversations/index.js';
import customersRoutes from './routes/customers/index.js';
import dashboardRoutes from './routes/dashboard/index.js';
import whatsappRoutes from './routes/whatsapp/index.js';
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
import usersRoutes from './routes/users/index.js';
import websocket from '@fastify/websocket';
import realtimeRoutes from './routes/realtime/index.js';

const app = Fastify({
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

    // Register sensible for better error handling
    await app.register(sensible);

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
    await app.register(usersRoutes, { prefix: '/users' });
    // Live updates over WebSocket (GET /ws). Registered after the plugin so the
    // route can opt in with { websocket: true }.
    await app.register(websocket);
    await app.register(realtimeRoutes);

    return app;
}

// BullMQ workers — drains the notification + reminder queues. Started only
// when Redis is configured, since BullMQ requires it.
let workers: ReturnType<typeof startNotificationWorkers> | null = null;

async function start() {
    try {
        const server = await buildApp();

        await server.listen({
            port: config.port,
            host: config.host,
        });

        workers = startNotificationWorkers(config.redisUrl);

        server.log.info(`Bookly API running at http://${config.host}:${config.port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

async function shutdown(signal: string) {
    app.log.info({ signal }, 'Shutting down gracefully');
    try {
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

start();

export { buildApp };
