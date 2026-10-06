import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateAdminTokenPayload } from '../../plugins/auth.js';
import { crossSiteClearOptions, crossSiteCookieOptions } from '../../plugins/csrf.js';
import { config } from '../../config/index.js';
import { audit } from '../../services/audit.js';
import {
    beginEnrolment,
    checkLoginCode,
    confirmEnrolment,
    disableTotp,
    isTwoFactorRequired,
    regenerateRecoveryCodes,
} from '../../services/admin-totp.js';
import { REQUIRE_2FA_KEY, setPlatformSetting } from '../../services/platform-switches.js';
import { resolveAdminRole, ROLE_PERMISSIONS } from '../../services/admin-permissions.js';
import { adminActor, adminGuard } from './guard.js';
import { checkRefresh, isRefreshStoreRequired, revoke } from './refresh-store.js';
import { clearFailures, emailTag, isLocked, recordFailure } from '../../services/admin-throttle.js';

const REFRESH_COOKIE = 'adminRefreshToken';
const REFRESH_PATH = '/admin/auth';
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;
// Per-ACCOUNT password failures, on top of the per-IP rate limit: a botnet
// spreading guesses over many IPs still hits this. The trade-off is that a
// stranger can lock a known admin email out of sign-in for the lock period.
const PASSWORD_FAILURES = { max: 5, lockMs: 15 * 60_000 };
// Compared against when the email is unknown, so "no such admin" costs the same
// as "wrong password" and timing does not reveal which admins exist.
const DUMMY_HASH = '$2a$12$tu8I5oqSe8ZaQta9fw7k1ObnjBaawX7VgpoJGPxK8rR2ozb3Rr2Y6';

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(200),
    // TOTP (6 digits) or a recovery code (xxxxx-xxxxx).
    code: z.string().trim().min(1).max(32).optional(),
});
const passwordBody = z.object({ password: z.string().min(1).max(200) });
const codeBody = z.object({ code: z.string().trim().min(1).max(32) });
const passwordAndCode = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(1).max(32) });

