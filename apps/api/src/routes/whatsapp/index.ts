import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { markReadAndTyping } from '../../services/whatsapp-presence.js';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import {
    completeEmbeddedSignup,
    EmbeddedSignupError,
} from '../../services/meta-embedded-signup.js';
import {
    isPlatformWabaConfigured,
    startHostedNumber,
    resendVerificationCode,
    verifyAndRegister,
    deleteHostedNumber,
    countHostedNumbers,
    subscribePlatformWaba,
    NumberOnboardingError,
} from '../../services/meta-number-onboarding.js';
import {
    getWhatsappCredentials,
    resolveCredentials,
    selectCredentialSource,
} from '../../services/whatsapp-credentials.js';
import { publish } from '../../services/realtime.js';

/**
 * Meta caps a business portfolio at 20 registered business phone numbers, so
 * Bookly's own WABA can host at most this many tenants before Meta has to
 * raise the limit. Guarding here turns "the 21st tenant's onboarding fails
 * with a Graph error" into a clear message we can act on.
 */
const HOSTED_NUMBER_LIMIT = 20;

/**
 * Verify Meta's `X-Hub-Signature-256` header against the raw request body
 * using the app secret. Returns true only on a constant-time match.
 */
function verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!rawBody || !signatureHeader) return false;
    if (!signatureHeader.startsWith('sha256=')) return false;

    const provided = signatureHeader.slice('sha256='.length);
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    if (provided.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

function safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

// WhatsApp webhook payload types
interface WhatsAppMessage {
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    interactive?: {
        type: string;
        button_reply?: { id: string; title: string };
        list_reply?: { id: string; title: string };
    };
    // Media arrives as an id we can fetch later, plus an optional caption.
    image?: { id?: string; mime_type?: string; caption?: string };
    video?: { id?: string; mime_type?: string; caption?: string };
    audio?: { id?: string; mime_type?: string; voice?: boolean };
    sticker?: { id?: string; mime_type?: string };
    document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    contacts?: Array<{
        name?: { formatted_name?: string };
        phones?: Array<{ phone?: string }>;
    }>;
    reaction?: { message_id: string; emoji?: string };
}

interface WhatsAppWebhookPayload {
    object: string;
    entry: Array<{
        id: string;
        changes: Array<{
            value: {
                messaging_product: string;
                metadata: {
                    display_phone_number: string;
                    phone_number_id: string;
                };
                contacts?: Array<{ profile: { name: string }; wa_id: string }>;
                messages?: WhatsAppMessage[];
                statuses?: Array<{
                    id: string;
                    status: 'sent' | 'delivered' | 'read' | 'failed';
                    timestamp?: string;
                    recipient_id?: string;
                    errors?: Array<{ code: number; title: string; message?: string }>;
                    // What Meta actually billed this message as. Authoritative —
                    // it accounts for free allowances, free entry-point windows
                    // and template re-categorisation, none of which we can infer.
                    pricing?: {
                        billable?: boolean;
                        pricing_model?: string;
                        category?: string;
                        type?: string;
                    };
                }>;
            };
            field: string;
        }>;
    }>;
}

/**
 * Turn a Graph API failure into something a salon owner can act on.
 *
 * Meta's raw errors are written for developers ("(#100) Invalid parameter"),
 * and the single most common onboarding failure — the number already has a
 * personal WhatsApp account on it — is otherwise indistinguishable from a
 * typo. Anything unrecognised falls through to the raw detail so we never
 * hide a real cause behind a friendly guess.
 */
function hostedErrorMessage(err: NumberOnboardingError): string {
    const d = err.details.toLowerCase();

    if (err.step === 'validate') {
        return err.details.replace(/^number_onboarding_validate: /, '');
    }
    if (d.includes('already') && (d.includes('whatsapp') || d.includes('registered') || d.includes('exists'))) {
        return 'That number already has a WhatsApp account. Delete WhatsApp on that phone (Settings → Account → Delete my account), wait a few minutes, then try again — or use a different number.';
    }
    if (err.step === 'verify_code' || d.includes('code') && d.includes('invalid')) {
        return 'That code was not accepted. Check the digits, or send a new code.';
    }
    if (d.includes('rate') || d.includes('too many') || d.includes('133016')) {
        return 'Too many attempts on this number. Wait about an hour before trying again — each retry extends the wait.';
    }
    if (err.step === 'request_code') {
        return 'We could not send the code to that number. Check it is correct and can receive SMS, or try a voice call instead.';
    }
    return `WhatsApp setup failed at the ${err.step.replace(/_/g, ' ')} step. ${err.details}`;
}

const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /whatsapp/webhook - Webhook verification
    fastify.get('/webhook', async (request, reply) => {
        const query = z.object({
            'hub.mode': z.string(),
            'hub.verify_token': z.string(),
            'hub.challenge': z.string(),
        }).parse(request.query);

        if (
            query['hub.mode'] === 'subscribe' &&
            safeEqual(query['hub.verify_token'], config.whatsapp.webhookVerifyToken)
        ) {
            fastify.log.info('WhatsApp webhook verified');
            return reply.send(query['hub.challenge']);
        }

        throw fastify.httpErrors.forbidden('Verification failed');
    });

    // POST /whatsapp/webhook - Receive messages.
    // Excluded from the global rate limit: Meta bursts webhook deliveries
    // during busy hours, and a 100/min cap rejects valid traffic + triggers
    // exponential retry storms. Defence-in-depth comes from HMAC + msg-id
    // dedupe (below), not from request-count throttling.
    fastify.post('/webhook', { config: { rateLimit: false } }, async (request, reply) => {
        // Verify Meta signature against the raw body BEFORE acknowledging.
        // Unsigned or mismatched payloads are rejected — they cannot forge
        // inbound messages, bookings, or conversations.
        const signature = request.headers['x-hub-signature-256'];
        const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
        const rawBody = (request as any).rawBody as Buffer | undefined;

        if (!verifyMetaSignature(rawBody, signatureHeader, config.whatsapp.appSecret)) {
            fastify.log.warn({ hasSignature: !!signatureHeader }, 'Webhook signature verification failed');
            throw fastify.httpErrors.unauthorized('Invalid webhook signature');
        }

        const payload = request.body as WhatsAppWebhookPayload;

        // Immediately respond to acknowledge receipt
        reply.send({ status: 'received' });

        // Process asynchronously
        setImmediate(async () => {
            try {
                await processWebhook(fastify, payload);
            } catch (err) {
                fastify.log.error(err, 'Error processing webhook');
            }
        });
    });

    // ===================================
    // Protected routes (require auth)
    // ===================================

    // GET /whatsapp/status - Get WhatsApp connection status
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: {
                whatsappPhoneNumberId: true,
                whatsappAccountId: true,
                whatsappDisplayNumber: true,
                whatsappHosted: true,
                whatsappNumberStatus: true,
            },
        });

        // A hosted number that has been created but not yet verified is NOT
        // connected — Meta rejects sends on it — so the UI must show the OTP
        // step rather than a green "live" badge.
        const awaitingCode =
            !!tenant?.whatsappHosted && tenant.whatsappNumberStatus === 'PENDING_CODE';

        return {
            connected: !!tenant?.whatsappPhoneNumberId && !awaitingCode,
            phoneNumberId: tenant?.whatsappPhoneNumberId,
            displayNumber: tenant?.whatsappDisplayNumber,
            hosted: !!tenant?.whatsappHosted,
            numberStatus: tenant?.whatsappNumberStatus ?? null,
            awaitingCode,
            // Drives which onboarding choices the UI offers.
            hostedAvailable: isPlatformWabaConfigured(),
        };
    });

    // ---- Phase 6: Bookly-hosted numbers -------------------------------
    // The tenant's number is added to Bookly's OWN WABA, so Meta bills Bookly
    // and the tenant pays one local-currency bill to Bookly instead of needing
    // a card Meta accepts. See services/meta-number-onboarding.ts for why.

    // POST /whatsapp/hosted/start — add the number to our WABA and send an OTP.
    fastify.post('/hosted/start', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '10 minutes',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:hosted-start`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect WhatsApp');
        }
        if (!isPlatformWabaConfigured()) {
            throw fastify.httpErrors.serviceUnavailable(
                'Hosted WhatsApp numbers are not available yet. Connect your own WhatsApp instead.',
            );
        }

        const body = z.object({
            countryCode: z.string().min(1).max(4),
            localNumber: z.string().min(4).max(20),
            codeMethod: z.enum(['SMS', 'VOICE']).optional(),
        }).parse(request.body);

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { name: true, whatsappPhoneNumberId: true, whatsappHosted: true },
        });

        if (tenant?.whatsappPhoneNumberId) {
            throw fastify.httpErrors.conflict(
                'A WhatsApp number is already connected. Disconnect it first.',
            );
        }

        // Guard the portfolio cap before spending a slot.
        const used = await countHostedNumbers().catch(() => 0);
        if (used >= HOSTED_NUMBER_LIMIT) {
            throw fastify.httpErrors.serviceUnavailable(
                'All hosted numbers are in use. Connect your own WhatsApp instead.',
            );
        }

        try {
            const result = await startHostedNumber({
                countryCode: body.countryCode,
                localNumber: body.localNumber,
                verifiedName: tenant?.name ?? 'Bookly',
                codeMethod: body.codeMethod,
            });

            // Our app must be subscribed to our WABA for inbound webhooks.
            // Idempotent, and a failure here would silently break replies, so
            // it is not swallowed.
            await subscribePlatformWaba();

            // The two-step PIN is generated per number and kept encrypted: Meta
            // demands it again on any re-register after a display-name change.
            const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

            await fastify.prisma.tenant.update({
                where: { id: request.user.tenantId },
                data: {
                    whatsappPhoneNumberId: result.phoneNumberId,
                    whatsappAccountId: config.platformWhatsapp.wabaId,
                    whatsappAccessToken: null, // hosted numbers use the platform token
                    whatsappDisplayNumber: result.displayNumber,
                    whatsappHosted: true,
                    whatsappNumberStatus: 'PENDING_CODE',
                    whatsappRegistrationPin: encrypt(pin),
                },
            });

            await audit({
                prisma: fastify.prisma,
                action: 'whatsapp.hosted_started',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId: request.user.tenantId,
                metadata: {
                    phoneNumberId: result.phoneNumberId,
                    displayNumber: result.displayNumber,
                    codeMethod: result.codeMethod,
                },
                ipAddress: request.ip,
            });

            return {
                success: true,
                displayNumber: result.displayNumber,
                codeMethod: result.codeMethod,
                status: 'PENDING_CODE',
            };
        } catch (err) {
            if (err instanceof NumberOnboardingError) {
                fastify.log.error({ step: err.step, details: err.details }, 'hosted number start failed');
                throw fastify.httpErrors.badRequest(hostedErrorMessage(err));
            }
            throw err;
        }
    });

    // POST /whatsapp/hosted/resend — send the OTP again, optionally by voice.
    fastify.post('/hosted/resend', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '10 minutes',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:hosted-resend`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect WhatsApp');
        }

        const body = z.object({ codeMethod: z.enum(['SMS', 'VOICE']).optional() }).parse(
            request.body ?? {},
        );

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { whatsappPhoneNumberId: true, whatsappHosted: true, whatsappNumberStatus: true },
        });

        if (!tenant?.whatsappHosted || tenant.whatsappNumberStatus !== 'PENDING_CODE' || !tenant.whatsappPhoneNumberId) {
            throw fastify.httpErrors.badRequest('No number is waiting for a verification code.');
        }

        try {
            await resendVerificationCode(tenant.whatsappPhoneNumberId, body.codeMethod ?? 'SMS');
            return { success: true };
        } catch (err) {
            if (err instanceof NumberOnboardingError) {
                fastify.log.error({ step: err.step, details: err.details }, 'hosted resend failed');
                throw fastify.httpErrors.badRequest(hostedErrorMessage(err));
            }
            throw err;
        }
    });

    // POST /whatsapp/hosted/verify — verify the OTP and register for Cloud API.
    fastify.post('/hosted/verify', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '10 minutes',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:hosted-verify`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect WhatsApp');
        }

        const body = z.object({ code: z.string().min(4).max(10) }).parse(request.body);

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: {
                whatsappPhoneNumberId: true,
                whatsappHosted: true,
                whatsappNumberStatus: true,
                whatsappRegistrationPin: true,
                whatsappDisplayNumber: true,
            },
        });

        if (!tenant?.whatsappHosted || tenant.whatsappNumberStatus !== 'PENDING_CODE' || !tenant.whatsappPhoneNumberId) {
            throw fastify.httpErrors.badRequest('No number is waiting for a verification code.');
        }
        if (!tenant.whatsappRegistrationPin) {
            throw fastify.httpErrors.internalServerError(
                'Registration PIN missing. Disconnect and start again.',
            );
        }

        try {
            await verifyAndRegister(
                tenant.whatsappPhoneNumberId,
                body.code,
                decrypt(tenant.whatsappRegistrationPin),
            );

            await fastify.prisma.tenant.update({
                where: { id: request.user.tenantId },
                data: { whatsappNumberStatus: 'REGISTERED' },
            });

            await audit({
                prisma: fastify.prisma,
                action: 'whatsapp.hosted_registered',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId: request.user.tenantId,
                metadata: { phoneNumberId: tenant.whatsappPhoneNumberId },
                ipAddress: request.ip,
            });

            return {
                success: true,
                status: 'REGISTERED',
                displayNumber: tenant.whatsappDisplayNumber,
            };
        } catch (err) {
            if (err instanceof NumberOnboardingError) {
                fastify.log.error({ step: err.step, details: err.details }, 'hosted verify failed');
                throw fastify.httpErrors.badRequest(hostedErrorMessage(err));
            }
            throw err;
        }
    });

    // POST /whatsapp/connect - Store WhatsApp credentials after embedded signup
    fastify.post('/connect', {
        preHandler: [fastify.authenticate],
    }, async (request) => {
        // Only OWNER can connect WhatsApp
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect WhatsApp');
        }

        const body = z.object({
            phoneNumberId: z.string(),
            accountId: z.string(),
            accessToken: z.string(),
            displayNumber: z.string().optional(),
        }).parse(request.body);

        // Check if phone number is already used by another tenant
        const existing = await fastify.prisma.tenant.findFirst({
            where: {
                whatsappPhoneNumberId: body.phoneNumberId,
                NOT: { id: request.user.tenantId },
            },
        });

        if (existing) {
            throw fastify.httpErrors.conflict('Phone number already connected to another account');
        }

        // Encrypt access token before storing
        const encryptedToken = encrypt(body.accessToken);
        const tenant = await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                whatsappPhoneNumberId: body.phoneNumberId,
                whatsappAccountId: body.accountId,
                whatsappAccessToken: encryptedToken,
                whatsappDisplayNumber: body.displayNumber,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { phoneNumberId: body.phoneNumberId, displayNumber: body.displayNumber },
            ipAddress: request.ip,
        });

        return {
            success: true,
            displayNumber: tenant.whatsappDisplayNumber,
        };
    });

    // POST /whatsapp/embedded-signup - One-click Meta Embedded Signup completion.
    // Takes the FB Login `code` and performs the full Meta Graph API dance:
    // token exchange → WABA discovery → phone-number discovery → app subscribe.
    fastify.post('/embedded-signup', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:embedded-signup`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect WhatsApp');
        }

        // `redirectUri` is sent by the native app's WebView OAuth flow so the
        // token exchange can match the https redirect the code was issued for.
        // Web (FB JS SDK) omits it.
        const { code, redirectUri } = z
            .object({ code: z.string().min(1), redirectUri: z.string().url().optional() })
            .parse(request.body);

        let result;
        try {
            result = await completeEmbeddedSignup(code, redirectUri);
        } catch (err) {
            if (err instanceof EmbeddedSignupError) {
                request.log.warn({ step: err.step, details: err.details }, 'Embedded signup failed');
                throw fastify.httpErrors.badRequest(err.message);
            }
            throw err;
        }

        // Same phone-number-uniqueness check as the manual /connect path:
        // a phone number can only be connected to one tenant at a time.
        const existing = await fastify.prisma.tenant.findFirst({
            where: {
                whatsappPhoneNumberId: result.phoneNumberId,
                NOT: { id: request.user.tenantId },
            },
            select: { id: true },
        });
        if (existing) {
            throw fastify.httpErrors.conflict('Phone number already connected to another account');
        }

        try {
            await fastify.prisma.tenant.update({
                where: { id: request.user.tenantId },
                data: {
                    whatsappPhoneNumberId: result.phoneNumberId,
                    whatsappAccountId: result.wabaId,
                    whatsappAccessToken: encrypt(result.accessToken),
                    whatsappDisplayNumber: result.displayPhoneNumber,
                },
            });
        } catch (err) {
            // P2002 = Prisma unique-constraint violation. Catches the TOCTOU
            // window between our pre-check above and this write — another
            // tenant connected the same phoneNumberId in that gap. The Meta
            // side has already run to completion; record what happened so
            // support can release the conflicting tenant or hand the user
            // a different number.
            const isUnique =
                typeof err === 'object' &&
                err !== null &&
                (err as { code?: string }).code === 'P2002';
            await audit({
                prisma: fastify.prisma,
                action: 'whatsapp.connect_failed',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId: request.user.tenantId,
                metadata: {
                    via: 'embedded_signup',
                    phoneNumberId: result.phoneNumberId,
                    wabaId: result.wabaId,
                    reason: isUnique ? 'phone_collision_race' : 'db_write_failed',
                    error: err instanceof Error ? err.message : String(err),
                },
                ipAddress: request.ip,
            }).catch(() => undefined);
            if (isUnique) {
                throw fastify.httpErrors.conflict('Phone number already connected to another account');
            }
            throw err;
        }

        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: {
                via: 'embedded_signup',
                phoneNumberId: result.phoneNumberId,
                wabaId: result.wabaId,
                displayNumber: result.displayPhoneNumber,
            },
            ipAddress: request.ip,
        });

        return {
            success: true,
            displayNumber: result.displayPhoneNumber,
            verifiedName: result.verifiedName,
        };
    });

    // POST /whatsapp/disconnect - Disconnect WhatsApp
    fastify.post('/disconnect', {
        preHandler: [fastify.authenticate],
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect WhatsApp');
        }

        const current = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { whatsappPhoneNumberId: true, whatsappHosted: true },
        });

        // A hosted number occupies one of the portfolio's 20 slots, so it must
        // be removed from our WABA — not merely unlinked from the tenant row —
        // or abandoned onboardings permanently consume capacity. Best effort:
        // a Meta-side failure must not leave the tenant unable to disconnect.
        if (current?.whatsappHosted && current.whatsappPhoneNumberId) {
            try {
                await deleteHostedNumber(current.whatsappPhoneNumberId);
            } catch (err) {
                fastify.log.error(
                    { err, phoneNumberId: current.whatsappPhoneNumberId },
                    'failed to release hosted number from platform WABA — slot may need manual cleanup',
                );
            }
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                whatsappPhoneNumberId: null,
                whatsappAccountId: null,
                whatsappAccessToken: null,
                whatsappDisplayNumber: null,
                whatsappHosted: false,
                whatsappNumberStatus: null,
                whatsappRegistrationPin: null,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'whatsapp.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            ipAddress: request.ip,
        });

        return { success: true };
    });

    // GET /whatsapp/native-callback - https bridge for the mobile app's WebView
    // Embedded Signup. Facebook requires an https redirect_uri (not a custom app
    // scheme), so the dialog returns here; we bounce the `code` back into the
    // app via its deep-link scheme, where it is POSTed to /embedded-signup with
    // this same URL as `redirectUri`. Public + no rate limit (OAuth redirect).
    fastify.get('/native-callback', { config: { rateLimit: false } }, async (request, reply) => {
        const query = z
            .object({ code: z.string().optional(), error: z.string().optional(), state: z.string().optional() })
            .parse(request.query);

        const appScheme = 'bookly://whatsapp';
        const params = new URLSearchParams();
        if (query.code) params.set('code', query.code);
        if (query.error) params.set('error', query.error);
        return reply.redirect(`${appScheme}?${params.toString()}`);
    });

    // POST /whatsapp/send-test - Send a test message. Tight per-tenant
    // rate limit: testing is rare; high rate signals abuse and burns the
    // tenant's Meta messaging quota.
    fastify.post('/send-test', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:send-test`,
            },
        },
    }, async (request) => {
        const body = z.object({
            to: z.string(),
            message: z.string(),
        }).parse(request.body);

        const creds = await getWhatsappCredentials(fastify.prisma, request.user.tenantId);
        if (!creds) {
            throw fastify.httpErrors.badRequest('WhatsApp not connected');
        }

        const accessToken = creds.accessToken;
        const response = await fetch(
            `https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: body.to,
                    type: 'text',
                    text: { body: body.message },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            fastify.log.error({ status: response.status, error }, 'WhatsApp API error');
            throw fastify.httpErrors.badGateway('Failed to send WhatsApp message');
        }

        const result = await response.json() as { messages?: Array<{ id: string }> };
        fastify.log.info({ to: body.to, messageId: result.messages?.[0]?.id }, 'Test message sent');

        return { success: true, message: 'Test message sent', messageId: result.messages?.[0]?.id };
    });
};

