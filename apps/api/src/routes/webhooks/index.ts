import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { encrypt } from '../../services/crypto.js';
import { EVENT_TYPES, WILDCARD_EVENT, isEventType } from '../../services/events/catalogue.js';
import { publishTestEvent } from '../../services/events/publish.js';
import { UnsafeUrlError, validateWebhookUrl } from '../../services/events/ssrf.js';
import { EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION } from '../../services/external-app.js';

/**
 * Outgoing webhook subscriptions (D3). OWNER only; every query is scoped to the
 * caller's tenant. The signing secret is returned exactly once (create /
 * rotate) and is stored encrypted; it is never readable again.
 *
 * The external-app subscription (description 'external-app') is managed only
 * through /developer/external-app: it is hidden from the list, excluded from the
 * per-tenant cap, refused here by id (409 with a pointer), and the description is
 * reserved so a user cannot create a lookalike that the sync would overwrite.
 */
export const MAX_SUBSCRIPTIONS_PER_TENANT = 10;
const MAX_EVENTS_PER_SUBSCRIPTION = 30;

const MANAGED_MESSAGE =
    'This webhook is managed through the external app settings (/developer/external-app) and cannot be changed here.';

/** Prisma filter: everything except the managed subscription (description is nullable, so NOT alone would drop NULLs). */
const USER_MANAGED = {
    OR: [{ description: null }, { description: { not: EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION } }],
};

const description = z
    .string()
    .trim()
    .max(200)
    .refine((d) => d.toLowerCase() !== EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION, 'That description is reserved');

const eventsSchema = z
    .array(z.string().refine((e) => e === WILDCARD_EVENT || isEventType(e), 'Unknown event type'))
    .min(1)
    .max(MAX_EVENTS_PER_SUBSCRIPTION)
    .transform((a) => [...new Set(a)]);

const createSchema = z
    .object({
        url: z.string().min(1).max(2000),
        events: eventsSchema,
        description: description.optional(),
    })
    .strict();

