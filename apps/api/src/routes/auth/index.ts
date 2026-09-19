import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateTokenPayload } from '../../plugins/auth.js';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';
import { extractRefreshToken, isMobileClient } from '../../lib/auth-transport.js';
import { resolveGmailCreds, sendEmail } from '../../services/gmail-smtp.js';
import {
    createResetToken,
    parseResetToken,
    passwordResetEmail,
    verifyResetToken,
} from '../../services/password-reset.js';
import { createVerifyToken, verifyEmailToken, verificationEmail } from '../../services/email-verification.js';

// Validation schemas. `businessType` is optional and defaults to SERVICE so
// older / SERVICE-only clients can omit it. The handler decides whether to
// honour a PRODUCT value below — gated by the ENABLE_PRODUCT_MODE flag.
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
    businessName: z.string().min(2),
    businessType: z.enum(['PRODUCT', 'SERVICE']).optional().default('SERVICE'),
    timezone: z.string().default('Africa/Accra'),
    // The checkbox on the sign-up form. Recorded with a timestamp on the user.
    acceptTerms: z.boolean().default(false),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// Refresh-token transport differs by client (see lib/auth-transport.ts):
//  - Web: refresh token as an HTTP-only cookie, replayed automatically.
//  - Mobile (`X-Client: mobile`): refresh token returned in and read from the
//    JSON body, since native clients have no cookie jar.
const authRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /auth/register - Create new tenant + owner user
    fastify.post('/register', async (request, reply) => {
        const body = registerSchema.parse(request.body);

        if (!body.acceptTerms) {
            throw fastify.httpErrors.badRequest('Please agree to the Terms and Privacy Policy to create an account.');
        }

        // One email, one account. Login looks users up by email alone, so a
        // second account with the same address could never be signed into.
        const taken = await fastify.prisma.user.findFirst({
            where: { email: body.email },
            select: { id: true },
        });
        if (taken) {
            throw fastify.httpErrors.conflict('An account with this email already exists. Sign in, or reset your password.');
        }

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
                    termsAcceptedAt: now,
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

        // Verification email, best-effort: a mail outage must not block sign-up.
        // The dashboard offers "resend" until it lands.
        await sendVerificationEmail(result.user, result.tenant.name).catch((err) =>
            request.log.warn({ err, userId: result.user.id }, 'Verification email not sent'),
        );

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
            ...(isMobileClient(request.headers) && { refreshToken }),
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
            ...(isMobileClient(request.headers) && { refreshToken }),
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
                emailVerifiedAt: user.emailVerifiedAt,
            },
            tenant: {
                id: user.tenant.id,
                name: user.tenant.name,
                businessType: user.tenant.businessType,
                timezone: user.tenant.timezone,
                whatsappConnected: !!user.tenant.whatsappPhoneNumberId,
                outOfWindowMessagesEnabled: user.tenant.outOfWindowMessagesEnabled,
                depositRequired: user.tenant.depositRequired,
                defaultDepositAmount: Number(user.tenant.defaultDepositAmount),
                currency: user.tenant.paymentCurrency,
                deletionRequestedAt: user.tenant.deletionRequestedAt,
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
            if (isMobileClient(request.headers)) {
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
            depositRequired: z.boolean().optional(),
            defaultDepositAmount: z.number().min(0).max(1_000_000).optional(),
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
            body.outOfWindowMessagesEnabled !== undefined ||
            body.depositRequired !== undefined ||
            body.defaultDepositAmount !== undefined
        ) {
            await fastify.prisma.tenant.update({
                where: { id: request.user.tenantId },
                data: {
                    ...(body.businessName && { name: body.businessName }),
                    ...(body.timezone && { timezone: body.timezone }),
                    ...(body.outOfWindowMessagesEnabled !== undefined && {
                        outOfWindowMessagesEnabled: body.outOfWindowMessagesEnabled,
                    }),
                    ...(body.depositRequired !== undefined && { depositRequired: body.depositRequired }),
                    ...(body.defaultDepositAmount !== undefined && {
                        defaultDepositAmount: Math.round(body.defaultDepositAmount * 100) / 100,
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

    // GET /auth/verify-email?token= - Landing for the link in the verification
    // email. Redirects to the web app with a status so the page can speak.
    fastify.get('/verify-email', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (request, reply) => {
        const { token } = z.object({ token: z.string().min(20) }).parse(request.query);
        const front = config.frontendUrl.replace(/\/$/, '');

        const parsed = verifyEmailToken(token, config.jwtSecret);
        const user = parsed
            ? await fastify.prisma.user.findFirst({ where: { id: parsed.userId, isActive: true }, select: { id: true, email: true, tenantId: true, emailVerifiedAt: true } })
            : null;

        if (!user || user.email.toLowerCase() !== parsed!.email) {
            return reply.redirect(`${front}/verify-email?status=invalid`);
        }
        if (!user.emailVerifiedAt) {
            await fastify.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
            await audit({
                prisma: fastify.prisma,
                action: 'auth.email.verified',
                actorType: 'USER',
                tenantId: user.tenantId,
                actorId: user.id,
                ipAddress: request.ip,
            });
        }
        return reply.redirect(`${front}/verify-email?status=ok`);
    });

    // POST /auth/resend-verification - From the dashboard banner.
    fastify.post('/resend-verification', {
        preHandler: fastify.authenticate,
        config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
    }, async (request) => {
        const user = await fastify.prisma.user.findUnique({
            where: { id: request.user.userId },
            select: { id: true, email: true, name: true, emailVerifiedAt: true, tenant: { select: { name: true } } },
        });
        if (!user) throw fastify.httpErrors.notFound('User not found');
        if (user.emailVerifiedAt) return { success: true, alreadyVerified: true };

        const sent = await sendVerificationEmail(user, user.tenant.name);
        if (!sent) {
            throw fastify.httpErrors.serviceUnavailable('We could not send the email right now. Try again in a few minutes.');
        }
        return { success: true };
    });

    // POST /auth/delete-request - Owner asks for the account to be removed.
    // A person confirms and deletes; this records the ask, tells support,
    // and shows the pending state in Settings.
    fastify.post('/delete-request', {
        preHandler: fastify.authenticate,
        config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the account owner can request deletion');
        }
        const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body ?? {});

        const tenant = await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { deletionRequestedAt: new Date() },
            select: { id: true, name: true, deletionRequestedAt: true },
        });
        const user = await fastify.prisma.user.findUnique({
            where: { id: request.user.userId },
            select: { email: true, name: true },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'tenant.deletion.requested',
            actorType: 'USER',
            tenantId: tenant.id,
            actorId: request.user.userId,
            metadata: { reason: body.reason ?? null },
            ipAddress: request.ip,
        });

        // Tell the team. Goes to the platform mailbox itself.
        const creds = resolveGmailCreds({ tenantGmailUser: null, tenantGmailAppPasswordEncrypted: null, tenantGmailFromName: null });
        if (creds) {
            await sendEmail({
                ...creds,
                to: creds.user,
                subject: `Account deletion requested: ${tenant.name}`,
                text: `${user?.name ?? 'An owner'} (${user?.email ?? 'unknown email'}) asked to delete tenant ${tenant.name} (${tenant.id}).\n\nReason: ${body.reason ?? '(none given)'}\n\nConfirm with them, then remove the tenant.`,
            }).catch(() => undefined);
        } else {
            request.log.error({ tenantId: tenant.id }, 'Deletion requested but no platform email sender is configured');
        }

        return { success: true, deletionRequestedAt: tenant.deletionRequestedAt };
    });

    /** Send the confirm-your-email message. Returns false when no sender is configured or the send failed. */
    async function sendVerificationEmail(user: { id: string; email: string; name: string }, businessName: string): Promise<boolean> {
        const creds = resolveGmailCreds({ tenantGmailUser: null, tenantGmailAppPasswordEncrypted: null, tenantGmailFromName: null });
        if (!creds) {
            fastify.log.error({ userId: user.id }, 'Verification email requested but no platform email sender is configured');
            return false;
        }
        const token = createVerifyToken(user, config.jwtSecret);
        const apiBase = (config.apiPublicUrl ?? '').replace(/\/$/, '');
        const link = `${apiBase}/auth/verify-email?token=${encodeURIComponent(token)}`;
        const mail = verificationEmail({ name: user.name, businessName, link });
        const result = await sendEmail({ ...creds, to: user.email, ...mail });
        if (!result.ok) fastify.log.error({ err: result.error, userId: user.id }, 'Verification email failed to send');
        return result.ok;
    }

    // POST /auth/forgot-password - Email a one-hour reset link.
    //
    // Always answers 200 with the same body: the form must not reveal which
    // addresses have accounts. Tight rate limit because it sends mail.
    fastify.post(
        '/forgot-password',
        { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
        async (request) => {
            const body = z.object({ email: z.string().email() }).parse(request.body);

            const user = await fastify.prisma.user.findFirst({
                where: { email: body.email, isActive: true },
                select: { id: true, name: true, email: true, passwordHash: true, tenantId: true },
            });

            if (user) {
                const token = createResetToken(user, config.jwtSecret);
                const link = `${config.frontendUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

                // Account email always goes from the platform sender, never
                // from a tenant's connected Gmail: this is Bookly writing to
                // its own customer.
                const creds = resolveGmailCreds({
                    tenantGmailUser: null,
                    tenantGmailAppPasswordEncrypted: null,
                    tenantGmailFromName: null,
                });
                if (!creds) {
                    request.log.error({ userId: user.id }, 'Password reset requested but no platform email sender is configured');
                } else {
                    const mail = passwordResetEmail({ name: user.name, link });
                    const result = await sendEmail({ ...creds, to: user.email, ...mail });
                    if (!result.ok) {
                        request.log.error({ err: result.error, userId: user.id }, 'Password reset email failed to send');
                    }
                }

                await audit({
                    prisma: fastify.prisma,
                    action: 'auth.password_reset.requested',
                    actorType: 'USER',
                    tenantId: user.tenantId,
                    actorId: user.id,
                    ipAddress: request.ip,
                });
            }

            return { success: true };
        },
    );

    // POST /auth/reset-password - Set a new password from a reset link.
    fastify.post(
        '/reset-password',
        { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
        async (request) => {
            const body = z.object({
                token: z.string().min(20),
                password: z.string().min(8),
            }).parse(request.body);

            const parsed = parseResetToken(body.token);
            const user = parsed
                ? await fastify.prisma.user.findFirst({ where: { id: parsed.userId, isActive: true } })
                : null;

            if (!user || !verifyResetToken(body.token, user, config.jwtSecret)) {
                throw fastify.httpErrors.badRequest('This reset link is invalid or has expired. Request a new one.');
            }

            const passwordHash = await bcrypt.hash(body.password, 12);
            await fastify.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

            await audit({
                prisma: fastify.prisma,
                action: 'auth.password_reset.completed',
                actorType: 'USER',
                tenantId: user.tenantId,
                actorId: user.id,
                ipAddress: request.ip,
            });

            return { success: true };
        },
    );
};

export default authRoutes;
