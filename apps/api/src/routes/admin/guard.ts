import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorizeAdmin, type AdminPermission } from '../../services/admin-permissions.js';
import { isTwoFactorRequired } from '../../services/admin-totp.js';

/**
 * preHandler chain for an admin route: authenticate, then authorise the
 * admin's ROLE for the one permission the route names (see
 * services/admin-permissions.ts for the role map), then enforce the OWNER's
 * "everyone needs 2FA" policy.
 *
 * Under that policy an admin without 2FA can still sign in, but is refused
 * everything except `self` routes (their own account and 2FA enrolment) until
 * they enrol, so nobody is locked out of fixing it.
 *
 * A resolver function may be passed when the needed permission depends on the
 * request (e.g. which switch is being flipped); it must be pure and total.
 */
export function adminGuard(
    fastify: FastifyInstance,
    permissionOrResolver: AdminPermission | ((request: FastifyRequest) => AdminPermission),
) {
    const authorise = async (request: FastifyRequest) => {
        const permission = typeof permissionOrResolver === 'function' ? permissionOrResolver(request) : permissionOrResolver;
        const admin = request.admin;
        if (!admin) throw fastify.httpErrors.unauthorized('Not signed in');

        const verdict = authorizeAdmin(admin.role, permission, request.method);
        if (!verdict.ok) {
            request.log.warn({ permission, role: admin.role, reason: verdict.reason }, 'admin request refused by role');
            throw fastify.httpErrors.forbidden(
                verdict.reason === 'read_only_role'
                    ? 'Your admin role is read-only'
                    : 'Your admin role does not allow this',
            );
        }

        if (permission !== 'self' && !admin.totpEnabled && (await isTwoFactorRequired(fastify.prisma))) {
            throw fastify.httpErrors.forbidden('Two-factor authentication is required. Set it up under My account.');
        }
    };
    return [fastify.authenticateAdmin, authorise];
}

/** Admin audit helper: actor, IP and the common shape in one place. */
export const adminActor = (request: FastifyRequest) => ({
    actorType: 'ADMIN' as const,
    actorId: request.admin!.adminId,
    ipAddress: request.ip,
});
