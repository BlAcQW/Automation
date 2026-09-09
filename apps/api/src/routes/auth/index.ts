import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateTokenPayload } from '../../plugins/auth.js';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';

// Validation schemas. `businessType` is optional and defaults to SERVICE so
// older / SERVICE-only clients can omit it. The handler decides whether to
// honour a PRODUCT value below — gated by the ENABLE_PRODUCT_MODE flag.
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
    businessName: z.string().min(2),
    businessType: z.enum(['PRODUCT', 'SERVICE']).optional().default('SERVICE'),
    timezone: z.string().default('UTC'),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// Refresh-token transport differs by client:
//  - Web clients receive the refresh token as an HTTP-only cookie and the
//    browser replays it automatically (secure against XSS token theft).
//  - Native/mobile clients cannot persist cookies, so when they identify
//    themselves via `X-Client: mobile` we ALSO return the refresh token in the
//    JSON body and accept it back on /refresh from the body. Web behaviour is
//    unchanged because the web client never sends that header.
function isMobileClient(request: FastifyRequest): boolean {
    const header = request.headers['x-client'];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === 'string' && value.toLowerCase() === 'mobile';
}

// Read the refresh token from (1) the HTTP-only cookie (web) or (2) the JSON
// body `refreshToken` (mobile). Returns undefined when neither is present.
function extractRefreshToken(request: FastifyRequest): string | undefined {
    const cookieToken = request.cookies?.refreshToken;
    if (cookieToken) return cookieToken;

    const body = request.body as { refreshToken?: unknown } | undefined;
    if (body && typeof body.refreshToken === 'string' && body.refreshToken.length > 0) {
        return body.refreshToken;
    }

    return undefined;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /auth/register - Create new tenant + owner user
    fastify.post('/register', async (request, reply) => {
        const body = registerSchema.parse(request.body);

        // Email uniqueness is enforced per-tenant by the @@unique constraint.
        // A fresh registration creates its own tenant, so there is no conflict
        // to pre-check here.

        // Hash password
        const passwordHash = await bcrypt.hash(body.password, 12);

        // Create tenant and user in a transaction
        const TRIAL_DAYS = 14;
        const result = await fastify.prisma.$transaction(async (tx) => {
            // Create tenant. Phase 4b — every new tenant gets a 14-day Pro
            // trial. The lazy `evaluateSubscription` helper downgrades them
            // to Free + CANCELLED once `trialEndsAt` lapses unless they've
            // started a paid subscription.
            // When PRODUCT mode is parked, force every new tenant to SERVICE
            // regardless of what the client sent. The PRODUCT code stays in
            // place for the eventual relaunch.
            const businessType = config.featureFlags.productMode ? body.businessType : 'SERVICE';

            const now = new Date();
            const tenant = await tx.tenant.create({
                data: {
                    name: body.businessName,
                    businessType,
                    timezone: body.timezone,
                    planId: 'pro',
                    subscriptionStatus: 'TRIALING',
                    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
                    // Phase 4c — anchor the 30-day quota cycle to this signup
                    // time so the counter doesn't reset on the calendar 1st.
                    quotaCycleStart: now,
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
            path: '/',
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
            // Mobile clients can't use the cookie — hand them the refresh token.
            ...(isMobileClient(request) && { refreshToken }),
        };
    });

    // POST /auth/login - Login user
    fastify.post('/login', async (request, reply) => {
        const body = loginSchema.parse(request.body);

        // Find user by email. Email is unique per tenant; if multiple tenants
        // share an email, the first active match wins. Phase 2 will add a
        // tenant-selector or workspace slug to disambiguate cleanly.
        const user = await fastify.prisma.user.findFirst({
            where: { email: body.email, isActive: true },
            include: { tenant: true },
        });

        if (!user || !user.isActive) {
            await audit({
                prisma: fastify.prisma,
                action: 'auth.login.failure',
                actorType: 'USER',
                metadata: { email: body.email, reason: 'user_not_found_or_inactive' },
                ipAddress: request.ip,
            });
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        // Verify password
        const validPassword = await bcrypt.compare(body.password, user.passwordHash);
        if (!validPassword) {
            await audit({
                prisma: fastify.prisma,
                action: 'auth.login.failure',
                actorType: 'USER',
                tenantId: user.tenantId,
                actorId: user.id,
                metadata: { email: body.email, reason: 'bad_password' },
                ipAddress: request.ip,
            });
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }

        // Check tenant is active
        if (!user.tenant.isActive) {
            await audit({
                prisma: fastify.prisma,
                action: 'auth.login.failure',
                actorType: 'USER',
                tenantId: user.tenantId,
                actorId: user.id,
                metadata: { reason: 'tenant_inactive' },
                ipAddress: request.ip,
            });
            throw fastify.httpErrors.forbidden('Account has been disabled');
        }

        await audit({
            prisma: fastify.prisma,
            action: 'auth.login.success',
            actorType: 'USER',
            tenantId: user.tenantId,
            actorId: user.id,
            ipAddress: request.ip,
        });

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
            path: '/',
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
            // Mobile clients can't use the cookie — hand them the refresh token.
            ...(isMobileClient(request) && { refreshToken }),
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
                outOfWindowMessagesEnabled: user.tenant.outOfWindowMessagesEnabled,
            },
        };
    });

    // POST /auth/refresh - Refresh access token.
    // Accepts the refresh token from the HTTP-only cookie (web) or the JSON
    // body `{ refreshToken }` (mobile). Mobile clients also get a rotated
    // refresh token back in the body so long-lived sessions keep working.
    fastify.post('/refresh', async (request, reply) => {
        const refreshToken = extractRefreshToken(request);

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

            // For mobile clients, rotate the refresh token and return it in the
            // body (there is no cookie to update). Web clients keep their
            // existing cookie and just receive the new access token.
            if (isMobileClient(request)) {
                const rotatedRefreshToken = fastify.jwt.sign(
                    generateTokenPayload(user.id, user.tenantId, user.role, 'refresh'),
                    { expiresIn: config.jwtRefreshExpiresIn }
                );
                return { accessToken, refreshToken: rotatedRefreshToken };
            }

            return { accessToken };
        } catch (err) {
            reply.clearCookie('refreshToken', { path: '/' });
            throw fastify.httpErrors.unauthorized('Invalid refresh token');
        }
    });

    // POST /auth/logout - Clear refresh token
    fastify.post('/logout', async (request, reply) => {
        reply.clearCookie('refreshToken', { path: '/' });
        return { success: true };
    });

    // PATCH /auth/profile - Update user profile and business settings
    fastify.patch('/profile', { preHandler: fastify.authenticate }, async (request) => {
        const body = z.object({
            name: z.string().min(2).optional(),
            businessName: z.string().min(2).optional(),
            timezone: z.string().optional(),
            outOfWindowMessagesEnabled: z.boolean().optional(),
        }).parse(request.body);

        // Update user name if provided
        if (body.name) {
            await fastify.prisma.user.update({
                where: { id: request.user.userId },
                data: { name: body.name },
            });
        }

        // Update tenant (business) settings if provided
        if (
            body.businessName ||
            body.timezone ||
            body.outOfWindowMessagesEnabled !== undefined
        ) {
            await fastify.prisma.tenant.update({
                where: { id: request.user.tenantId },
                data: {
                    ...(body.businessName && { name: body.businessName }),
                    ...(body.timezone && { timezone: body.timezone }),
                    ...(body.outOfWindowMessagesEnabled !== undefined && {
                        outOfWindowMessagesEnabled: body.outOfWindowMessagesEnabled,
                    }),
                },
            });
        }

        return { success: true };
    });

    // POST /auth/change-password - Change user password
    fastify.post('/change-password', { preHandler: fastify.authenticate }, async (request) => {
        const body = z.object({
            currentPassword: z.string(),
            newPassword: z.string().min(8),
        }).parse(request.body);

        const user = await fastify.prisma.user.findUnique({
            where: { id: request.user.userId },
        });

        if (!user) {
            throw fastify.httpErrors.notFound('User not found');
        }

        const isValid = await bcrypt.compare(body.currentPassword, user.passwordHash);
        if (!isValid) {
            throw fastify.httpErrors.badRequest('Current password is incorrect');
        }

        const passwordHash = await bcrypt.hash(body.newPassword, 12);
        await fastify.prisma.user.update({
            where: { id: request.user.userId },
            data: { passwordHash },
        });

        return { success: true };
    });
};

export default authRoutes;
