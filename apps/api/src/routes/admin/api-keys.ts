/**
 * Platform admin control room for an organisation's API keys.
 *
 *   GET  /admin/organisations/:id/api-keys                   tenants:read
 *   POST /admin/organisations/:id/api-keys/:keyId/revoke     apikeys:revoke  { reason }
 *   POST /admin/organisations/:id/api-keys/revoke-all        apikeys:revoke  { reason }
 *
 * The listing never carries a hash or secret (the service selects neither).
 * Every revoke is audited with the acting admin and the reason, and the
 * organisation is told in-app, because its integrations stop working.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { createNotification } from '../../services/notifications.js';
import { listApiKeysForAdmin, revokeAllApiKeys, revokeApiKey } from '../../services/api-keys.js';
import { adminActor, adminGuard } from './guard.js';

const orgParams = z.object({ id: z.string().min(1).max(64) });
const keyParams = z.object({ id: z.string().min(1).max(64), keyId: z.string().min(1).max(64) });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

const MAX_LISTED = 200;

async function requireTenant(fastify: FastifyInstance, id: string): Promise<{ id: string; name: string }> {
    const tenant = await fastify.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');
    return tenant;
}

/** Best effort: a failed notification must never undo or fail a revoke that already happened. */
async function notifyOwner(fastify: FastifyInstance, request: FastifyRequest, tenantId: string, message: string): Promise<void> {
    try {
        await createNotification(
            fastify.prisma,
            {
                tenantId,
                type: 'SYSTEM',
                title: 'API keys revoked by Bookly',
                message,
                metadata: { kind: 'api_key.admin_revoked' },
            },
            request.log,
        );
    } catch (err) {
        request.log.warn({ err, tenantId }, 'api key revoke notification failed');
    }
}

const adminApiKeyRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /admin/organisations/:id/api-keys
    fastify.get('/organisations/:id/api-keys', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = orgParams.parse(request.params);
        await requireTenant(fastify, id);

        const keys = await listApiKeysForAdmin(fastify.prisma, id, MAX_LISTED);
        const creatorIds = [...new Set(keys.map((k) => k.createdBy).filter((v): v is string => !!v))];
        const creators: Array<{ id: string; name: string; email: string }> = creatorIds.length
            ? await fastify.prisma.user.findMany({
                where: { tenantId: id, id: { in: creatorIds } },
                select: { id: true, name: true, email: true },
            })
            : [];
        const byId = new Map(creators.map((u) => [u.id, u]));

        return {
            data: keys.map((k) => ({
                ...k,
                createdBy: k.createdBy ? { id: k.createdBy, name: byId.get(k.createdBy)?.name ?? null, email: byId.get(k.createdBy)?.email ?? null } : null,
            })),
        };
    });

    // POST /admin/organisations/:id/api-keys/:keyId/revoke
    fastify.post('/organisations/:id/api-keys/:keyId/revoke', { preHandler: adminGuard(fastify, 'apikeys:revoke') }, async (request) => {
        const { id, keyId } = keyParams.parse(request.params);
        const { reason } = reasonBody.parse(request.body);
        await requireTenant(fastify, id);

        const outcome = await revokeApiKey(fastify.prisma, id, keyId);
        if (outcome === 'not_found') throw fastify.httpErrors.notFound('API key not found');
        if (outcome === 'already_revoked') return { data: { id: keyId, revoked: false } };

        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'api_key.admin_revoked',
            tenantId: id,
            targetType: 'API_KEY',
            targetId: keyId,
            metadata: { reason },
        });
        await notifyOwner(fastify, request, id, `Bookly support revoked one of your API keys. Reason: ${reason}. Create a new key under Settings > Developer if you still need it.`);
        return { data: { id: keyId, revoked: true } };
    });

    // POST /admin/organisations/:id/api-keys/revoke-all
    fastify.post('/organisations/:id/api-keys/revoke-all', { preHandler: adminGuard(fastify, 'apikeys:revoke') }, async (request) => {
        const { id } = orgParams.parse(request.params);
        const { reason } = reasonBody.parse(request.body);
        await requireTenant(fastify, id);

        const count = await revokeAllApiKeys(fastify.prisma, id);
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'api_key.admin_revoked_all',
            tenantId: id,
            targetType: 'TENANT',
            targetId: id,
            metadata: { reason, count },
        });
        if (count > 0) {
            await notifyOwner(fastify, request, id, `Bookly support revoked all ${count} of your API keys. Reason: ${reason}. Create new keys under Settings > Developer when you are ready.`);
        }
        return { data: { revoked: count } };
    });
};

export default adminApiKeyRoutes;