// Process incoming webhook
async function processWebhook(
    fastify: any,
    payload: WhatsAppWebhookPayload
) {
    if (payload.object !== 'whatsapp_business_account') {
        return;
    }

    for (const entry of payload.entry) {
        for (const change of entry.changes) {
            if (change.field !== 'messages') continue;

            const value = change.value;
            const phoneNumberId = value.metadata.phone_number_id;

            // Find tenant by phone number ID
            const tenant = await fastify.prisma.tenant.findFirst({
                where: { whatsappPhoneNumberId: phoneNumberId },
            });

            if (!tenant) {
                fastify.log.warn({ phoneNumberId }, 'No tenant found for phone number');
                continue;
            }

            // Process messages
            if (value.messages) {
                for (const message of value.messages) {
                    await processMessage(fastify, tenant, message, value.contacts?.[0]);
                }
            }

            // Process status updates — delivery state for the dashboard's ticks,
            // and the billing category we charge from.
            if (value.statuses) {
                for (const status of value.statuses) {
                    await recordMessageStatus(fastify, status);
                }
            }
        }
    }
}

/**
 * Persist a delivery status update against the message it refers to.
 *
 * Two things come out of this webhook and nothing else supplies either:
 *  - `status` drives the ✓ / ✓✓ / read ticks in the dashboard.
 *  - `pricing` is Meta's own record of what the message was billed as. We store
 *    it rather than inferring the category from the send, because Meta applies
 *    free allowances, free entry-point windows and template re-categorisation
 *    that the sender cannot know about.
 *
 * Status can arrive out of order (a `read` may land before its `delivered`), so
 * a status is only written when it moves the message forward.
 */
