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
import { resolveConversation } from '../../services/conversation-resolver.js';
import { sendChannelText, resolveChannelCredentials } from '../../services/channel-send.js';
import { publish } from '../../services/realtime.js';
import {
    planAssistantFallback,
    isDuplicateMessageError,
    HOLDING_MESSAGE_COOLDOWN_MS,
} from '../../services/assistant-fallback.js';
import { Prisma } from '@prisma/client';

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

/**
 * Messenger / Instagram webhook payload. Nothing like the WhatsApp one: the
 * sender is a scoped id, there is no phone anywhere, and messages arrive under
 * `messaging` rather than `changes`.
 */
interface MessagingWebhookPayload {
    object: string;
    entry: Array<{
        /** Page id for Messenger; IG user id for Instagram. */
        id: string;
        time?: number;
        messaging?: Array<{
            sender?: { id?: string };
            recipient?: { id?: string };
            timestamp?: number;
            message?: {
                mid?: string;
                text?: string;
                is_echo?: boolean;
                attachments?: Array<{ type?: string }>;
            };
        }>;
    }>;
}

/**
 * Handle an inbound Instagram DM or Messenger message.
 *
 * Routing is by the receiving account, not the sender: Messenger identifies the
 * business by Page id, Instagram by IG user id, and both are unique per tenant.
 */
async function processMessagingWebhook(
    fastify: any,
    payload: MessagingWebhookPayload,
    channel: 'INSTAGRAM' | 'MESSENGER',
) {
    for (const entry of payload.entry ?? []) {
        const tenant = await fastify.prisma.tenant.findFirst({
            where: channel === 'INSTAGRAM'
                ? { instagramUserId: entry.id }
                : { facebookPageId: entry.id },
        });

        if (!tenant) {
            fastify.log.warn({ accountId: entry.id, channel }, 'No tenant for messaging account');
            continue;
        }

        for (const event of entry.messaging ?? []) {
            // Echoes are our own outbound messages coming back. Handling them
            // would have the bot reply to itself, forever.
            if (event.message?.is_echo) continue;

            const senderId = event.sender?.id;
            const text = event.message?.text;
            if (!senderId || !text) continue;

            await processChannelMessage(fastify, tenant, {
                channel,
                senderId,
                text,
                providerMessageId: event.message?.mid,
            });
        }
    }
}

/**
 * Store and answer one inbound Instagram DM or Messenger message.
 *
 * Deliberately thinner than the WhatsApp path: there are no templates, no read
 * receipts and no media handling on these channels yet, and no per-message fee
 * to Meta either. What it shares is everything that matters — the same
 * conversation model, the same agent, the same booking tools.
 */
async function processChannelMessage(
    fastify: any,
    tenant: any,
    input: {
        channel: 'INSTAGRAM' | 'MESSENGER';
        senderId: string;
        text: string;
        providerMessageId?: string;
    },
) {
    const conversation = await resolveConversation(fastify.prisma, {
        tenantId: tenant.id,
        channel: input.channel,
        externalId: input.senderId,
    });

    // Duplicate delivery is normal — Meta retries. The provider id is unique
    // per message, so it is what tells a retry from a genuinely new message.
    if (input.providerMessageId) {
        const seen = await fastify.prisma.message.findFirst({
            where: { conversationId: conversation.id, whatsappMsgId: input.providerMessageId },
            select: { id: true },
        });
        if (seen) return;
    }

    try {
        await fastify.prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'INBOUND',
                content: input.text,
                messageType: 'TEXT',
                whatsappMsgId: input.providerMessageId ?? null,
                metadata: { channel: input.channel },
            },
        });
    } catch (err) {
        // Two redeliveries raced past the findFirst above; the unique
        // constraint caught the loser.
        if (isDuplicateMessageError(err)) {
            fastify.log.debug({ providerMessageId: input.providerMessageId }, 'Skipping duplicate inbound message');
            return;
        }
        throw err;
    }

    // Opens the 24-hour reply window. It applies on these channels too, but
    // without a template escape hatch once it closes.
    await fastify.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
    });

    publish(tenant.id, { type: 'message', conversationId: conversation.id });

    // A human has taken over — stay out of the way.
    if (conversation.state === 'HUMAN_ACTIVE') return;

    const { isLlmEnabled } = await import('../../services/llm-agent.js');
    const llmEnabled = isLlmEnabled();
    let agentThrew = false;
    const progress: AgentProgress = { replySent: false };

    if (llmEnabled) {
        try {
            await handleWithAgent(
                fastify,
                tenant,
                conversation,
                // Empty on a first contact — these channels expose no phone. The
                // agent then asks for one and create_booking refuses until it has
                // it. On later turns this is whatever the customer already gave.
                conversation.customerPhone ?? '',
                input.text,
                input.channel,
                input.senderId,
                progress,
            );
            if ((conversation.botFailureCount || 0) > 0) {
                await fastify.prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { botFailureCount: 0 },
                });
            }
            return;
        } catch (err) {
            agentThrew = true;
            fastify.log.error(
                { err, channel: input.channel, replySent: progress.replySent },
                'Agent failed on messaging channel',
            );
        }
    }

    await runAssistantFallback(fastify, tenant, conversation, {
        llmEnabled,
        agentThrew,
        replySent: progress.replySent,
        channel: input.channel,
        recipientId: input.senderId,
    });
}

