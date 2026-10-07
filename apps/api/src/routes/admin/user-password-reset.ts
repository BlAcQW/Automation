/**
 * Platform admin: help an organisation user back into their account.
 *
 *   POST /admin/tenants/:id/users/:userId/password-reset/email   users:write       (OWNER, SUPPORT)
 *   POST /admin/tenants/:id/users/:userId/password-reset/link    users:reset_link  (OWNER)
 *   GET  /admin/password-reset/link-options                      users:reset_link  (OWNER)
 *
 * "email" sends the same message, token and Bookly link as the public
 * forgot-password form. "link" returns a one-hour link for the admin to pass
 * on by hand (WhatsApp); whoever holds it can set the user's password, so it
 * is OWNER-only, rate-limited, audited, never stored, never logged, and never
 * written into the audit metadata (only the origin it points at is).
 *
 * Admins never see or set the password itself. These routes authenticate
 * with an ADMIN token only (guard.ts); an organisation or support-session
 * token is a different JWT and gets 401.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { issueResetLink, resetLinkConfig, sendResetEmail } from '../../services/password-reset-delivery.js';
import { defaultResetBase, resetLinkOptions, resolveResetBase } from '../../services/reset-link.js';
import { config } from '../../config/index.js';
import { adminActor, adminGuard } from './guard.js';

const params = z.object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) });
const linkBody = z.object({ resetUrl: z.string().max(2048).optional() }).strict();

/** 5 per 10 minutes per admin per target user, keyed after the guard. */
const perAdminAndUser = (action: string) => ({
    rateLimit: {
        max: 5,
        timeWindow: '10 minutes',
        hook: 'preHandler' as const,
        keyGenerator: (req: FastifyRequest) =>
            `admin:${req.admin?.adminId ?? req.ip}:user:${(req.params as { userId?: string })?.userId ?? '-'}:${action}`,
    },
});

/** The user, only if they belong to this organisation and both are active. */
async function loadTarget(fastify: FastifyInstance, tenantId: string, userId: string) {
    const user = await fastify.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: {
            id: true, tenantId: true, name: true, email: true, passwordHash: true, isActive: true,
            tenant: { select: { isActive: true } },
        },
    });
    if (!user) throw fastify.httpErrors.notFound('User not found in this organisation');
    if (!user.tenant.isActive) throw fastify.httpErrors.conflict('This organisation is deactivated. Reactivate it first.');
    if (!user.isActive) throw fastify.httpErrors.conflict('This user is deactivated. Reactivate them first.');
    return user;
}

const userPasswordResetRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/tenants/:id/users/:userId/password-reset/email', {
        preHandler: adminGuard(fastify, 'users:write'),
        config: perAdminAndUser('reset-email'),
    }, async (request) => {
        const { id, userId } = params.parse(request.params);
        const user = await loadTarget(fastify, id, userId);

        const { link } = issueResetLink(user, defaultResetBase(config.frontendUrl));
        const sent = await sendResetEmail(user, link, request.log);
        if (!sent.ok) {
            throw Object.assign(
                fastify.httpErrors.serviceUnavailable('The reset email could not be sent right now. Try again in a few minutes, or copy a reset link instead.'),
                { publicCode: 'RESET_EMAIL_NOT_SENT' },
            );
        }

        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'auth.password_reset.admin_sent',
            tenantId: user.tenantId,
            targetType: 'User',
            targetId: user.id,
            metadata: { delivery: 'email' },
        });
        return { success: true, email: user.email };
    });

    fastify.post('/tenants/:id/users/:userId/password-reset/link', {
        preHandler: adminGuard(fastify, 'users:reset_link'),
        config: perAdminAndUser('reset-link'),
    }, async (request, reply) => {
        const { id, userId } = params.parse(request.params);
        const body = linkBody.parse(request.body ?? {});
        const user = await loadTarget(fastify, id, userId);

        // Same rule as /auth/forgot-password, but an admin is told when the
        // page they picked is not allowed instead of silently falling back.
        const target = resolveResetBase(body.resetUrl, resetLinkConfig());
        if (body.resetUrl && !target.custom) {
            throw fastify.httpErrors.badRequest('That reset page is not on an allowed origin (https and listed in CORS_ORIGINS).');
        }

        const issued = issueResetLink(user, target.base);
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'auth.password_reset.admin_link_created',
            tenantId: user.tenantId,
            targetType: 'User',
            targetId: user.id,
            metadata: { resetOrigin: new URL(target.base).origin },
        });

        reply.header('Cache-Control', 'no-store');
        return { link: issued.link, expiresAt: issued.expiresAt.toISOString() };
    });

    fastify.get('/password-reset/link-options', {
        preHandler: adminGuard(fastify, 'users:reset_link'),
    }, async () => ({ data: resetLinkOptions(resetLinkConfig()) }));
};

export default userPasswordResetRoutes;
