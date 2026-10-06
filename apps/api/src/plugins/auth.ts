import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwtPlugin from '@fastify/jwt';
import { config } from '../config/index.js';
import { bindTenantContext, tenantContextOnRequest } from '../lib/tenant-context.js';
import { resolveAdminRole, type AdminRole } from '../services/admin-permissions.js';
import { checkSupportEntitlement, findLiveSession, isSupportReadRoute } from '../services/support-session.js';
import { isTwoFactorRequired } from '../services/admin-totp.js';

// =============================================================
// Type augmentation
// =============================================================

declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest) => Promise<void>;
        authenticateAdmin: (request: FastifyRequest) => Promise<void>;
    }
    interface FastifyRequest {
        admin?: {
            adminId: string;
            /** @deprecated legacy flag; authorise on `role`. */
            isSuperAdmin: boolean;
            role: AdminRole;
            /** True once the admin has a verified TOTP enrolment. */
            totpEnabled: boolean;
        };
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            userId: string;
            tenantId: string;
            role: 'OWNER' | 'STAFF';
            /** 'support' = a read-only platform-admin support token (A5). */
            type: 'access' | 'refresh' | 'support';
            support?: { sessionId: string; adminId: string };
        };
        user: {
            userId: string;
            tenantId: string;
            role: 'OWNER' | 'STAFF';
            /** Set only for support-access requests: who is really behind them. */
            support?: { sessionId: string; adminId: string };
        };
    }
}

export interface AdminJWTPayload {
    adminId: string;
    type: 'admin_access' | 'admin_refresh';
    /** Refresh tokens only: unique id, so a logged-out token can be refused. */
    jti?: string;
    /** Refresh tokens only: the sign-in this token descends from; reuse revokes the whole family. */
    fam?: string;
}

// =============================================================
// Plugin
// =============================================================