// Process incoming webhook
async function processWebhook(
    fastify: any,
    payload: WhatsAppWebhookPayload
) {
    // Meta posts all three channels to this one verified URL and tells them
    // apart by `object`. Messenger and Instagram use an entirely different
    // payload shape (entry[].messaging[] rather than entry[].changes[]), so
    // they get their own handler.
    if (payload.object === 'page' || payload.object === 'instagram') {
        await processMessagingWebhook(
            fastify,
            payload as unknown as MessagingWebhookPayload,
            payload.object === 'instagram' ? 'INSTAGRAM' : 'MESSENGER',
        );
        return;
    }

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

    // Find or create conversation. On WhatsApp the phone IS the channel
    // identity, so it is both externalId and the stored phone.
    const conversation = await resolveConversation(fastify.prisma, {
        tenantId: tenant.id,
        channel: 'WHATSAPP',
        externalId: customerPhone,
        customerPhone,
        customerName,
    });

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

    // Acknowledge once the message is known to be new (a redelivery must not
    // flash a second typing bubble): blue ticks, plus "typing…" so the customer can
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

    // Store message. The unique (conversationId, whatsappMsgId) constraint
    // closes the race the findFirst above can't: a concurrent redelivery that
    // passed the check loses here and is treated as a duplicate.
    try {
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
    } catch (err) {
        if (isDuplicateMessageError(err)) {
            fastify.log.debug({ msgId: message.id }, 'Skipping duplicate inbound message');
            return;
        }
        throw err;
    }

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
    // hand the conversation back to the assistant. This prevents the
    // "ask for support → silent void" dead-end.
    if (conversation.state === 'HUMAN_ACTIVE') {
        const cmd = content.trim().toLowerCase();
        const RESUME_BOT_KEYWORDS = new Set(['menu', 'bot', 'start']);
        // A conversation a staff member has claimed stays with them: the
        // customer must not be able to pull it back (and clear the
        // assignment) by typing a keyword.
        const owner = RESUME_BOT_KEYWORDS.has(cmd)
            ? await fastify.prisma.conversation.findUnique({
                  where: { id: conversation.id },
                  select: { assignedUserId: true },
              })
            : null;
        if (RESUME_BOT_KEYWORDS.has(cmd) && !owner?.assignedUserId) {
            fastify.log.info(
                { conversationId: conversation.id, cmd },
                'Customer requested bot resume — exiting human takeover',
            );
            await fastify.prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    state: 'BOT_ACTIVE',
                    botContext: Prisma.JsonNull,
                    botFailureCount: 0,
                    takeoverReason: null,
                    assignedUserId: null,
                    assignedAt: null,
                },
            });
            // Refresh local copy so the checks below see the new state.
            conversation.state = 'BOT_ACTIVE';
            conversation.botFailureCount = 0;
        } else {
            fastify.log.debug({ conversationId: conversation.id }, 'Human takeover active, skipping bot');
            return;
        }
    }

    // Check for automatic takeover triggers
    const { detectTakeover, triggerTakeover } = await import('../../services/human-takeover.js');
    const takeoverResult = detectTakeover({
        messageContent: content,
        recentMessages: [],
        botFailureCount: conversation.botFailureCount || 0,
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

    // Conversational layer. When OPENAI_API_KEY is set the LLM agent answers.
    // There is no scripted fallback: if the assistant is unavailable or throws,
    // the conversation is handed to a human and the customer gets one neutral
    // holding message.
    const { isLlmEnabled } = await import('../../services/llm-agent.js');

    let agentThrew = false;
    const progress: AgentProgress = { replySent: false };
    const llmEnabled = isLlmEnabled();
    if (llmEnabled) {
        try {
            await handleWithAgent(fastify, tenant, conversation, customerPhone, content, 'WHATSAPP', undefined, progress);
            // The assistant coped, so any earlier failures no longer count
            // against this conversation.
            if ((conversation.botFailureCount || 0) > 0) {
                await fastify.prisma.conversation.update({
                    where: { id: conversation.id },
                    data: { botFailureCount: 0 },
                });
            }
            return;
        } catch (err) {
            agentThrew = true;
            fastify.log.error({ err, conversationId: conversation.id, replySent: progress.replySent }, 'LLM agent failed');
        }
    }

    await runAssistantFallback(fastify, tenant, conversation, {
        llmEnabled,
        agentThrew,
        replySent: progress.replySent,
        channel: 'WHATSAPP',
        recipientId: customerPhone,
    });
}

type ChannelKind = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';

/** Mutated by handleWithAgent so a failure handler knows the reply went out. */
interface AgentProgress {
    replySent: boolean;
}

/**
 * Decide and carry out what happens when the assistant could not answer.
 * Shared by WhatsApp and Instagram/Messenger so the two cannot drift.
 */
async function runAssistantFallback(
    fastify: any,
    tenant: any,
    conversation: { id: string; botFailureCount?: number | null },
    input: {
        llmEnabled: boolean;
        agentThrew: boolean;
        replySent: boolean;
        channel: ChannelKind;
        recipientId: string;
    },
): Promise<void> {
    const plan = planAssistantFallback({
        llmEnabled: input.llmEnabled,
        agentThrew: input.agentThrew,
        replySent: input.replySent,
        priorFailures: conversation.botFailureCount || 0,
        holdingSentRecently: await holdingSentRecently(fastify.prisma, conversation.id),
    });

    if (plan.action === 'retry_later') {
        await fastify.prisma.conversation.update({
            where: { id: conversation.id },
            data: { botFailureCount: { increment: 1 } },
        });
        await sendSystemMessage(fastify, tenant, conversation.id, {
            channel: input.channel,
            recipientId: input.recipientId,
            text: plan.message,
            kind: 'retry',
        });
        return;
    }

    if (plan.action === 'handoff') {
        const { triggerTakeover } = await import('../../services/human-takeover.js');
        // Takeover goes first and is the load-bearing part: once HUMAN_ACTIVE,
        // later inbound messages are silent. If it fails, send nothing — a
        // holding message with the bot still active would repeat every turn.
        try {
            await triggerTakeover(fastify.prisma, conversation.id, plan.reason);
        } catch (err) {
            fastify.log.error({ err, conversationId: conversation.id }, 'Takeover after assistant failure failed');
            return;
        }
        fastify.log.warn(
            { conversationId: conversation.id, reason: plan.reason },
            'Assistant unavailable — conversation handed to a human',
        );
        if (plan.holdingMessage) {
            await sendSystemMessage(fastify, tenant, conversation.id, {
                channel: input.channel,
                recipientId: input.recipientId,
                text: plan.holdingMessage,
                kind: 'holding',
                reason: plan.reason,
            });
        }
    }
}

/** A holding message went to this conversation within the cooldown window. */
async function holdingSentRecently(prisma: any, conversationId: string): Promise<boolean> {
    const since = new Date(Date.now() - HOLDING_MESSAGE_COOLDOWN_MS);
    const recent = await prisma.message.findFirst({
        where: {
            conversationId,
            direction: 'OUTBOUND',
            createdAt: { gte: since },
            metadata: { path: ['kind'], equals: 'holding' },
        },
        select: { id: true },
    });
    return Boolean(recent);
}

/**
 * Send a short system-authored message (holding / retry). Reserves quota
 * atomically, releases it if the send fails, and never throws: by the time
 * this runs the customer-facing outcome is decided, and a failure here must
 * not bubble up and fail the webhook.
 */
async function sendSystemMessage(
    fastify: any,
    tenant: any,
    conversationId: string,
    input: { channel: ChannelKind; recipientId: string; text: string; kind: string; reason?: string },
): Promise<void> {
    const { tryReserveOutbound, rollbackOutboundReservation } = await import('../../services/usage.js');

    const creds = resolveChannelCredentials(
        tenant,
        input.channel,
        decrypt,
        resolveCredentials(selectCredentialSource(tenant)),
    );
    if (!creds) return;

    const reservation = await tryReserveOutbound(fastify.prisma, tenant.id);
    if (!reservation.ok) {
        fastify.log.warn({ tenantId: tenant.id, kind: input.kind }, 'Quota exhausted — system message suppressed');
        return;
    }

    let providerMessageId: string | undefined;
    try {
        const sent = await sendChannelText({
            channel: input.channel,
            credentials: creds,
            recipientId: input.recipientId,
            text: input.text,
        });
        providerMessageId = sent.messageId;
    } catch (err) {
        fastify.log.error({ err, channel: input.channel, kind: input.kind }, 'Failed to send system message');
        await rollbackOutboundReservation(fastify.prisma, tenant.id).catch(() => undefined);
        return;
    }

    try {
        await fastify.prisma.message.create({
            data: {
                conversationId,
                direction: 'OUTBOUND',
                content: input.text,
                messageType: 'TEXT',
                whatsappMsgId: providerMessageId ?? null,
                metadata: { source: 'system', kind: input.kind, reason: input.reason ?? null, channel: input.channel },
            },
        });
    } catch (err) {
        // Sent and billed; only the transcript row is missing.
        fastify.log.error({ err, conversationId, kind: input.kind }, 'System message sent but not recorded');
    }
}

/**
 * Run one customer turn through the LLM agent and send its reply.
 *
 * The quota is checked first, so an LLM
 * conversation can't bypass a tenant's monthly message limit.
 */
async function handleWithAgent(
    fastify: any,
    tenant: any,
    conversation: { id: string },
    customerPhone: string,
    content: string,
    channel: ChannelKind = 'WHATSAPP',
    /** Who to reply to on this channel — phone, PSID or IGSID. */
    recipientId?: string,
    progress: AgentProgress = { replySent: false },
): Promise<void> {
    const { runAgent } = await import('../../services/llm-agent.js');
    const { checkOutboundQuota, tryReserveOutbound, rollbackOutboundReservation } =
        await import('../../services/usage.js');

    // Cheap early exit so an exhausted tenant doesn't pay for an LLM call.
    // The authoritative, race-safe reservation happens just before the send.
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
            channel,
            // Lets a customer who types "024…" have it completed to the
            // business's own country rather than refused.
            businessPhone: tenant.whatsappDisplayNumber ?? null,
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

    const creds = resolveChannelCredentials(
        tenant,
        channel,
        decrypt,
        resolveCredentials(selectCredentialSource(tenant)),
    );
    if (!creds) return;

    // check-then-increment is not safe under concurrency (see usage.ts);
    // reserve atomically and release on a failed send.
    const reservation = await tryReserveOutbound(fastify.prisma, tenant.id);
    if (!reservation.ok) {
        fastify.log.warn({ tenantId: tenant.id }, 'Quota exhausted — agent reply suppressed');
        return;
    }

    let providerMessageId: string | undefined;
    try {
        const sent = await sendChannelText({
            channel,
            credentials: creds,
            recipientId: recipientId ?? customerPhone,
            text: reply,
        });
        providerMessageId = sent.messageId;
    } catch (err) {
        fastify.log.error({ err, channel }, 'Failed to send agent reply');
        await rollbackOutboundReservation(fastify.prisma, tenant.id).catch(() => undefined);
        return;
    }
    progress.replySent = true;

    // The customer has the reply. A failure recording it must not surface as
    // an agent failure, or the fallback would follow a real answer with a
    // handoff.
    try {
        await fastify.prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'OUTBOUND',
                content: reply,
                messageType: 'TEXT',
                whatsappMsgId: providerMessageId ?? null,
                metadata: { source: 'llm', channel, model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', tools: result.toolsUsed },
            },
        });
    } catch (err) {
        fastify.log.error({ err, conversationId: conversation.id }, 'Agent reply sent but not recorded');
    }
}

export default whatsappRoutes;