const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
    const sign = (payload: ReturnType<typeof generateAdminTokenPayload>, expiresIn: string) =>
        (fastify as any).jwt.admin.sign(payload, { expiresIn }) as string;

    /** `family` is kept across rotations; a fresh sign-in starts a new one. */
    function issueSession(reply: FastifyReply, adminId: string, family: string = randomUUID()) {
        const accessToken = sign(generateAdminTokenPayload(adminId, 'admin_access'), config.jwtExpiresIn);
        const refreshToken = sign(generateAdminTokenPayload(adminId, 'admin_refresh', randomUUID(), family), config.jwtRefreshExpiresIn);
        reply.setCookie(REFRESH_COOKIE, refreshToken, crossSiteCookieOptions({ path: REFRESH_PATH, maxAge: REFRESH_MAX_AGE }));
        return accessToken;
    }

    // The typed email is stored only when it belongs to a real admin (the
    // actor is then known anyway). Otherwise only a keyed tag is kept, so the
    // audit log never accumulates strangers' addresses or mistyped passwords-as-emails.
    const failure = (request: FastifyRequest, reason: string, extra: { adminId?: string; email?: string } = {}) =>
        audit({
            prisma: fastify.prisma,
            action: 'admin.login.failure',
            actorType: 'ADMIN',
            actorId: extra.adminId ?? null,
            metadata: {
                reason,
                ...(extra.email ? (extra.adminId ? { email: extra.email } : { emailTag: emailTag(extra.email) }) : {}),
            },
            ipAddress: request.ip,
        });

    // POST /admin/auth/login
    fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
        const body = loginSchema.parse(request.body);
        const accountKey = `pw:${emailTag(body.email)}`;

        if (await isLocked(fastify.redis, accountKey)) {
            await failure(request, 'account_locked', { email: body.email });
            throw fastify.httpErrors.tooManyRequests('Too many failed sign-ins for this account. Try again in a few minutes.');
        }

        const admin = await fastify.prisma.admin.findUnique({ where: { email: body.email } });
        const passwordOk = await bcrypt.compare(body.password, admin?.passwordHash ?? DUMMY_HASH);
        if (!admin || !admin.isActive || !passwordOk) {
            // Counted for unknown emails too, so the lock does not reveal which admins exist.
            await recordFailure(fastify.redis, accountKey, PASSWORD_FAILURES);
            await failure(request, !admin ? 'unknown_email' : !admin.isActive ? 'inactive' : 'bad_password', { adminId: admin?.id, email: body.email });
            throw fastify.httpErrors.unauthorized('Invalid email or password');
        }
        await clearFailures(fastify.redis, accountKey);

        // Second factor. Only reached with a correct password, so the 2FA prompt
        // never confirms that an email/password pair is wrong.
        let method: 'password' | 'totp' | 'recovery' = 'password';
        if (admin.totpEnabledAt) {
            if (!body.code) {
                return reply.code(401).send({
                    statusCode: 401,
                    error: 'Unauthorized',
                    message: 'Two-factor code required',
                    totpRequired: true,
                });
            }
            const result = await checkLoginCode(fastify.prisma, admin, body.code, Date.now(), fastify.redis);
            if (!result.ok) {
                await failure(request, result.reason === 'locked' ? 'totp_locked' : 'bad_totp', { adminId: admin.id });
                if (result.reason === 'locked') {
                    throw fastify.httpErrors.tooManyRequests('Too many wrong codes. Try again in a few minutes.');
                }
                throw fastify.httpErrors.unauthorized('Invalid two-factor code');
            }
            method = result.method;
        }

        await fastify.prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
        await audit({
            prisma: fastify.prisma,
            action: 'admin.login.success',
            actorType: 'ADMIN',
            actorId: admin.id,
            metadata: { method },
            ipAddress: request.ip,
        });

        const role = resolveAdminRole(admin);
        const accessToken = issueSession(reply, admin.id);
        const required = await isTwoFactorRequired(fastify.prisma);
        return {
            admin: {
                id: admin.id,
                email: admin.email,
                name: admin.name,
                isSuperAdmin: admin.isSuperAdmin,
                role,
                totpEnabled: !!admin.totpEnabledAt,
            },
            accessToken,
            // When required && !enrolled the UI sends the admin to set it up;
            // the API refuses everything but `self` routes until they do.
            twoFactor: { required, enrolled: !!admin.totpEnabledAt },
        };
    });

    // POST /admin/auth/refresh - rotate the refresh cookie, return a new access token.
    fastify.post('/auth/refresh', async (request, reply) => {
        const token = (request.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
        const reject = (): never => {
            reply.clearCookie(REFRESH_COOKIE, crossSiteClearOptions(REFRESH_PATH));
            throw fastify.httpErrors.unauthorized('Invalid refresh token');
        };
        if (!token) return reject();

        let decoded: { adminId?: string; type?: string; jti?: string; fam?: string; exp?: number; iat?: number };
        try {
            decoded = (fastify as any).jwt.admin.verify(token);
        } catch {
            return reject();
        }
        if (decoded.type !== 'admin_refresh' || !decoded.adminId) return reject();
        // Tokens minted before families existed (no jti / no fam) cannot be
        // tracked or revoked: refuse them. Every admin signs in once after the deploy.
        if (!decoded.jti || !decoded.fam) return reject();

        // Fail closed without Redis in production: nothing could detect reuse
        // or honour a revocation, so the session ends with its access token.
        if (!fastify.redis && isRefreshStoreRequired(config.nodeEnv)) {
            request.log.error('admin refresh refused: Redis is not configured (set ADMIN_REFRESH_ALLOW_NO_REDIS=true to opt out)');
            return reject();
        }

        const ttl = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : REFRESH_MAX_AGE;
        let check;
        try {
            check = await checkRefresh(fastify.redis, { adminId: decoded.adminId, jti: decoded.jti, fam: decoded.fam, iat: decoded.iat }, ttl);
        } catch (err) {
            request.log.error({ err }, 'admin refresh store unavailable; refusing refresh');
            return reject();
        }
        if (check !== 'ok') {
            if (check === 'reused') {
                request.log.warn({ adminId: decoded.adminId }, 'admin refresh token reuse refused; token family revoked');
                await audit({
                    prisma: fastify.prisma, action: 'admin.refresh.reuse_refused', actorType: 'ADMIN',
                    actorId: decoded.adminId, ipAddress: request.ip, metadata: { familyRevoked: true },
                });
            }
            return reject();
        }

        const admin = await fastify.prisma.admin.findUnique({
            where: { id: decoded.adminId },
            select: { id: true, isActive: true },
        });
        if (!admin || !admin.isActive) return reject();

        return { accessToken: issueSession(reply, admin.id, decoded.fam) };
    });

    // POST /admin/auth/logout - clear the cookie and revoke the token it carried.
    fastify.post('/auth/logout', async (request, reply) => {
        const token = (request.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
        if (token) {
            try {
                const d = (fastify as any).jwt.admin.verify(token) as { jti?: string; exp?: number };
                const ttl = d.exp ? d.exp - Math.floor(Date.now() / 1000) : REFRESH_MAX_AGE;
                await revoke(fastify.redis, d.jti, ttl);
            } catch {
                /* an unverifiable token has nothing to revoke */
            }
        }
        reply.clearCookie(REFRESH_COOKIE, crossSiteClearOptions(REFRESH_PATH));
        return { success: true };
    });

    // GET /admin/auth/me
    fastify.get('/auth/me', { preHandler: adminGuard(fastify, 'self') }, async (request) => {
        const admin = await fastify.prisma.admin.findUnique({ where: { id: request.admin!.adminId } });
        if (!admin) throw fastify.httpErrors.notFound('Admin not found');
        const role = request.admin!.role;
        return {
            id: admin.id,
            email: admin.email,
            name: admin.name,
            isSuperAdmin: admin.isSuperAdmin,
            role,
            permissions: [...ROLE_PERMISSIONS[role]],
            totpEnabled: !!admin.totpEnabledAt,
            recoveryCodesRemaining: admin.totpEnabledAt ? (admin.recoveryCodeHashes?.length ?? 0) : 0,
            twoFactorRequired: await isTwoFactorRequired(fastify.prisma),
        };
    });

    // ------------------------------------------------------------
    // 2FA self-service. All `self`: any role, including READONLY.
    // ------------------------------------------------------------
    async function requirePassword(request: FastifyRequest, password: string) {
        const row = await fastify.prisma.admin.findUnique({ where: { id: request.admin!.adminId } });
        if (!row || !(await bcrypt.compare(password, row.passwordHash))) {
            throw fastify.httpErrors.badRequest('Password is incorrect');
        }
        return row;
    }
    const twoFaAudit = (request: FastifyRequest, action: string, metadata?: Record<string, unknown>) =>
        audit({ prisma: fastify.prisma, action, ...adminActor(request), targetType: 'Admin', targetId: request.admin!.adminId, metadata: metadata ?? null });
    const twoFaLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

    // POST /admin/auth/2fa/enrol - start enrolment; the secret is shown ONCE.
    fastify.post('/auth/2fa/enrol', { preHandler: adminGuard(fastify, 'self'), ...twoFaLimit }, async (request) => {
        const { password } = passwordBody.parse(request.body);
        const row = await requirePassword(request, password);
        try {
            const out = await beginEnrolment(fastify.prisma, { id: row.id, email: row.email });
            await twoFaAudit(request, 'admin.2fa.enrol_started');
            return out;
        } catch (err) {
            throw fastify.httpErrors.conflict((err as Error).message);
        }
    });

    // POST /admin/auth/2fa/verify - confirm with the first code; recovery codes shown ONCE.
    fastify.post('/auth/2fa/verify', { preHandler: adminGuard(fastify, 'self'), ...twoFaLimit }, async (request) => {
        const { code } = codeBody.parse(request.body);
        const result = await confirmEnrolment(fastify.prisma, request.admin!.adminId, code, Date.now(), fastify.redis);
        if (!result.ok) {
            if (result.reason === 'locked') throw fastify.httpErrors.tooManyRequests('Too many wrong codes. Try again in a few minutes.');
            throw fastify.httpErrors.badRequest(result.reason === 'not_enrolling' ? 'Start enrolment first' : 'That code is not valid');
        }
        await twoFaAudit(request, 'admin.2fa.enabled');
        return { enabled: true, recoveryCodes: result.recoveryCodes };
    });

    async function requirePasswordAndCode(request: FastifyRequest) {
        const body = passwordAndCode.parse(request.body);
        const row = await requirePassword(request, body.password);
        const res = await checkLoginCode(fastify.prisma, row, body.code, Date.now(), fastify.redis);
        if (!res.ok) throw fastify.httpErrors.badRequest(res.reason === 'locked' ? 'Too many wrong codes. Try again later.' : 'That code is not valid');
        return row;
    }

    // POST /admin/auth/2fa/disable
    fastify.post('/auth/2fa/disable', { preHandler: adminGuard(fastify, 'self'), ...twoFaLimit }, async (request) => {
        // Policy first: a recovery code is single-use and must not be burned
        // by a request that was always going to be refused.
        if (await isTwoFactorRequired(fastify.prisma)) {
            throw fastify.httpErrors.badRequest('Two-factor is required for all admins and cannot be turned off');
        }
        const row = await requirePasswordAndCode(request);
        await disableTotp(fastify.prisma, row.id, fastify.redis);
        await twoFaAudit(request, 'admin.2fa.disabled');
        return { enabled: false };
    });

    // POST /admin/auth/2fa/recovery-codes - replace the recovery codes (shown ONCE).
    fastify.post('/auth/2fa/recovery-codes', { preHandler: adminGuard(fastify, 'self'), ...twoFaLimit }, async (request) => {
        const row = await requirePasswordAndCode(request);
        const recoveryCodes = await regenerateRecoveryCodes(fastify.prisma, row.id);
        await twoFaAudit(request, 'admin.2fa.recovery_codes_regenerated');
        return { recoveryCodes };
    });

    // PUT /admin/security/two-factor - OWNER: require 2FA for every admin.
    fastify.put('/security/two-factor', { preHandler: adminGuard(fastify, 'security:policy') }, async (request) => {
        const { required } = z.object({ required: z.boolean() }).parse(request.body);
        if (required && !request.admin!.totpEnabled) {
            throw fastify.httpErrors.badRequest('Enable two-factor on your own account first, or you would lock yourself out');
        }
        await setPlatformSetting(fastify.prisma, REQUIRE_2FA_KEY, { enabled: required }, request.admin!.adminId);
        await twoFaAudit(request, 'admin.2fa.policy_changed', { required });
        return { required };
    });
};

export default adminAuthRoutes;