const STATUS_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

async function recordMessageStatus(
    fastify: any,
    status: {
        id: string;
        status: string;
        errors?: Array<{ code: number; title: string; message?: string }>;
        pricing?: { billable?: boolean; category?: string; pricing_model?: string; type?: string };
    },
): Promise<void> {
    const next = status.status.toUpperCase();
    if (!STATUS_RANK[next]) return;

    const message = await fastify.prisma.message.findFirst({
        where: { whatsappMsgId: status.id },
        select: { id: true, status: true, metadata: true },
    });
    if (!message) return; // status for something we never stored

    // Never move a message backwards (read → delivered).
    const current = message.status ? STATUS_RANK[message.status] ?? 0 : 0;
    if (STATUS_RANK[next] <= current) return;

    const data: Record<string, unknown> = { status: next };

    if (status.pricing) {
        if (typeof status.pricing.category === 'string') data.billingCategory = status.pricing.category;
        if (typeof status.pricing.billable === 'boolean') data.billable = status.pricing.billable;
    }

    if (next === 'FAILED' && status.errors?.length) {
        data.metadata = {
            ...((message.metadata as Record<string, unknown>) ?? {}),
            failure: status.errors[0],
        };
    }

    await fastify.prisma.message.update({ where: { id: message.id }, data }).catch((err: unknown) => {
        fastify.log.warn({ err, whatsappMsgId: status.id }, 'Could not record message status');
    });
}

