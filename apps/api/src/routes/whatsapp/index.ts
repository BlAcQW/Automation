import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';

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
            query['hub.verify_token'] === config.whatsapp.webhookVerifyToken
        ) {
            fastify.log.info('WhatsApp webhook verified');
            return reply.send(query['hub.challenge']);
        }

        throw fastify.httpErrors.forbidden('Verification failed');
    });

    // POST /whatsapp/webhook - Receive messages
    fastify.post('/webhook', async (request, reply) => {
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

        // TODO: Encrypt access token before storing
        const tenant = await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                whatsappPhoneNumberId: body.phoneNumberId,
                whatsappAccountId: body.accountId,
                whatsappAccessToken: body.accessToken, // Should be encrypted
                whatsappDisplayNumber: body.displayNumber,
            },
        });

        return {
            success: true,
            displayNumber: tenant.whatsappDisplayNumber,
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

        return { success: true };
    });

    // POST /whatsapp/send-test - Send a test message
    fastify.post('/send-test', {
        preHandler: [fastify.authenticate],
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

        // TODO: Actually send via WhatsApp API
        // For now, just log
        fastify.log.info({ to: body.to, message: body.message }, 'Test message would be sent');

        return { success: true, message: 'Test message queued' };
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

    // Update conversation timestamp
    await fastify.prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
    });

    // If in human takeover mode, don't process with bot
    if (conversation.state === 'HUMAN_ACTIVE') {
        fastify.log.debug({ conversationId: conversation.id }, 'Human takeover active, skipping bot');
        return;
    }

    // TODO: Process with bot engine
    // This would call the bot service to generate a response
    fastify.log.info({
        tenantId: tenant.id,
        conversationId: conversation.id,
        message: content,
    }, 'Message received, would process with bot');
}

export default whatsappRoutes;
