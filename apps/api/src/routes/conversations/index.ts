import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

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
    fastify.post('/:id/messages', async (request) => {
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

        // TODO: Actually send via WhatsApp API
        // This would queue a job to send the message

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
                botContext: null, // Reset bot context
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
};

export default conversationsRoutes;
