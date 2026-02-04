import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../config/index.js';

// Type declarations
declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest) => Promise<void>;
        authenticateAdmin: (request: FastifyRequest) => Promise<void>;
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

// Admin JWT payload
export interface AdminJWTPayload {
    adminId: string;
    isSuperAdmin: boolean;
    type: 'admin_access' | 'admin_refresh';
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
    // Register JWT plugin
    await fastify.register(import('@fastify/jwt'), {
        secret: config.jwtSecret,
        sign: {
            expiresIn: config.jwtExpiresIn,
        },
    });

    // User authentication decorator
    fastify.decorate('authenticate', async (request: FastifyRequest) => {
        try {
            const decoded = await request.jwtVerify();

            if (decoded.type !== 'access') {
                throw new Error('Invalid token type');
            }

            request.user = {
                userId: decoded.userId,
                tenantId: decoded.tenantId,
                role: decoded.role,
            };
        } catch (err) {
            throw fastify.httpErrors.unauthorized('Invalid or expired token');
        }
    });

    // Admin authentication decorator
    fastify.decorate('authenticateAdmin', async (request: FastifyRequest) => {
        try {
            const decoded = await request.jwtVerify() as unknown as AdminJWTPayload;

            if (decoded.type !== 'admin_access') {
                throw new Error('Invalid token type');
            }

            (request as any).admin = {
                adminId: decoded.adminId,
                isSuperAdmin: decoded.isSuperAdmin,
            };
        } catch (err) {
            throw fastify.httpErrors.unauthorized('Invalid or expired admin token');
        }
    });
};

export default fp(authPlugin, {
    name: 'auth',
    dependencies: [],
});

// Helper to generate tokens
export function generateTokenPayload(
    userId: string,
    tenantId: string,
    role: 'OWNER' | 'STAFF',
    type: 'access' | 'refresh'
) {
    return {
        userId,
        tenantId,
        role,
        type,
    };
}

export function generateAdminTokenPayload(
    adminId: string,
    isSuperAdmin: boolean,
    type: 'admin_access' | 'admin_refresh'
): AdminJWTPayload {
    return {
        adminId,
        isSuperAdmin,
        type,
    };
}
