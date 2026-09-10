import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import {
    completeEmbeddedSignup,
    EmbeddedSignupError,
} from '../../services/meta-embedded-signup.js';
import { publish } from '../../services/realtime.js';

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
                statuses?: Array<{ id: string; status: string }>;
            };
            field: string;
        }>;
    }>;
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
            },
        });

        return {
            connected: !!tenant?.whatsappPhoneNumberId,
            phoneNumberId: tenant?.whatsappPhoneNumberId,
            displayNumber: tenant?.whatsappDisplayNumber,
        };
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

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                whatsappPhoneNumberId: null,
                whatsappAccountId: null,
                whatsappAccessToken: null,
                whatsappDisplayNumber: null,
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

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
        });

        if (!tenant?.whatsappPhoneNumberId || !tenant.whatsappAccessToken) {
            throw fastify.httpErrors.badRequest('WhatsApp not connected');
        }

        // Decrypt access token and send via WhatsApp Cloud API
        const accessToken = decrypt(tenant.whatsappAccessToken);
        const response = await fetch(
            `https://graph.facebook.com/v21.0/${tenant.whatsappPhoneNumberId}/messages`,
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

            // Process status updates
            if (value.statuses) {
                for (const status of value.statuses) {
                    fastify.log.debug({ status }, 'Message status update');
                }
            }
        }
    }
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

    // Extract message content
    let content = '';
    let messageType = 'TEXT';

    if (message.type === 'text' && message.text) {
        content = message.text.body;
    } else if (message.type === 'interactive' && message.interactive) {
        const reply = message.interactive.button_reply || message.interactive.list_reply;
        content = reply?.id || '';
        messageType = 'INTERACTIVE';
    }

    // Store message
    await fastify.prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            content,
            messageType,
            whatsappMsgId: message.id,
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

    // Process with bot engine. Pass the BullMQ queues so cancel/reschedule
    // flows can enqueue customer-facing notifications.
    const { WhatsAppBotEngine } = await import('../../services/whatsapp-bot.js');
    const bot = new WhatsAppBotEngine(fastify.prisma, tenant, {
        notifications: fastify.queues.notifications,
        reminders: fastify.queues.reminders,
    });
    await bot.processMessage(conversation.id, customerPhone, content);
}

export default whatsappRoutes;
