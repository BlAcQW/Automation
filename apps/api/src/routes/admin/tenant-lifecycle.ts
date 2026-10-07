/**
 * Organisation lifecycle (admin): deactivate, reactivate, delete-check and
 * permanent delete.
 *
 * Permissions
 *   deactivate / reactivate / delete   tenants:delete  (OWNER only)
 *   delete-check                       tenants:read
 * Deactivation locks a whole business out (sign-in, the bot, API keys), so it
 * stays with the same OWNER-only permission the old DELETE route used rather
 * than widening to SUPPORT's tenants:write; SUPPORT has the outbound switch for
 * emergencies. Reactivation undoes an OWNER decision, so it is OWNER-only too.
 * `DELETE /admin/tenants/:id` is kept as a back-compat alias of deactivate.
 *
 * What an inactive organisation can no longer do: sign in or refresh, use an
 * access token it already holds (plugins/auth.ts, cached <= 30 s), use its API
 * keys, receive bot replies (inbound WhatsApp/Messenger/Instagram messages are
 * not processed) or send anything (outbound reservation refuses as paused).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { createNotification } from '../../services/notifications.js';
import { disconnectWhatsapp } from '../../services/whatsapp-connection.js';
import { disconnectFacebookPage, unlinkInstagram } from '../../services/facebook-connection.js';
import { forgetTenantActive } from '../../services/tenant-active.js';
import { checkTenantDeletion, confirmNameMatches, deleteTenantPermanently, type DeleteBlocker } from '../../services/tenant-lifecycle.js';
import { adminActor, adminGuard } from './guard.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const deleteBody = z.object({
    confirmName: z.string().max(200),
    reason: z.string().trim().min(3).max(300),
}).strict();

const LEGACY_DELETE_REASON = 'Deactivated through DELETE /admin/tenants/:id';

function parseOr400<T>(fastify: FastifyInstance, schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
        throw fastify.httpErrors.badRequest(parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }
    return parsed.data;
}

/** Best effort: a failed notification never undoes what already happened. */
async function notifyOrganisation(fastify: FastifyInstance, request: FastifyRequest, tenantId: string, title: string, message: string, kind: string) {
    try {
        await createNotification(fastify.prisma, { tenantId, type: 'SYSTEM', title, message, metadata: { kind } }, request.log);
    } catch (err) {
        request.log.warn({ err, tenantId, kind }, 'organisation lifecycle notification failed');
    }
}

async function setActive(fastify: FastifyInstance, request: FastifyRequest, id: string, active: boolean, reason: string) {
    const existing = await fastify.prisma.tenant.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!existing) throw fastify.httpErrors.notFound('Organisation not found');
    forgetTenantActive(id);
    if (existing.isActive === active) return { id, isActive: active, changed: false };

    await fastify.prisma.tenant.update({ where: { id }, data: { isActive: active } });
    await audit({
        prisma: fastify.prisma,
        ...adminActor(request),
        action: active ? 'tenant.reactivated' : 'tenant.deactivated',
        tenantId: id,
        targetType: 'Tenant',
        targetId: id,
        metadata: { reason, wasActive: existing.isActive },
    });
    await notifyOrganisation(fastify, request, id,
        active ? 'Your organisation was reactivated' : 'Your organisation was deactivated',
        active
            ? `Bookly reactivated your organisation. Reason: ${reason}. Sign-in, the bot and your API keys work again.`
            : `Bookly deactivated your organisation. Reason: ${reason}. Sign-in, the bot, outgoing messages and API keys are stopped until it is reactivated. Contact Bookly support if this is unexpected.`,
        active ? 'tenant.reactivated' : 'tenant.deactivated');
    return { id, isActive: active, changed: true };
}

type CleanupResult = string;

/**
 * Stop Meta sending us this organisation's webhooks, BEFORE the rows go.
 * Best effort: every failure is logged and recorded, never fatal.
 */
async function disconnectChannels(
    fastify: FastifyInstance,
    request: FastifyRequest,
    t: { id: string; whatsappPhoneNumberId: string | null; facebookPageId: string | null; instagramUserId: string | null },
): Promise<Record<string, CleanupResult>> {
    const result: Record<string, CleanupResult> = { whatsapp: 'none', facebook: 'none', instagram: 'none' };
    const attempt = async (key: string, run: () => Promise<CleanupResult>) => {
        try {
            result[key] = await run();
        } catch (err) {
            result[key] = 'failed';
            request.log.error({ tenantId: t.id, channel: key, reason: (err as Error).message }, 'channel cleanup before organisation delete failed');
        }
    };
    if (t.whatsappPhoneNumberId) {
        await attempt('whatsapp', async () => (await disconnectWhatsapp(fastify.prisma, t.id, request.log)).metaCleanup);
    }
    if (t.facebookPageId) {
        // Clears the Page AND the Instagram account that rides on it.
        await attempt('facebook', async () => (await disconnectFacebookPage(fastify.prisma, t.id, request.log)).metaCleanup);
        if (t.instagramUserId) result.instagram = 'cleared_with_page';
    } else if (t.instagramUserId) {
        await attempt('instagram', async () => { await unlinkInstagram(fastify.prisma, t.id); return 'unlinked'; });
    }
    return result;
}

