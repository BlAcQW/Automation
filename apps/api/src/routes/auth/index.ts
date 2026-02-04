import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateTokenPayload } from '../../plugins/auth.js';
import { config } from '../../config/index.js';

// Validation schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
    businessName: z.string().min(2),
    businessType: z.enum(['PRODUCT', 'SERVICE']),
    timezone: z.string().default('UTC'),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

const authRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /auth/register - Create new tenant + owner user
    fastify.post('/register', async (request, reply) => {
        const body = registerSchema.parse(request.body);

        // Check if email already exists
        const existingUser = await fastify.prisma.user.findUnique({
            where: { email: body.email },
        });

        if (existingUser) {
            throw fastify.httpErrors.conflict('Email already registered');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(body.password, 12);

        // Create tenant and user in a transaction
        const result = await fastify.prisma.$transaction(async (tx) => {
            // Create tenant
            const tenant = await tx.tenant.create({
                data: {
                    name: body.businessName,
                    businessType: body.businessType,
                    timezone: body.timezone,
                },
            });

            // Create owner user
            const user = await tx.user.create({
                data: {
                    tenantId: tenant.id,
                    email: body.email,
                    passwordHash,
                    name: body.name,
                    role: 'OWNER',
                },
            });

            // Create default working hours (Mon-Fri 9-17)
            const defaultHours = [1, 2, 3, 4, 5].map((day) => ({
                tenantId: tenant.id,
                dayOfWeek: day,
                startTime: '09:00',
                endTime: '17:00',
            }));

            await tx.workingHours.createMany({
                data: defaultHours,
            });

            return { tenant, user };
        });

        // Generate tokens
        const accessToken = fastify.jwt.sign(
            generateTokenPayload(result.user.id, result.tenant.id, 'OWNER', 'access'),
            { expiresIn: config.jwtExpiresIn }
        );

        const refreshToken = fastify.jwt.sign(
            generateTokenPayload(result.user.id, result.tenant.id, 'OWNER', 'refresh'),
            { expiresIn: config.jwtRefreshExpiresIn }
        );

        // Set refresh token as HTTP-only cookie
        reply.setCookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            path: '/auth',
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return {
            user: {
                id: result.user.id,
                email: result.user.email,
                name: result.user.name,
                role: result.user.role,
            },
            tenant: {
                id: result.tenant.id,
                name: result.tenant.name,
                businessType: result.tenant.businessType,
                timezone: result.tenant.timezone,
            },
            accessToken,
        };
    });

    // POST /auth/login - Login user
    fastify.post('/login', async (request, reply) => {
        const body = loginSchema.parse(request.body);

        // Find user by email
        const user = await fastify.prisma.user.findUnique({
            where: { email: body.email },
            include: { tenant: true },
        });

        if (!user || !user.isActive) {
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        // Verify password
        const validPassword = await bcrypt.compare(body.password, user.passwordHash);
        if (!validPassword) {
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        // Check tenant is active
        if (!user.tenant.isActive) {
            throw fastify.httpErrors.forbidden('Account has been disabled');
        }

        // Generate tokens
        const accessToken = fastify.jwt.sign(
            generateTokenPayload(user.id, user.tenantId, user.role, 'access'),
            { expiresIn: config.jwtExpiresIn }
        );

        const refreshToken = fastify.jwt.sign(
            generateTokenPayload(user.id, user.tenantId, user.role, 'refresh'),
            { expiresIn: config.jwtRefreshExpiresIn }
        );

        // Set refresh token as HTTP-only cookie
        reply.setCookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'lax',
            path: '/auth',
            maxAge: 7 * 24 * 60 * 60,
        });

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            tenant: {
                id: user.tenant.id,
                name: user.tenant.name,
                businessType: user.tenant.businessType,
                timezone: user.tenant.timezone,
            },
            accessToken,
        };
    });

    // GET /auth/me - Get current user
    fastify.get('/me', {
        preHandler: [fastify.authenticate],
    }, async (request) => {
        const user = await fastify.prisma.user.findUnique({
            where: { id: request.user.userId },
            include: { tenant: true },
        });

        if (!user) {
            throw fastify.httpErrors.notFound('User not found');
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            tenant: {
                id: user.tenant.id,
                name: user.tenant.name,
                businessType: user.tenant.businessType,
                timezone: user.tenant.timezone,
                whatsappConnected: !!user.tenant.whatsappPhoneNumberId,
            },
        };
    });

    // POST /auth/refresh - Refresh access token
    fastify.post('/refresh', async (request, reply) => {
        const refreshToken = request.cookies.refreshToken;

        if (!refreshToken) {
            throw fastify.httpErrors.unauthorized('No refresh token provided');
        }

        try {
            const decoded = fastify.jwt.verify(refreshToken) as {
                userId: string;
                tenantId: string;
                role: 'OWNER' | 'STAFF';
                type: string;
            };

            if (decoded.type !== 'refresh') {
                throw new Error('Invalid token type');
            }

            // Verify user still exists and is active
            const user = await fastify.prisma.user.findUnique({
                where: { id: decoded.userId },
                include: { tenant: true },
            });

            if (!user || !user.isActive || !user.tenant.isActive) {
                throw fastify.httpErrors.unauthorized('User or tenant is not active');
            }

            // Generate new access token
            const accessToken = fastify.jwt.sign(
                generateTokenPayload(user.id, user.tenantId, user.role, 'access'),
                { expiresIn: config.jwtExpiresIn }
            );

            return { accessToken };
        } catch (err) {
            reply.clearCookie('refreshToken', { path: '/auth' });
            throw fastify.httpErrors.unauthorized('Invalid refresh token');
        }
    });

    // POST /auth/logout - Clear refresh token
    fastify.post('/logout', async (request, reply) => {
        reply.clearCookie('refreshToken', { path: '/auth' });
        return { success: true };
    });
};

export default authRoutes;