const authPlugin: FastifyPluginAsync = async (fastify) => {
    // Open the per-request tenant-context store before any auth hook runs.
    // bindTenantContext() below mutates it; webhook/public routes never bind,
    // so they keep an empty store (guard: allow).
    fastify.addHook('onRequest', tenantContextOnRequest);

    // User token namespace (default). Backwards-compatible decorators:
    //   request.jwtVerify(), fastify.jwt.sign(...)
    await fastify.register(jwtPlugin, {
        secret: config.jwtSecret,
        sign: { expiresIn: config.jwtExpiresIn },
    });

    // Admin token namespace. Decorators are:
    //   request.adminJwtVerify(), (fastify as any).jwt.admin.sign(...)
    // Signed with a SEPARATE secret so a forged user token cannot impersonate
    // an admin.
    await fastify.register(jwtPlugin, {
        namespace: 'admin',
        secret: config.adminJwtSecret,
        sign: { expiresIn: config.jwtExpiresIn },
    });

    // Tenant user authentication. Also accepts a support token (A5): a
    // platform admin's time-boxed, READ-ONLY view of one tenant.
    fastify.decorate('authenticate', async (request: FastifyRequest) => {
        let decoded: {
            userId: string;
            tenantId: string;
            role: 'OWNER' | 'STAFF';
            type: 'access' | 'refresh' | 'support';
            support?: { sessionId: string; adminId: string };
        };
        try {
            decoded = (await request.jwtVerify()) as unknown as typeof decoded;
        } catch {
            throw fastify.httpErrors.unauthorized('Invalid or expired token');
        }

        if (decoded.type === 'support') {
            await authenticateSupport(request, decoded);
            return;
        }

        try {
            if (decoded.type !== 'access') {
                throw new Error('Invalid token type');
            }
            request.user = {
                userId: decoded.userId,
                tenantId: decoded.tenantId,
                role: decoded.role,
            };
            // Bind tenant context for the rest of this request — used by the
            // Prisma $extends guard to detect cross-tenant query attempts.
            bindTenantContext({
                tenantId: decoded.tenantId,
                userId: decoded.userId,
            });
            // Carry tenantId / userId / requestId on every log line.
            request.log = request.log.child({
                tenantId: decoded.tenantId,
                userId: decoded.userId,
            });
        } catch {
            throw fastify.httpErrors.unauthorized('Invalid or expired token');
        }
    });

    /**
     * Support access. Rules, in order:
     *  1. Read-only: anything but GET is refused (and the attempt audited).
     *  2. Deny by default: only the resolved routes on SUPPORT_READ_ROUTES are
     *     reachable (matched on `request.routeOptions.url`, never the raw
     *     path). Anything else is refused and audited.
     *  3. The session must still be live FOR THE TOKEN'S TENANT, belong to the
     *     admin the token names, and that admin must still be active, still
     *     hold support:access and satisfy the 2FA-required policy, checked on
     *     every request so ending a session or demoting an admin cuts access
     *     immediately.
     *  4. Every request is audited BEFORE it runs. If the audit cannot be
     *     written the request is refused: no unaudited support access.
     */
    async function authenticateSupport(
        request: FastifyRequest,
        decoded: { userId: string; tenantId: string; role: 'OWNER' | 'STAFF'; support?: { sessionId: string; adminId: string } },
    ): Promise<void> {
        const claim = decoded.support;
        if (!claim?.sessionId || !claim.adminId || !decoded.tenantId) {
            throw fastify.httpErrors.unauthorized('Invalid or expired token');
        }
        // The resolved route PATTERN only. The raw URL can carry customer
        // phone numbers and refs, so it is never stored or matched.
        const route = request.routeOptions?.url;

        const deny = async (reason: string, message: string): Promise<never> => {
            await fastify.prisma.auditLog
                .create({
                    data: {
                        tenantId: decoded.tenantId,
                        actorType: 'ADMIN',
                        actorId: claim.adminId,
                        action: 'support.request_denied',
                        targetType: 'SupportSession',
                        targetId: claim.sessionId,
                        metadata: { method: request.method, route: route ?? '(unmatched)', reason },
                        ipAddress: request.ip,
                    },
                })
                .catch((err: unknown) => request.log.error({ err }, 'support denied-request audit failed'));
            throw fastify.httpErrors.forbidden(message);
        };

        if (request.method !== 'GET') await deny('read_only', 'Support access is read-only');
        if (!isSupportReadRoute(route)) await deny('route_not_allowed', 'Support access does not include this');

        const session = await findLiveSession(fastify.prisma, claim.sessionId, decoded.tenantId);
        if (!session || session.adminId !== claim.adminId) {
            throw fastify.httpErrors.unauthorized('Support session has ended');
        }

        const entitlement = checkSupportEntitlement(session.admin, await isTwoFactorRequired(fastify.prisma));
        if (!entitlement.ok) {
            if (entitlement.reason === 'two_factor_required') {
                await deny('two_factor_required', 'Two-factor authentication is required. Set it up under My account.');
            }
            throw fastify.httpErrors.unauthorized('Support session has ended');
        }

        try {
            await fastify.prisma.auditLog.create({
                data: {
                    tenantId: decoded.tenantId,
                    actorType: 'ADMIN',
                    actorId: claim.adminId,
                    action: 'support.request',
                    targetType: 'SupportSession',
                    targetId: claim.sessionId,
                    metadata: { method: request.method, route },
                    ipAddress: request.ip,
                },
            });
        } catch (err) {
            request.log.error({ err }, 'support request audit failed; refusing the request');
            throw fastify.httpErrors.serviceUnavailable('Support access is temporarily unavailable');
        }

        request.user = {
            userId: decoded.userId,
            tenantId: decoded.tenantId,
            role: decoded.role,
            support: { sessionId: claim.sessionId, adminId: claim.adminId },
        };
        bindTenantContext({ tenantId: decoded.tenantId, userId: decoded.userId });
        request.log = request.log.child({
            tenantId: decoded.tenantId,
            supportAdminId: claim.adminId,
            supportSessionId: claim.sessionId,
        });
    }

    // Admin authentication.
    // 1. Verifies the token against ADMIN_JWT_SECRET (not JWT_SECRET).
    // 2. Re-reads the admin row from DB. `isSuperAdmin` and `isActive` come
    //    `role` and `isActive` come from the row, never from the token claim,
    //    so a stolen-then-revoked admin or a demoted admin loses access
    //    immediately.
    fastify.decorate('authenticateAdmin', async (request: FastifyRequest) => {
        let decoded: AdminJWTPayload;
        try {
            decoded = await (request as any).adminJwtVerify();
        } catch {
            throw fastify.httpErrors.unauthorized('Invalid or expired admin token');
        }

        if (decoded.type !== 'admin_access') {
            throw fastify.httpErrors.unauthorized('Invalid admin token type');
        }

        const admin = await fastify.prisma.admin.findUnique({
            where: { id: decoded.adminId },
            select: { id: true, isSuperAdmin: true, isActive: true, role: true, totpEnabledAt: true },
        });

        if (!admin || !admin.isActive) {
            throw fastify.httpErrors.unauthorized('Admin account is not active');
        }

        // The role column decides; the legacy flag only fills in a missing one.
        const role = resolveAdminRole(admin);
        request.admin = {
            adminId: admin.id,
            isSuperAdmin: admin.isSuperAdmin,
            role,
            totpEnabled: !!admin.totpEnabledAt,
        };
        // Admin context — adminId set, tenantId omitted so the Prisma guard
        // knows this is a platform-admin call and skips the tenant filter check.
        bindTenantContext({
            adminId: admin.id,
        });
        request.log = request.log.child({
            adminId: admin.id,
            adminRole: role,
        });
    });
};

export default fp(authPlugin, {
    name: 'auth',
    dependencies: ['prisma'],
});

// =============================================================
// Token payload helpers
// =============================================================

export function generateTokenPayload(
    userId: string,
    tenantId: string,
    role: 'OWNER' | 'STAFF',
    type: 'access' | 'refresh',
) {
    return { userId, tenantId, role, type };
}

export function generateAdminTokenPayload(
    adminId: string,
    type: 'admin_access' | 'admin_refresh',
    jti?: string,
    fam?: string,
): AdminJWTPayload {
    return { adminId, type, ...(jti ? { jti } : {}), ...(fam ? { fam } : {}) };
}