const conflictBody = (message: string, blockers: DeleteBlocker[]) => ({ statusCode: 409, error: 'Conflict', message, blockers });

const tenantLifecycleRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/tenants/:id/deactivate', { preHandler: adminGuard(fastify, 'tenants:delete') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = parseOr400(fastify, reasonBody, request.body);
        return { data: await setActive(fastify, request, id, false, reason) };
    });

    fastify.post('/tenants/:id/reactivate', { preHandler: adminGuard(fastify, 'tenants:delete') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = parseOr400(fastify, reasonBody, request.body);
        return { data: await setActive(fastify, request, id, true, reason) };
    });

    // Back-compat: the old soft delete. Same handler as /deactivate.
    fastify.delete('/tenants/:id', { preHandler: adminGuard(fastify, 'tenants:delete') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const body = request.body as { reason?: unknown } | undefined;
        const reason = typeof body?.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim().slice(0, 300) : LEGACY_DELETE_REASON;
        await setActive(fastify, request, id, false, reason);
        return { success: true };
    });

    fastify.get('/tenants/:id/delete-check', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const check = await checkTenantDeletion(fastify.prisma, id);
        if (!check) throw fastify.httpErrors.notFound('Organisation not found');
        return { data: { canDelete: check.canDelete, blockers: check.blockers, counts: check.counts } };
    });

    fastify.post('/tenants/:id/delete', {
        preHandler: adminGuard(fastify, 'tenants:delete'),
        config: {
            // After the guard (hook: preHandler) so the key is the signed-in admin.
            rateLimit: {
                max: 5,
                timeWindow: '10 minutes',
                hook: 'preHandler',
                keyGenerator: (req: FastifyRequest) => `admin:${req.admin?.adminId ?? req.ip}:tenant-delete`,
            },
        },
    }, async (request, reply) => {
        const { id } = idParam.parse(request.params);
        const body = parseOr400(fastify, deleteBody, request.body);

        const t = await fastify.prisma.tenant.findUnique({
            where: { id },
            select: { id: true, name: true, isActive: true, whatsappPhoneNumberId: true, facebookPageId: true, instagramUserId: true },
        });
        if (!t) throw fastify.httpErrors.notFound('Organisation not found');
        if (!confirmNameMatches(body.confirmName, t.name)) {
            throw fastify.httpErrors.badRequest('The organisation name you typed does not match');
        }

        const check = await checkTenantDeletion(fastify.prisma, id);
        if (!check) throw fastify.httpErrors.notFound('Organisation not found');
        if (!check.canDelete) {
            return reply.code(409).send(conflictBody('This organisation cannot be deleted', check.blockers));
        }

        const cleanup = await disconnectChannels(fastify, request, t);
        const actor = adminActor(request);
        let outcome: Awaited<ReturnType<typeof deleteTenantPermanently>>;
        try {
            outcome = await deleteTenantPermanently(fastify.prisma, {
                tenantId: id, adminId: actor.actorId, reason: body.reason, ipAddress: actor.ipAddress, cleanup,
            });
        } catch (err) {
            // Serializable transaction lost to a concurrent write on the same rows.
            if ((err as { code?: string }).code === 'P2034') {
                throw fastify.httpErrors.conflict('The organisation changed while it was being deleted. Check it and try again.');
            }
            throw err;
        }
        if (!outcome.ok) {
            if (outcome.reason === 'not_found') throw fastify.httpErrors.notFound('Organisation not found');
            // Something changed between the check and the transaction (a payment, a reactivation).
            await audit({
                prisma: fastify.prisma, ...actor, action: 'tenant.delete_refused', tenantId: id, targetType: 'Tenant', targetId: id,
                metadata: { reason: body.reason, blockers: outcome.blockers.map((b) => b.code), cleanup },
            });
            return reply.code(409).send(conflictBody('This organisation cannot be deleted', outcome.blockers));
        }
        forgetTenantActive(id);
        request.log.warn({ tenantId: id, adminId: actor.actorId }, 'organisation permanently deleted');
        return { data: { deleted: true, id, name: t.name, counts: outcome.check.counts, cleanup } };
    });
};

export default tenantLifecycleRoutes;
