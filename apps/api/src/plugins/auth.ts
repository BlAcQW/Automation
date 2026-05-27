import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwtPlugin from '@fastify/jwt';
import { config } from '../config/index.js';
import { tenantContext } from '../lib/tenant-context.js';

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
            isSuperAdmin: boolean;
        };
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            userId: string;
            tenantId: string;
            role: 'OWNER' | 'STAFF';
            type: 'access' | 'refresh';
        };
        user: {
            userId: string;
            tenantId: string;
            role: 'OWNER' | 'STAFF';
        };
    }
}

export interface AdminJWTPayload {
    adminId: string;
    type: 'admin_access' | 'admin_refresh';
}

// =============================================================
// Plugin
// =============================================================

const authPlugin: FastifyPluginAsync = async (fastify) => {
    // User token namespace (default). Backwards-compatible decorators:
    //   request.jwtVerify(), fastify.jwt.sign(...)
    await fastify.register(jwtPlugin, {
        secret: config.jwtSecret,
        sign: { expiresIn: config.jwtExpiresIn },
    });

    // Admin token namespace. Decorators are:
    //   request.adminJwtVerify(), fastify.admin.jwt.sign(...)
    // Signed with a SEPARATE secret so a forged user token cannot impersonate
    // an admin.
    await fastify.register(jwtPlugin, {
        namespace: 'admin',
        secret: config.adminJwtSecret,
        sign: { expiresIn: config.jwtExpiresIn },
    });

    // Tenant user authentication.
    fastify.decorate('authenticate', async (request: FastifyRequest) => {
        try {
            const decoded = (await request.jwtVerify()) as unknown as {
                userId: string;
                tenantId: string;
                role: 'OWNER' | 'STAFF';
                type: 'access' | 'refresh';
            };
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
            tenantContext.enterWith({
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

    // Admin authentication.
    // 1. Verifies the token against ADMIN_JWT_SECRET (not JWT_SECRET).
    // 2. Re-reads the admin row from DB. `isSuperAdmin` and `isActive` come
    //    from the row, never from the token claim, so a stolen-then-revoked
    //    admin or a demoted super-admin loses access immediately.
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
            select: { id: true, isSuperAdmin: true, isActive: true },
        });

        if (!admin || !admin.isActive) {
            throw fastify.httpErrors.unauthorized('Admin account is not active');
        }

        request.admin = {
            adminId: admin.id,
            isSuperAdmin: admin.isSuperAdmin,
        };
        // Admin context — adminId set, tenantId omitted so the Prisma guard
        // knows this is a platform-admin call and skips the tenant filter check.
        tenantContext.enterWith({
            adminId: admin.id,
        });
        request.log = request.log.child({
            adminId: admin.id,
            isSuperAdmin: admin.isSuperAdmin,
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
): AdminJWTPayload {
    return { adminId, type };
}
