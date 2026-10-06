/**
 * Developer settings (D2): API keys and the external app. Register with
 * `{ prefix: '/developer' }`. Dashboard-authenticated (JWT) and OWNER only:
 * an API key can read customer data and send as the business, so handing one
 * out is an owner decision. Every query is scoped to the caller's tenant.
 *
 * Secrets: an API key's full value and an external app's signing secret are
 * returned exactly once (create / rotate) and are never readable again. Neither
 * is ever written to the audit log.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import {
    API_KEY_SCOPES,
    ApiKeyError,
    createApiKey,
    listApiKeys,
    revokeApiKey,
} from '../../services/api-keys.js';
import {
    deleteExternalApp,
    getExternalApp,
    rotateExternalAppSecret,
    saveExternalApp,
} from '../../services/external-app.js';
import { UnsafeUrlError, validateWebhookUrl } from '../../services/events/ssrf.js';

const SCOPE_DESCRIPTIONS: Record<(typeof API_KEY_SCOPES)[number], string> = {
    'messages:write': 'Send messages into existing conversations',
    'conversations:read': 'List conversations and read their messages',
    'conversations:write': 'Hand conversations to a person and back to the assistant',
    'customers:read': 'Read customer records',
    'customers:write': 'Create and update customer records',
    'payments:write': 'Create payment links on your own Paystack account',
};

const createKeyBody = z
    .object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length) })
    .strict();

const idParams = z.object({ id: z.string().min(1).max(64) }).strict();

const externalAppBody = z
    .object({
        name: z.string().trim().min(1).max(80),
        url: z.string().trim().min(1).max(2000),
        isActive: z.boolean().optional(),
    })
    .strict();

const developerRoutes: FastifyPluginAsync = async (fastify) => {
    const ownerOnly = async (request: FastifyRequest) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the owner can manage developer settings');
        }
    };
    const guard = { preHandler: [fastify.authenticate, ownerOnly] };

    const record = (request: FastifyRequest, action: string, targetType: string, targetId: string | null, metadata?: Record<string, unknown>) =>
        audit({
            prisma: fastify.prisma,
            action,
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            targetType,
            targetId,
            metadata,
            ipAddress: request.ip,
        });

    // GET /developer/scopes
    fastify.get('/scopes', guard, async () => ({
        data: API_KEY_SCOPES.map((scope) => ({ scope, description: SCOPE_DESCRIPTIONS[scope] })),
    }));

    // GET /developer/api-keys
    fastify.get('/api-keys', guard, async (request) => ({
        data: await listApiKeys(fastify.prisma, request.user.tenantId),
    }));

    // POST /developer/api-keys - the full key is in this response and nowhere else, ever
    fastify.post('/api-keys', guard, async (request, reply) => {
        const { tenantId, userId } = request.user;
        const body = createKeyBody.parse(request.body);
        try {
            const { key, apiKey } = await createApiKey(fastify.prisma, { tenantId, name: body.name, scopes: body.scopes, createdBy: userId });
            await record(request, 'api_key.created', 'API_KEY', apiKey.id, { name: apiKey.name, prefix: apiKey.prefix, scopes: apiKey.scopes });
            reply.code(201);
            return { data: { key, apiKey } };
        } catch (err) {
            if (err instanceof ApiKeyError) {
                if (err.code === 'key_limit_reached') throw fastify.httpErrors.conflict(err.message);
                throw fastify.httpErrors.badRequest(err.message);
            }
            throw err;
        }
    });

    // DELETE /developer/api-keys/:id - revoke (idempotent)
    fastify.delete('/api-keys/:id', guard, async (request) => {
        const { tenantId } = request.user;
        const { id } = idParams.parse(request.params);
        const outcome = await revokeApiKey(fastify.prisma, tenantId, id);
        if (outcome === 'not_found') throw fastify.httpErrors.notFound('API key not found');
        if (outcome === 'revoked') await record(request, 'api_key.revoked', 'API_KEY', id);
        return { data: { id, revoked: true } };
    });

    // GET /developer/external-app
    fastify.get('/external-app', guard, async (request) => ({
        data: await getExternalApp(fastify.prisma, request.user.tenantId),
    }));

    // PUT /developer/external-app - create or update; secret shown once, on creation
    fastify.put('/external-app', guard, async (request) => {
        const { tenantId } = request.user;
        const body = externalAppBody.parse(request.body);

        let url: string;
        try {
            // Syntax + SSRF check now for fast feedback; delivery re-checks at send time.
            url = (await validateWebhookUrl(body.url)).toString();
        } catch (err) {
            if (err instanceof UnsafeUrlError) throw fastify.httpErrors.badRequest(err.message);
            throw err;
        }

        const { app, signingSecret } = await saveExternalApp(fastify.prisma, tenantId, { name: body.name, url, isActive: body.isActive });
        await record(request, 'external_app.saved', 'EXTERNAL_APP', null, { name: app.name, url: app.url, isActive: app.isActive, created: !!signingSecret });
        return { data: signingSecret ? { ...app, signingSecret } : app };
    });

    // POST /developer/external-app/rotate-secret
    fastify.post('/external-app/rotate-secret', guard, async (request) => {
        const { tenantId } = request.user;
        const signingSecret = await rotateExternalAppSecret(fastify.prisma, tenantId);
        if (!signingSecret) throw fastify.httpErrors.notFound('No external app is configured');
        await record(request, 'external_app.secret_rotated', 'EXTERNAL_APP', null);
        return { data: { signingSecret } };
    });

    // DELETE /developer/external-app
    fastify.delete('/external-app', guard, async (request) => {
        await deleteExternalApp(fastify.prisma, request.user.tenantId);
        await record(request, 'external_app.deleted', 'EXTERNAL_APP', null);
        return { data: { deleted: true } };
    });
};

export default developerRoutes;
