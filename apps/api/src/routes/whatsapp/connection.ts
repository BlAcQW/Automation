/**
 * Connecting an organisation's WhatsApp number — the dashboard's /whatsapp
 * page and any external console (e.g. TURBO's) calling with the staff
 * member's Bookly Bearer token. Documented in docs/API.md, "Connect WhatsApp
 * from your own app".
 *
 *   GET  /whatsapp/status                     any signed-in user
 *   GET  /whatsapp/embedded-signup/config     OWNER  (FB.login options + prefill)
 *   POST /whatsapp/embedded-signup            OWNER  (own Meta account; primary)
 *   POST /whatsapp/hosted/start|resend|verify OWNER  (Bookly-hosted number; backup)
 *   POST /whatsapp/connect                    OWNER  (manual ids + token)
 *   POST /whatsapp/disconnect                 OWNER
 *
 * Failures carry a stable `code` (services/whatsapp-connection.ts WA_ERRORS).
 * Tokens never appear in a response or a log line.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { completeEmbeddedSignup, EmbeddedSignupError } from '../../services/meta-embedded-signup.js';
import {
    isPlatformWabaConfigured,
    startHostedNumber,
    verifyCode,
    registerNumber,
    deleteHostedNumber,
    countHostedNumbers,
    normalizeLocalNumber,
    toE164,
    subscribePlatformWaba,
    NumberOnboardingError,
} from '../../services/meta-number-onboarding.js';
import {
    buildEmbeddedSignupSetup,
    buildWhatsappStatus,
    classifyEmbeddedSignupError,
    classifyOnboardingError,
    CLEARED_WHATSAPP,
    CONNECTION_STATUS_SELECT,
    connectedData,
    disconnectWhatsapp,
    EMBEDDED_SIGNUP_SDK_VERSION,
    EMBEDDED_SIGNUP_MESSAGE_ORIGINS,
    isEmbeddedSignupConfigured,
    resendHostedCode,
    isHostedCountryAllowed,
    reserveOtpSend,
    verifyManualCredentials,
    resendAvailableAt,
    waError,
} from '../../services/whatsapp-connection.js';

/**
 * Meta caps a business portfolio at 20 registered business phone numbers, so
 * Bookly's own WABA can host at most this many tenants before Meta has to
 * raise the limit.
 */
export const HOSTED_NUMBER_LIMIT = 20;

/** A STARTING claim older than this is a crashed request and may be taken over. */
const STARTING_STALE_MS = 2 * 60_000;

const tooManyAttempts = () => waError('TOO_MANY_ATTEMPTS');
const perTenant = (suffix: string) => (req: any) => `${req.user?.tenantId ?? req.ip}:${suffix}`;

function requireOwner(request: FastifyRequest): void {
    if (request.user.role !== 'OWNER') throw waError('OWNER_ONLY');
}

const isUniqueViolation = (err: unknown) =>
    typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

const metaId = z.string().regex(/^\d{1,32}$/);

/**
 * The WA_EMBEDDED_SIGNUP window message's `data` (v4; v2/v3 send a subset).
 * Unknown keys (page_ids, ad_account_ids, ...) are accepted and ignored.
 */
const sessionData = z.object({
    waba_id: metaId.optional(),
    phone_number_id: metaId.optional(),
    business_id: z.string().max(64).optional(),
    waba_ids: z.array(metaId).max(20).optional(),
}).passthrough();

const embeddedSignupBody = z.object({
    code: z.string().min(1).max(2000),
    redirectUri: z.string().url().optional(),
    // Either flat ids (camelCase or snake_case, as the dashboard and older
    // consoles send) or the whole message event as `sessionInfo`.
    wabaId: metaId.optional(),
    phoneNumberId: metaId.optional(),
    waba_id: metaId.optional(),
    phone_number_id: metaId.optional(),
    businessId: z.string().max(64).optional(),
    business_id: z.string().max(64).optional(),
    sessionInfo: z.object({
        type: z.string().max(64).optional(),
        event: z.string().max(64).optional(),
        version: z.union([z.string(), z.number()]).optional(),
        data: sessionData.optional(),
    }).passthrough().optional(),
});