// Process individual message
async function processMessage(
    fastify: any,
    tenant: any,
    message: WhatsAppMessage,
    contact?: { profile: { name: string }; wa_id: string }
) {
    const customerPhone = message.from;
    const customerName = contact?.profile?.name;

    // Acknowledge immediately: blue ticks, plus "typing…" so the customer can
    // see the business is on it. Fire-and-forget — a presence failure must not
    // delay or block the actual reply.
    const presenceCreds = resolveCredentials(selectCredentialSource(tenant));
    if (presenceCreds && message.id) {
        void markReadAndTyping({
            phoneNumberId: presenceCreds.phoneNumberId,
            accessToken: presenceCreds.accessToken,
            messageId: message.id,
            logger: fastify.log,
        });
    }

    // Find or create conversation
    let conversation = await fastify.prisma.conversation.findUnique({
        where: {
            tenantId_customerPhone: {
                tenantId: tenant.id,
                customerPhone,
            },
        },
    });

    if (!conversation) {
        conversation = await fastify.prisma.conversation.create({
            data: {
                tenantId: tenant.id,
                customerPhone,
                customerName,
                state: 'BOT_ACTIVE',
            },
        });
    } else if (customerName && !conversation.customerName) {
        await fastify.prisma.conversation.update({
            where: { id: conversation.id },
            data: { customerName },
        });
    }

    // Idempotency: Meta retries webhooks aggressively. If we've already stored
    // this whatsappMsgId on this conversation, drop the duplicate before
    // advancing the bot state machine. Full (phoneNumberId, messageId) keying
    // is Phase 2; this kills the common-case duplicates.
    if (message.id) {
        const seen = await fastify.prisma.message.findFirst({
            where: { conversationId: conversation.id, whatsappMsgId: message.id },
            select: { id: true },
        });
        if (seen) {
            fastify.log.debug({ msgId: message.id }, 'Skipping duplicate inbound message');
            return;
        }
    }

    // Extract message content. `content` is the human-readable form every
    // existing surface renders (chat list preview, exports), while `meta`
    // carries the structured payload for the ones that can show more.
    let content = '';
    let messageType = 'TEXT';
    let meta: Record<string, unknown> | undefined;

    if (message.type === 'text' && message.text) {
        content = message.text.body;
    } else if (message.type === 'interactive' && message.interactive) {
        const reply = message.interactive.button_reply || message.interactive.list_reply;
        content = reply?.id || '';
        messageType = 'INTERACTIVE';
    } else if (message.type === 'location' && message.location) {
        const loc = message.location;
        content = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
        messageType = 'LOCATION';
        meta = { ...loc };
    } else if (message.type === 'contacts' && message.contacts?.length) {
        const first = message.contacts[0];
        content = first.name?.formatted_name || first.phones?.[0]?.phone || 'Contact';
        messageType = 'CONTACT';
        meta = { contacts: message.contacts };
    } else if (message.type === 'reaction' && message.reaction) {
        content = message.reaction.emoji || '(reaction removed)';
        messageType = 'REACTION';
        meta = { ...message.reaction };
    } else if (['image', 'video', 'audio', 'sticker', 'document'].includes(message.type)) {
        const payload = (message as unknown as Record<string, { id?: string; mime_type?: string; caption?: string; filename?: string; voice?: boolean }>)[message.type];
        messageType = message.type.toUpperCase();
        content = payload?.caption || payload?.filename || `[${message.type}]`;
        // Only the media id is stored. Downloading the bytes needs the tenant's
        // token and is a separate job — until then the dashboard shows the type
        // and caption rather than a broken image.
        meta = {
            kind: message.type,
            whatsappMediaId: payload?.id ?? null,
            mimeType: payload?.mime_type ?? null,
            ...(payload?.filename ? { filename: payload.filename } : {}),
            ...(payload?.voice ? { voice: true } : {}),
            inboundPending: true,
        };
    }

    // Store message
    await fastify.prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            content,
            messageType,
            whatsappMsgId: message.id,
            ...(meta ? { metadata: meta as object } : {}),
        },
    });

    // Update conversation timestamps. lastInboundAt powers the WhatsApp
    // 24-hour customer-service window check on staff replies.
    const now = new Date();
    await fastify.prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: now, lastInboundAt: now },
    });

    // Live nudge to any open app so the chat thread + inbox refetch instantly.
    publish(tenant.id, { type: 'message', conversationId: conversation.id });

    // Human takeover handling. While HUMAN_ACTIVE, the bot is silent — except
    // if the customer types one of the escape keywords, in which case we
    // resume the bot from a fresh WELCOME state. This prevents the
    // "ask for support → silent void" dead-end.
    if (conversation.state === 'HUMAN_ACTIVE') {
        const cmd = content.trim().toLowerCase();
        const RESUME_BOT_KEYWORDS = new Set(['menu', 'bot', 'start']);
        if (RESUME_BOT_KEYWORDS.has(cmd)) {
            fastify.log.info(
                { conversationId: conversation.id, cmd },
                'Customer requested bot resume — exiting human takeover',
            );
            await fastify.prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    state: 'BOT_ACTIVE',
                    botContext: { state: 'WELCOME' },
                    takeoverReason: null,
                    assignedUserId: null,
                    assignedAt: null,
                },
            });
            // Refresh local copy so the bot processor sees the new state.
            conversation.state = 'BOT_ACTIVE';
            conversation.botContext = { state: 'WELCOME' };
        } else {
            fastify.log.debug({ conversationId: conversation.id }, 'Human takeover active, skipping bot');
            return;
        }
    }

    // Check for automatic takeover triggers
    const { detectTakeover, triggerTakeover } = await import('../../services/human-takeover.js');
    // botContext is stored as Prisma Json — already deserialized.
    const botContext = (conversation.botContext as { state?: string } | null) ?? { state: 'WELCOME' };

    const takeoverResult = detectTakeover({
        messageContent: content,
        recentMessages: [],
        botFailureCount: conversation.botFailureCount || 0,
        state: botContext.state ?? 'WELCOME',
    });

    if (takeoverResult.shouldTakeover) {
        fastify.log.info({
            conversationId: conversation.id,
            reason: takeoverResult.reason,
            confidence: takeoverResult.confidence,
        }, 'Auto-triggering human takeover');

        await triggerTakeover(fastify.prisma, conversation.id, takeoverResult.reason || 'auto');

        // Conversation is now HUMAN_ACTIVE. Staff sees the handoff in
        // /conversations and replies manually from there. Customer notification
        // ("a human is on the way") is a Phase 5 polish item — staff usually
        // greets first via the dashboard within seconds anyway.
        return;
    }

    // Conversational layer. When OPENAI_API_KEY is set the LLM agent answers,
    // calling the same availability/booking services the menu bot uses; without
    // it we fall through to the state machine unchanged. That env var is the
    // entire rollout switch — and the fallback below means an OpenAI outage
    // degrades to the old bot rather than dropping the customer.
    const { isLlmEnabled } = await import('../../services/llm-agent.js');

    if (isLlmEnabled()) {
        try {
            await handleWithAgent(fastify, tenant, conversation, customerPhone, content);
            return;
        } catch (err) {
            fastify.log.error({ err, conversationId: conversation.id }, 'LLM agent failed — falling back to menu bot');
        }
    }

    // Process with bot engine. Pass the BullMQ queues so cancel/reschedule
    // flows can enqueue customer-facing notifications.
    const { WhatsAppBotEngine } = await import('../../services/whatsapp-bot.js');
    const bot = new WhatsAppBotEngine(fastify.prisma, tenant, {
        notifications: fastify.queues.notifications,
        reminders: fastify.queues.reminders,
    });
    await bot.processMessage(conversation.id, customerPhone, content);
}

