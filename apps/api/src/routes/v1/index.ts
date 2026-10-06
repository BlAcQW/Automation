/**
 * Public API v1 (D2). Register with `{ prefix: '/v1' }`.
 *
 * Server-to-server JSON authenticated by an API key (plugins/api-key-auth.ts).
 * Every route is tenant-scoped through the key's tenant, which is also bound
 * into the Prisma tenant guard. Docs: docs/API.md.
 */

import type { FastifyPluginAsync } from 'fastify';
import apiKeyAuthPlugin from '../../plugins/api-key-auth.js';
import { registerExternalAppFulfiller } from '../../services/external-app.js';
import { installV1ErrorHandling } from './shared.js';
import conversationRoutes from './conversations.js';
import messageRoutes from './messages.js';
import customerRoutes from './customers.js';
import paymentLinkRoutes from './payment-links.js';
import rideRoutes from './rides.js';

const v1Routes: FastifyPluginAsync = async (fastify) => {
    // Payment links for external apps are useless without their fulfiller, so
    // the API never depends on another file remembering to register it.
    registerExternalAppFulfiller();

    if (!fastify.hasDecorator('authenticateApiKey')) {
        await fastify.register(apiKeyAuthPlugin);
    }
    installV1ErrorHandling(fastify);

    await fastify.register(conversationRoutes);
    await fastify.register(messageRoutes);
    await fastify.register(customerRoutes);
    await fastify.register(paymentLinkRoutes);
    await fastify.register(rideRoutes);
};

export default v1Routes;