/** Pure: the WABA + number the person picked, from whichever shape was posted. */
export function sessionHint(body: z.infer<typeof embeddedSignupBody>): { wabaId?: string; phoneNumberId?: string } {
    const data = body.sessionInfo?.data;
    return {
        // waba_ids only counts when it names exactly one account; the server
        // still checks the WABA against the token's grants either way.
        wabaId: body.wabaId ?? body.waba_id ?? data?.waba_id ?? (data?.waba_ids?.length === 1 ? data.waba_ids[0] : undefined),
        phoneNumberId: body.phoneNumberId ?? body.phone_number_id ?? data?.phone_number_id,
    };
}

const hostedStartBody = z.object({
    countryCode: z.string().min(1).max(4),
    localNumber: z.string().min(4).max(20),
    codeMethod: z.enum(['SMS', 'VOICE']).optional(),
    // What customers see as the business name. Defaults to the organisation name.
    displayName: z.string().trim().min(3).max(100).optional(),
});

const connectionRoutes: FastifyPluginAsync = async (fastify) => {
    const loadStatusRow = (tenantId: string) =>
        fastify.prisma.tenant.findUnique({ where: { id: tenantId }, select: CONNECTION_STATUS_SELECT });

    const currentStatus = async (tenantId: string) => buildWhatsappStatus(await loadStatusRow(tenantId));

    // GET /whatsapp/status — STAFF may read; only the OWNER may change it.
    fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request) => ({
        ...(await currentStatus(request.user.tenantId)),
        canManage: request.user.role === 'OWNER',
    }));

    // GET /whatsapp/embedded-signup/config — everything a console needs to open
    // Meta's Embedded Signup popup: the public app id + config id and the
    // FB.login options with extras.setup prefilled from the organisation.
    // Never the app secret, never a token.
    fastify.get('/embedded-signup/config', { preHandler: [fastify.authenticate] }, async (request) => {
        requireOwner(request);
        const tenantId = request.user.tenantId;
        const [tenant, owner] = await Promise.all([
            fastify.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true, vertical: true, businessType: true, timezone: true, paymentCurrency: true },
            }),
            fastify.prisma.user.findFirst({
                where: { tenantId, id: request.user.userId },
                select: { email: true },
            }),
        ]);
        if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');

        const available = isEmbeddedSignupConfigured();
        const configId = config.whatsapp.configId ?? null;
        return {
            available,
            unavailableReason: available ? null : 'NOT_CONFIGURED',
            appId: config.whatsapp.appId ?? null,
            configId,
            sdkVersion: EMBEDDED_SIGNUP_SDK_VERSION,
            // Pass as the second argument of FB.login(callback, login).
            login: {
                config_id: configId,
                response_type: 'code',
                override_default_response_type: true,
                // Embedded Signup v4: the configuration (config_id) decides the
                // version, products and assets, so no `version`,
                // `sessionInfoVersion` or `featureType` is sent. `setup` carries
                // the prefill.
                extras: {
                    setup: buildEmbeddedSignupSetup(tenant, owner?.email ?? null),
                },
            },
            // Listen for window 'message' events from this origin with this
            // data.type; post data.data.waba_id / phone_number_id with the code.
            // Accept a window 'message' event only when event.origin is EXACTLY
            // one of these (set membership, no suffix matching) and data.type
            // is this; post the parsed event as `sessionInfo`.
            sessionEvent: { origins: [...EMBEDDED_SIGNUP_MESSAGE_ORIGINS], type: 'WA_EMBEDDED_SIGNUP' },
            completePath: '/whatsapp/embedded-signup',
        };
    });

    // POST /whatsapp/embedded-signup — finish Embedded Signup: exchange the code,
    // pick the WABA + number the person chose, subscribe our app, register the
    // number. The organisation's own Meta account; Meta bills the organisation.
    fastify.post('/embedded-signup', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: perTenant('embedded-signup'), errorResponseBuilder: tooManyAttempts },
        },
    }, async (request) => {
        requireOwner(request);
        const body = embeddedSignupBody.parse(request.body);
        const tenantId = request.user.tenantId;
        if (body.sessionInfo?.event === 'CANCEL') {
            throw waError('META_ERROR', 'The Meta signup window was closed before it finished. Start the connection again.');
        }
        const hint = sessionHint(body);

        const current = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true },
        });
        // A live Bookly-hosted number must be disconnected deliberately first;
        // an unfinished one is simply replaced (below, once Meta succeeds).
        if (current?.whatsappHosted && current.whatsappPhoneNumberId && current.whatsappNumberStatus === 'REGISTERED') {
            throw waError('ALREADY_CONNECTED');
        }

        let result;
        try {
            result = await completeEmbeddedSignup(body.code, body.redirectUri, hint);
        } catch (err) {
            if (err instanceof EmbeddedSignupError) {
                request.log.warn({ step: err.step, details: err.details }, 'Embedded signup failed');
                throw classifyEmbeddedSignupError(err);
            }
            throw err;
        }

        const existing = await fastify.prisma.tenant.findFirst({
            where: { whatsappPhoneNumberId: result.phoneNumberId, NOT: { id: tenantId } },
            select: { id: true },
        });
        if (existing) throw waError('NUMBER_IN_USE');

        if (current?.whatsappHosted && current.whatsappPhoneNumberId) {
            await releaseHostedNumber(current.whatsappPhoneNumberId, request);
        }

        const now = new Date();
        try {
            await fastify.prisma.tenant.update({
                where: { id: tenantId },
                data: {
                    ...CLEARED_WHATSAPP,
                    whatsappPhoneNumberId: result.phoneNumberId,
                    whatsappAccountId: result.wabaId,
                    whatsappAccessToken: encrypt(result.accessToken),
                    whatsappDisplayNumber: result.displayPhoneNumber,
                    whatsappVerifiedName: result.verifiedName ?? null,
                    whatsappTokenExpiresAt: result.tokenExpiresAt ?? null,
                    whatsappRegistrationPin: encrypt(result.registrationPin),
                    ...connectedData('OWN_ACCOUNT', request.user.userId, now),
                },
            });
        } catch (err) {
            // P2002: another tenant connected the same number between the
            // pre-check and this write. Meta's side already completed.
            await audit({
                prisma: fastify.prisma,
                action: 'whatsapp.connect_failed',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                metadata: {
                    via: 'embedded_signup',
                    phoneNumberId: result.phoneNumberId,
                    wabaId: result.wabaId,
                    reason: isUniqueViolation(err) ? 'phone_collision_race' : 'db_write_failed',
                },
                ipAddress: request.ip,
            });
            if (isUniqueViolation(err)) throw waError('NUMBER_IN_USE');
            throw err;
        }

        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: {
                mode: 'OWN_ACCOUNT',
                via: 'embedded_signup',
                phoneNumberId: result.phoneNumberId,
                wabaId: result.wabaId,
                displayNumber: result.displayPhoneNumber,
            },
            ipAddress: request.ip,
        });

        return {
            success: true,
            mode: 'OWN_ACCOUNT' as const,
            displayNumber: result.displayPhoneNumber,
            verifiedName: result.verifiedName ?? null,
            connectedAt: now,
            status: await currentStatus(tenantId),
        };
    });

    // ---- Bookly-hosted numbers (backup path) ---------------------------
    // The number is added to Bookly's OWN WABA: Meta bills Bookly, Bookly
    // bills the organisation in local currency. Inbound is routed and outbound
    // metered by phone_number_id -> tenant, exactly as for own numbers.

    async function releaseHostedNumber(phoneNumberId: string, request: FastifyRequest) {
        if (!isPlatformWabaConfigured()) return;
        try {
            await deleteHostedNumber(phoneNumberId);
        } catch (err) {
            request.log.error({ err, phoneNumberId }, 'failed to release replaced hosted number — slot may need manual cleanup');
        }
    }

    // POST /whatsapp/hosted/start — add the number to our WABA and send an OTP.
    // Calling it again while a number is still waiting for its code replaces
    // that number (wrong number typed, or switching numbers).
    fastify.post('/hosted/start', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: { max: 5, timeWindow: '10 minutes', keyGenerator: perTenant('hosted-start'), errorResponseBuilder: tooManyAttempts },
        },
    }, async (request) => {
        requireOwner(request);
        if (!isPlatformWabaConfigured()) throw waError('HOSTED_NOT_AVAILABLE');
        const body = hostedStartBody.parse(request.body);
        const tenantId = request.user.tenantId;

        if (!isHostedCountryAllowed(body.countryCode)) throw waError('COUNTRY_NOT_SUPPORTED');
        let e164: string;
        try {
            e164 = toE164(body.countryCode, normalizeLocalNumber(body.localNumber, body.countryCode));
        } catch (err) {
            if (err instanceof NumberOnboardingError) throw classifyOnboardingError(err);
            throw err;
        }

        // Hosted numbers are billed to Bookly: only an owner with a verified
        // email may put one on our WABA.
        const owner = await fastify.prisma.user.findFirst({
            where: { tenantId, id: request.user.userId },
            select: { emailVerifiedAt: true },
        });
        if (!owner?.emailVerifiedAt) throw waError('EMAIL_NOT_VERIFIED');

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true, whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true },
        });
        if (tenant?.whatsappPhoneNumberId) {
            const pending = tenant.whatsappHosted && tenant.whatsappNumberStatus !== 'REGISTERED';
            if (!pending) throw waError('ALREADY_CONNECTED');
            await releaseHostedNumber(tenant.whatsappPhoneNumberId, request);
            await fastify.prisma.tenant.updateMany({
                where: { id: tenantId, whatsappPhoneNumberId: tenant.whatsappPhoneNumberId },
                data: CLEARED_WHATSAPP,
            });
        }

        // Claim the tenant before spending a slot: a concurrent start (double
        // click, two tabs) finds STARTING and gets 409 instead of creating a
        // second number. A claim older than STARTING_STALE_MS is a crashed
        // request and may be taken over.
        const now = new Date();
        const claim = await fastify.prisma.tenant.updateMany({
            where: {
                id: tenantId,
                whatsappPhoneNumberId: null,
                OR: [
                    { whatsappNumberStatus: null },
                    { whatsappNumberStatus: { not: 'STARTING' } },
                    { whatsappNumberStatus: 'STARTING', whatsappCodeSentAt: { lt: new Date(now.getTime() - STARTING_STALE_MS) } },
                ],
            },
            data: { whatsappNumberStatus: 'STARTING', whatsappCodeSentAt: now },
        });
        if (claim.count !== 1) throw waError('START_IN_PROGRESS');
        const releaseClaim = () => fastify.prisma.tenant.updateMany({
            where: { id: tenantId, whatsappNumberStatus: 'STARTING', whatsappPhoneNumberId: null },
            data: { whatsappNumberStatus: null, whatsappCodeSentAt: null },
        }).catch((err: unknown) => request.log.error({ err, tenantId }, 'failed to release hosted start claim'));

        let createdId: string | null = null;
        try {
            // Fail closed: if Meta cannot say how many slots are used, do not add one.
            let used: number;
            try {
                used = await countHostedNumbers();
            } catch {
                throw waError('META_ERROR', 'Could not check hosted-number capacity with Meta. Try again in a few minutes.');
            }
            if (used >= HOSTED_NUMBER_LIMIT) throw waError('HOSTED_CAPACITY_FULL');

            await reserveOtpSend(fastify.prisma, e164, 'start', now);

            const verifiedName = body.displayName ?? tenant?.name ?? 'Bookly';
            const result = await startHostedNumber({
                countryCode: body.countryCode,
                localNumber: body.localNumber,
                verifiedName,
                codeMethod: body.codeMethod,
            });
            createdId = result.phoneNumberId;
            // Our app must be subscribed to our WABA for inbound webhooks.
            await subscribePlatformWaba();

            // Two-step PIN, per number, kept encrypted: Meta demands it again on
            // any re-register after a display-name change.
            const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
            const codeSentAt = new Date();

            const written = await fastify.prisma.tenant.updateMany({
                where: { id: tenantId, whatsappNumberStatus: 'STARTING', whatsappPhoneNumberId: null },
                data: {
                    ...CLEARED_WHATSAPP,
                    whatsappPhoneNumberId: result.phoneNumberId,
                    whatsappAccountId: config.platformWhatsapp.wabaId,
                    whatsappDisplayNumber: result.displayNumber,
                    whatsappHosted: true,
                    whatsappNumberStatus: 'PENDING_CODE',
                    whatsappRegistrationPin: encrypt(pin),
                    whatsappConnectionMode: 'BOOKLY_HOSTED',
                    whatsappVerifiedName: verifiedName,
                    whatsappCodeMethod: result.codeMethod,
                    whatsappCodeSentAt: codeSentAt,
                },
            });
            if (written.count !== 1) {
                // Lost the tenant meanwhile (claim taken over / connected another
                // way): the number we just made belongs to nobody, so remove it.
                createdId = null;
                await releaseHostedNumber(result.phoneNumberId, request);
                throw waError('START_IN_PROGRESS');
            }
            createdId = null;

            await audit({
                prisma: fastify.prisma,
                action: 'whatsapp.hosted_started',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                metadata: { phoneNumberId: result.phoneNumberId, displayNumber: result.displayNumber, codeMethod: result.codeMethod },
                ipAddress: request.ip,
            });

            return {
                success: true,
                status: 'PENDING_CODE' as const,
                step: 'CODE_SENT' as const,
                displayNumber: result.displayNumber,
                verifiedName,
                codeMethod: result.codeMethod,
                codeSentAt,
                resendAvailableAt: resendAvailableAt(codeSentAt),
            };
        } catch (err) {
            if (createdId) await releaseHostedNumber(createdId, request);
            await releaseClaim();
            if (err instanceof NumberOnboardingError) {
                request.log.error({ step: err.step, details: err.details }, 'hosted number start failed');
                throw classifyOnboardingError(err);
            }
            throw err;
        }
    });

    // POST /whatsapp/hosted/resend — send the OTP again, by SMS or voice call.
    fastify.post('/hosted/resend', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: { max: 3, timeWindow: '10 minutes', keyGenerator: perTenant('hosted-resend'), errorResponseBuilder: tooManyAttempts },
        },
    }, async (request) => {
        requireOwner(request);
        const body = z.object({ codeMethod: z.enum(['SMS', 'VOICE']).optional() }).parse(request.body ?? {});
        const outcome = await resendHostedCode(fastify.prisma, request.user.tenantId, body.codeMethod ?? 'SMS', request.log);
        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.hosted_code_resent',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { codeMethod: outcome.codeMethod },
            ipAddress: request.ip,
        });
        return outcome;
    });

    // POST /whatsapp/hosted/verify — check the OTP, then register for Cloud API.
    // If the code was accepted but registration failed, the number is left at
    // VERIFIED and a retry (no code needed) only re-runs registration.
    fastify.post('/hosted/verify', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: { max: 6, timeWindow: '10 minutes', keyGenerator: perTenant('hosted-verify'), errorResponseBuilder: tooManyAttempts },
        },
    }, async (request) => {
        requireOwner(request);
        if (!isPlatformWabaConfigured()) throw waError('HOSTED_NOT_AVAILABLE');
        const body = z.object({ code: z.string().trim().regex(/^[\d\s-]{4,12}$/).optional() }).parse(request.body ?? {});
        const tenantId = request.user.tenantId;

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true,
                whatsappRegistrationPin: true, whatsappDisplayNumber: true, whatsappVerifiedName: true,
            },
        });
        const status = tenant?.whatsappNumberStatus;
        if (!tenant?.whatsappHosted || !tenant.whatsappPhoneNumberId || (status !== 'PENDING_CODE' && status !== 'VERIFIED')) {
            throw waError('NO_PENDING_VERIFICATION');
        }
        if (!tenant.whatsappRegistrationPin) {
            throw waError('META_ERROR', 'Registration PIN missing. Disconnect and start again.');
        }
        const phoneNumberId = tenant.whatsappPhoneNumberId;

        try {
            if (status === 'PENDING_CODE') {
                if (!body.code) throw waError('INVALID_OTP', 'Enter the code we sent to your phone.');
                await verifyCode(phoneNumberId, body.code);
                await fastify.prisma.tenant.update({ where: { id: tenantId }, data: { whatsappNumberStatus: 'VERIFIED' } });
            }
        } catch (err) {
            if (err instanceof NumberOnboardingError) {
                request.log.warn({ step: err.step, details: err.details }, 'hosted code verify failed');
                throw classifyOnboardingError(err);
            }
            throw err;
        }

        try {
            await registerNumber(phoneNumberId, decrypt(tenant.whatsappRegistrationPin));
        } catch (err) {
            if (err instanceof NumberOnboardingError) {
                request.log.error({ step: err.step, details: err.details }, 'hosted register failed after a good code');
                const classified = classifyOnboardingError(err);
                throw classified.publicCode === 'TOO_MANY_ATTEMPTS'
                    ? classified
                    : waError('META_ERROR', 'Your code was accepted, but WhatsApp registration did not finish. Try again in a minute; no new code is needed.');
            }
            throw err;
        }

        const now = new Date();
        await fastify.prisma.tenant.update({
            where: { id: tenantId },
            data: { whatsappNumberStatus: 'REGISTERED', ...connectedData('BOOKLY_HOSTED', request.user.userId, now) },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.hosted_registered',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: { phoneNumberId },
            ipAddress: request.ip,
        });
        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: { mode: 'BOOKLY_HOSTED', via: 'hosted_otp', phoneNumberId, displayNumber: tenant.whatsappDisplayNumber },
            ipAddress: request.ip,
        });

        return {
            success: true,
            status: 'REGISTERED' as const,
            mode: 'BOOKLY_HOSTED' as const,
            displayNumber: tenant.whatsappDisplayNumber,
            verifiedName: tenant.whatsappVerifiedName,
            connectedAt: now,
        };
    });

    // POST /whatsapp/connect — manual fallback: ids + token pasted in.
    fastify.post('/connect', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: { max: 5, timeWindow: '10 minutes', keyGenerator: perTenant('manual-connect'), errorResponseBuilder: tooManyAttempts },
        },
    }, async (request) => {
        requireOwner(request);
        const body = z.object({
            phoneNumberId: z.string().min(1),
            accountId: z.string().min(1),
            accessToken: z.string().min(1),
            displayNumber: z.string().optional(),
        }).parse(request.body);
        const tenantId = request.user.tenantId;

        const existing = await fastify.prisma.tenant.findFirst({
            where: { whatsappPhoneNumberId: body.phoneNumberId, NOT: { id: tenantId } },
            select: { id: true },
        });
        if (existing) throw waError('NUMBER_IN_USE');

        // Never store ids we have not proved this token controls.
        await verifyManualCredentials(body);

        const current = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true },
        });
        if (current?.whatsappHosted && current.whatsappPhoneNumberId) {
            if (current.whatsappNumberStatus === 'REGISTERED') throw waError('ALREADY_CONNECTED');
            await releaseHostedNumber(current.whatsappPhoneNumberId, request);
        }

        try {
            await fastify.prisma.tenant.update({
                where: { id: tenantId },
                data: {
                    ...CLEARED_WHATSAPP,
                    whatsappPhoneNumberId: body.phoneNumberId,
                    whatsappAccountId: body.accountId,
                    whatsappAccessToken: encrypt(body.accessToken),
                    whatsappDisplayNumber: body.displayNumber ?? null,
                    ...connectedData('MANUAL', request.user.userId),
                },
            });
        } catch (err) {
            if (isUniqueViolation(err)) throw waError('NUMBER_IN_USE');
            throw err;
        }

        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: { mode: 'MANUAL', via: 'manual', phoneNumberId: body.phoneNumberId, displayNumber: body.displayNumber },
            ipAddress: request.ip,
        });

        return { success: true, mode: 'MANUAL' as const, displayNumber: body.displayNumber ?? null };
    });

    // POST /whatsapp/disconnect — works for a live number and for a hosted
    // number still waiting for its code (which frees its slot on our WABA).
    fastify.post('/disconnect', { preHandler: [fastify.authenticate] }, async (request) => {
        requireOwner(request);
        const outcome = await disconnectWhatsapp(fastify.prisma, request.user.tenantId, request.log);
        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: {
                mode: outcome.mode,
                phoneNumberId: outcome.phoneNumberId,
                displayNumber: outcome.displayNumber,
                metaCleanup: outcome.metaCleanup,
                by: 'owner',
            },
            ipAddress: request.ip,
        });
        return { success: true, wasConnected: outcome.hadNumber };
    });
};

export default connectionRoutes;