const updateSchema = z
    .object({
        url: z.string().min(1).max(2000).optional(),
        events: eventsSchema.optional(),
        description: description.nullable().optional(),
        isActive: z.boolean().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const idParams = z.object({ id: z.string().min(1).max(64) }).strict();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

const PUBLIC_SELECT = {
    id: true, url: true, events: true, description: true, isActive: true, createdAt: true, updatedAt: true,
} as const;

function newSecret(): string {
    return `whsec_${randomBytes(32).toString('hex')}`;
}

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
    const ownerOnly = async (request: FastifyRequest) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the owner can manage webhooks');
        }
    };
    const guard = { preHandler: [fastify.authenticate, ownerOnly] };

    const checkUrl = async (url: string): Promise<string> => {
        try {
            return (await validateWebhookUrl(url)).toString();
        } catch (err) {
            if (err instanceof UnsafeUrlError) throw fastify.httpErrors.badRequest(err.message);
            throw err;
        }
    };

    const findOwned = async (tenantId: string, id: string) => {
        const sub = await fastify.prisma.webhookSubscription.findFirst({ where: { id, tenantId }, select: PUBLIC_SELECT });
        if (!sub) throw fastify.httpErrors.notFound('Webhook not found');
        if (sub.description === EXTERNAL_APP_SUBSCRIPTION_DESCRIPTION) throw fastify.httpErrors.conflict(MANAGED_MESSAGE);
        return sub;
    };

    const auditSub = (request: FastifyRequest, action: string, targetId: string, metadata?: Record<string, unknown>) =>
        audit({
            prisma: fastify.prisma,
            action,
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            targetType: 'WEBHOOK_SUBSCRIPTION',
            targetId,
            metadata,
        });

    // GET /webhooks/event-types - what can be subscribed to
    fastify.get('/event-types', guard, async () => ({
        eventTypes: Object.entries(EVENT_TYPES).map(([type, d]) => ({ type, ...d })),
        wildcard: WILDCARD_EVENT,
    }));

    // GET /webhooks
    fastify.get('/', guard, async (request) => {
        const subscriptions = await fastify.prisma.webhookSubscription.findMany({
            where: { tenantId: request.user.tenantId, ...USER_MANAGED },
            select: PUBLIC_SELECT,
            orderBy: { createdAt: 'asc' },
        });
        return { subscriptions };
    });

    // POST /webhooks - secret returned once
    fastify.post('/', guard, async (request, reply) => {
        const { tenantId } = request.user;
        const body = createSchema.parse(request.body);
        const url = await checkUrl(body.url);

        const count = await fastify.prisma.webhookSubscription.count({ where: { tenantId, ...USER_MANAGED } });
        if (count >= MAX_SUBSCRIPTIONS_PER_TENANT) {
            throw fastify.httpErrors.conflict(`You can have at most ${MAX_SUBSCRIPTIONS_PER_TENANT} webhooks`);
        }
        const secret = newSecret();
        const subscription = await fastify.prisma.webhookSubscription.create({
            data: { tenantId, url, events: body.events, description: body.description ?? null, secretEnc: encrypt(secret) },
            select: PUBLIC_SELECT,
        });
        await auditSub(request, 'webhooks.created', subscription.id, { url, events: body.events });
        reply.code(201);
        return { subscription, secret };
    });

    // PATCH /webhooks/:id
    fastify.patch('/:id', guard, async (request) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        const body = updateSchema.parse(request.body);
        await findOwned(tenantId, id);
        const data: Record<string, unknown> = {};
        if (body.url !== undefined) data.url = await checkUrl(body.url);
        if (body.events !== undefined) data.events = body.events;
        if (body.description !== undefined) data.description = body.description;
        if (body.isActive !== undefined) data.isActive = body.isActive;
        await fastify.prisma.webhookSubscription.updateMany({ where: { id, tenantId }, data });
        await auditSub(request, 'webhooks.updated', id, { fields: Object.keys(data) });
        return { subscription: await findOwned(tenantId, id) };
    });

    // POST /webhooks/:id/rotate-secret - the old secret stops working immediately
    fastify.post('/:id/rotate-secret', guard, async (request) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        await findOwned(tenantId, id);
        const secret = newSecret();
        await fastify.prisma.webhookSubscription.updateMany({ where: { id, tenantId }, data: { secretEnc: encrypt(secret) } });
        await auditSub(request, 'webhooks.secret_rotated', id);
        return { subscription: await findOwned(tenantId, id), secret };
    });

    // DELETE /webhooks/:id
    fastify.delete('/:id', guard, async (request, reply) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        await findOwned(tenantId, id);
        await fastify.prisma.webhookSubscription.deleteMany({ where: { id, tenantId } });
        await auditSub(request, 'webhooks.deleted', id);
        return reply.code(204).send();
    });

    // POST /webhooks/:id/test - queue a webhook.test delivery
    fastify.post('/:id/test', { ...guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        const sub = await findOwned(tenantId, id);
        if (!sub.isActive) throw fastify.httpErrors.conflict('Enable the webhook before sending a test');
        const { eventId } = await publishTestEvent(fastify.prisma, { tenantId, subscriptionId: id });
        reply.code(202);
        return { eventId };
    });

    // GET /webhooks/:id/deliveries - recent delivery attempts (no response bodies are kept)
    fastify.get('/:id/deliveries', guard, async (request) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        const { limit } = listQuery.parse(request.query);
        await findOwned(tenantId, id);
        const deliveries = await fastify.prisma.webhookDelivery.findMany({
            where: { tenantId, subscriptionId: id },
            select: {
                id: true, eventId: true, status: true, attempts: true, nextAttemptAt: true,
                lastStatusCode: true, lastError: true, createdAt: true, deliveredAt: true,
                event: { select: { type: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return { deliveries };
    });
};

export default webhooksRoutes;