/**
 * Run one customer turn through the LLM agent and send its reply.
 *
 * Quota is reserved the same way the menu bot reserves it, so an LLM
 * conversation can't bypass a tenant's monthly message limit.
 */
async function handleWithAgent(
    fastify: any,
    tenant: any,
    conversation: { id: string },
    customerPhone: string,
    content: string,
): Promise<void> {
    const { runAgent } = await import('../../services/llm-agent.js');
    const { checkOutboundQuota, incrementMessageUsage } = await import('../../services/usage.js');

    const quota = await checkOutboundQuota(fastify.prisma, tenant.id);
    if (!quota.ok) {
        fastify.log.warn({ tenantId: tenant.id }, 'Quota exhausted — agent reply suppressed');
        return;
    }

    const result = await runAgent(
        {
            prisma: fastify.prisma,
            tenantId: tenant.id,
            tenantName: tenant.name,
            timezone: tenant.timezone ?? 'UTC',
            currency: tenant.paymentCurrency ?? 'GHS',
            paystackSecretKeyEncrypted: tenant.paystackSecretKey ?? null,
            businessType: tenant.businessType ?? 'SERVICE',
            depositRequired: tenant.depositRequired ?? true,
            defaultDepositAmount: tenant.defaultDepositAmount ?? 50,
            conversationId: conversation.id,
            customerPhone,
            queues: fastify.queues,
            log: fastify.log,
        },
        content,
    );

    if (result.wantsHuman) {
        const { triggerTakeover } = await import('../../services/human-takeover.js');
        await triggerTakeover(
            fastify.prisma,
            conversation.id,
            'Assistant asked for a human',
        ).catch((err: unknown) => fastify.log.warn({ err }, 'Takeover from agent failed'));
    }

    const reply = result.reply.trim();
    if (!reply) return;

    const agentCreds = resolveCredentials(selectCredentialSource(tenant));
    if (!agentCreds) return;
    const accessToken = agentCreds.accessToken;
    const response = await fetch(
        `https://graph.facebook.com/v21.0/${agentCreds.phoneNumberId}/messages`,
        {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: customerPhone,
                type: 'text',
                text: { body: reply },
            }),
        },
    );

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        fastify.log.error({ status: response.status, error }, 'Failed to send agent reply');
        return;
    }

    const sent = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };

    await fastify.prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            content: reply,
            messageType: 'TEXT',
            whatsappMsgId: sent.messages?.[0]?.id ?? null,
            metadata: { source: 'llm', model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', tools: result.toolsUsed },
        },
    });

    await incrementMessageUsage(fastify.prisma, tenant.id);
}

export default whatsappRoutes;
