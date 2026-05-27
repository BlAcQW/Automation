import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { decrypt } from '../../services/crypto.js';
import { checkOutboundQuota, incrementMessageUsage } from '../../services/usage.js';

const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
    // All routes require authentication
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /conversations - List conversations
    fastify.get('/', async (request) => {
        const query = z.object({
            state: z.enum(['BOT_ACTIVE', 'HUMAN_ACTIVE']).optional(),
            page: z.coerce.number().min(1).default(1),
            limit: z.coerce.number().min(1).max(50).default(20),
        }).parse(request.query);

        const where: any = { tenantId: request.user.tenantId };
        if (query.state) where.state = query.state;

        const skip = (query.page - 1) * query.limit;

        const [conversations, total] = await Promise.all([
            fastify.prisma.conversation.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { updatedAt: 'desc' },
                include: {
                    messages: {
                        take: 1,
                        orderBy: { createdAt: 'desc' },
                    },
                },
            }),
            fastify.prisma.conversation.count({ where }),
        ]);

        return {
            data: conversations.map((c) => ({
                id: c.id,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                state: c.state,
                lastMessage: c.messages[0]?.content,
                lastMessageAt: c.messages[0]?.createdAt,
                // Direction of the latest message — the client derives an
                // "unread / needs reply" signal from `INBOUND` (customer
                // spoke last and nobody has replied since).
                lastMessageDirection: c.messages[0]?.direction ?? null,
                updatedAt: c.updatedAt,
            })),
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /conversations/human-active - Get conversations in human takeover mode
    fastify.get('/human-active', async (request) => {
        const conversations = await fastify.prisma.conversation.findMany({
            where: {
                tenantId: request.user.tenantId,
                state: 'HUMAN_ACTIVE',
            },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return {
            data: conversations.map((c) => ({
                id: c.id,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                lastMessage: c.messages[0]?.content,
                updatedAt: c.updatedAt,
            })),
        };
    });

    // GET /conversations/:id - Get conversation with messages
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
            include: {
                messages: {
                    orderBy: { createdAt: 'asc' },
                    take: 100,
                },
            },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        return conversation;
    });

    // GET /conversations/:id/messages - Get paginated messages
    fastify.get('/:id/messages', async (request) => {
        const { id } = request.params as { id: string };
        const query = z.object({
            before: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).default(50),
        }).parse(request.query);

        // Verify conversation ownership
        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        const where: any = { conversationId: id };
        if (query.before) {
            where.createdAt = { lt: new Date(query.before) };
        }

        const messages = await fastify.prisma.message.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: query.limit,
        });

        return {
            data: messages.reverse(),
            hasMore: messages.length === query.limit,
        };
    });

    // POST /conversations/:id/messages - Send message (triggers human takeover)
    // Per-tenant 60/min — each tenant has its own bucket so noisy ones can't
    // exhaust the global limit.
    fastify.post('/:id/messages', {
        config: {
            rateLimit: {
                max: 60,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:conversation-reply`,
            },
        },
    }, async (request) => {
        const { id } = request.params as { id: string };
        const body = z.object({
            content: z.string().min(1),
        }).parse(request.body);

        // Verify conversation ownership
        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        // Enforce the WhatsApp 24-hour customer-service window. Free-form
        // text outside the window is rejected by Meta — surface that rule
        // as a clear 400 before we waste the API call.
        const WINDOW_MS = 24 * 60 * 60 * 1000;
        const withinWindow =
            conversation.lastInboundAt &&
            Date.now() - conversation.lastInboundAt.getTime() < WINDOW_MS;

        if (!withinWindow) {
            throw fastify.httpErrors.badRequest(
                'Cannot send a free-form message outside the 24-hour customer-service window. ' +
                'Wait for the customer to message you again, or send an approved template.',
            );
        }

        // Phase 4a — quota enforcement. If the tenant has burned through
        // their monthly message allowance, return 402 with a clear pointer
        // to the upgrade flow. Staff sees this as a toast in the dashboard.
        const quota = await checkOutboundQuota(fastify.prisma, request.user.tenantId);
        if (!quota.ok) {
            throw fastify.httpErrors.paymentRequired(
                `Monthly message quota exhausted (${quota.used}/${quota.limit} on plan ${quota.planId}). ` +
                `Upgrade your plan in Settings → Plan & Usage.`,
            );
        }

        // Create message and set human takeover
        const [message] = await fastify.prisma.$transaction([
            fastify.prisma.message.create({
                data: {
                    conversationId: id,
                    direction: 'OUTBOUND',
                    content: body.content,
                    messageType: 'TEXT',
                },
            }),
            fastify.prisma.conversation.update({
                where: { id },
                data: {
                    state: 'HUMAN_ACTIVE',
                    updatedAt: new Date(),
                },
            }),
        ]);

        // Send message via WhatsApp Cloud API
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
        });

        if (tenant?.whatsappPhoneNumberId && tenant.whatsappAccessToken) {
            try {
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
                            to: conversation.customerPhone,
                            type: 'text',
                            text: { body: body.content },
                        }),
                    }
                );

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    fastify.log.error({ status: response.status, error }, 'Failed to send WhatsApp reply');
                } else {
                    // Count successful staff replies toward the tenant's
                    // monthly outbound-message quota (Phase 4a).
                    await incrementMessageUsage(fastify.prisma, request.user.tenantId);
                }
            } catch (err) {
                fastify.log.error(err, 'Error sending WhatsApp reply');
            }
        }

        return message;
    });

    // POST /conversations/:id/resume-bot - Resume bot for conversation
    fastify.post('/:id/resume-bot', async (request) => {
        const { id } = request.params as { id: string };

        // Verify conversation ownership and that user has permission
        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        if (conversation.state !== 'HUMAN_ACTIVE') {
            throw fastify.httpErrors.badRequest('Bot is already active');
        }

        // Only OWNER or STAFF can resume bot
        if (!['OWNER', 'STAFF'].includes(request.user.role)) {
            throw fastify.httpErrors.forbidden('Not authorized to resume bot');
        }

        const updated = await fastify.prisma.conversation.update({
            where: { id },
            data: {
                state: 'BOT_ACTIVE',
                botContext: Prisma.JsonNull, // Reset bot context
                updatedAt: new Date(),
            },
        });

        // Create system message
        await fastify.prisma.message.create({
            data: {
                conversationId: id,
                direction: 'OUTBOUND',
                content: '[Bot resumed]',
                messageType: 'TEXT',
                metadata: { isSystemMessage: true },
            },
        });

        return {
            id: updated.id,
            state: updated.state,
            message: 'Bot resumed successfully',
        };
    });

    // POST /conversations/:id/activate-human - Manually activate human takeover
    fastify.post('/:id/activate-human', async (request) => {
        const { id } = request.params as { id: string };

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        const updated = await fastify.prisma.conversation.update({
            where: { id },
            data: {
                state: 'HUMAN_ACTIVE',
                updatedAt: new Date(),
            },
        });

        return {
            id: updated.id,
            state: updated.state,
        };
    });

    // POST /conversations/:id/assign - Assign conversation to an agent
    fastify.post('/:id/assign', async (request) => {
        const { id } = request.params as { id: string };

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        if (conversation.state !== 'HUMAN_ACTIVE') {
            throw fastify.httpErrors.badRequest('Conversation is not in human takeover mode');
        }

        if (conversation.assignedUserId) {
            throw fastify.httpErrors.conflict('Conversation already assigned to another agent');
        }

        const updated = await fastify.prisma.conversation.update({
            where: { id },
            data: {
                assignedUserId: request.user.userId,
                assignedAt: new Date(),
            },
        });

        return {
            id: updated.id,
            assignedUserId: updated.assignedUserId,
            message: 'Conversation assigned successfully',
        };
    });

    // GET /conversations/pending - Get unassigned human-active conversations
    fastify.get('/pending', async (request) => {
        const conversations = await fastify.prisma.conversation.findMany({
            where: {
                tenantId: request.user.tenantId,
                state: 'HUMAN_ACTIVE',
                assignedUserId: null,
            },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        return {
            data: conversations.map((c) => ({
                id: c.id,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                takeoverReason: c.takeoverReason,
                lastMessage: c.messages[0]?.content,
                updatedAt: c.updatedAt,
            })),
            count: conversations.length,
        };
    });
};

export default conversationsRoutes;
