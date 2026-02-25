import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { config } from './config/index.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import redisPlugin from './plugins/redis.js';

// Import routes
import authRoutes from './routes/auth/index.js';
import adminRoutes from './routes/admin/index.js';
import servicesRoutes from './routes/services/index.js';
import availabilityRoutes from './routes/availability/index.js';
import bookingsRoutes from './routes/bookings/index.js';
import conversationsRoutes from './routes/conversations/index.js';
import customersRoutes from './routes/customers';
import whatsappRoutes from './routes/whatsapp/index.js';
import productsRoutes from './routes/products/index.js';
import ordersRoutes from './routes/orders/index.js';
import calendarRoutes from './routes/calendar/index.js';
import notificationsRoutes from './routes/notifications/index.js';

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

    // Register rate limiting
    await app.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });

    // Register plugins
    await app.register(prismaPlugin);
    await app.register(authPlugin);
    await app.register(redisPlugin);

    // Health check endpoint
    app.get('/health', async () => {
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
    await app.register(whatsappRoutes, { prefix: '/whatsapp' });
    await app.register(productsRoutes, { prefix: '/products' });
    await app.register(ordersRoutes, { prefix: '/orders' });
    await app.register(calendarRoutes, { prefix: '/calendar' });
    await app.register(notificationsRoutes, { prefix: '/notifications' });

    return app;
}

async function start() {
    try {
        const server = await buildApp();

        await server.listen({
            port: config.port,
            host: config.host,
        });

        console.log(`🚀 BookingFlow API running at http://${config.host}:${config.port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await app.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nShutting down gracefully...');
    await app.close();
    process.exit(0);
});

start();

export { buildApp };
