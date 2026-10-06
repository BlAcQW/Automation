import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { decrypt } from '../../services/crypto.js';
import { checkOutboundQuota, incrementMessageUsage } from '../../services/usage.js';
import { resolveCredentials, selectCredentialSource } from '../../services/whatsapp-credentials.js';
import { maskContact, maskContacts } from '../../services/contact-privacy.js';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';
import { emitConversationHandoff, emitConversationResumed, emitMessageSent } from '../../services/events/emit.js';
import {
    MESSAGE_TYPE,
    MediaError,
    classify,
    deleteStoredMedia,
    openStoredMedia,
    storeMedia,
    uploadToWhatsApp,
} from '../../services/media.js';

/**
 * The bot -> human flip, as arguments for updateMany. CONDITIONAL on the
 * conversation not already being with a person, so of two racing requests
 * exactly one gets count === 1, and that one alone announces the handoff. Sets
 * takeoverAt like triggerTakeover does (the pending list sorts by it and a
 * resume clears it).
 */
function humanFlip(tenantId: string, id: string) {
    const now = new Date();
    return {
        where: { id, tenantId, state: { not: 'HUMAN_ACTIVE' as const } },
        data: { state: 'HUMAN_ACTIVE' as const, takeoverAt: now, updatedAt: now },
    };
}

/** Bump updatedAt even when the flip did not apply (the thread had activity). */
function touch(tenantId: string, id: string) {
    return { where: { id, tenantId }, data: { updatedAt: new Date() } };
}

/**
 * A staff action that flips a bot conversation to HUMAN_ACTIVE is a handoff too:
 * subscribers (an external app, above all) must hear that the bot is no longer
 * in charge. Only announced when `flipped` (the conditional update changed a
 * row). Best-effort.
 */
async function announceHandoff(prisma: unknown, tenantId: string, conversationId: string, flipped: boolean, reason: string): Promise<void> {
    if (!flipped) return;
    await emitConversationHandoff(prisma, { tenantId, conversationId, reason });
}

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

        // Masked before it leaves the API — never in the browser, or the real
        // number would still be sitting in the network response.
        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role);

        return {
            data: conversations.map((c) => maskContact({
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
            }, mask)),
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role);

        return {
            data: conversations.map((c) => maskContact({
                id: c.id,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                lastMessage: c.messages[0]?.content,
                updatedAt: c.updatedAt,
            }, mask)),
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

        // The whole row goes to the client here, so it must be masked too —
        // this is the endpoint the chat screen loads.
        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role);
        return maskContact(conversation, mask);
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
        const [message, flip] = await fastify.prisma.$transaction([
            fastify.prisma.message.create({
                data: {
                    conversationId: id,
                    direction: 'OUTBOUND',
                    content: body.content,
                    messageType: 'TEXT',
                },
            }),
            fastify.prisma.conversation.updateMany(humanFlip(request.user.tenantId, id)),
            fastify.prisma.conversation.updateMany(touch(request.user.tenantId, id)),
        ]);
        await announceHandoff(fastify.prisma, request.user.tenantId, id, flip.count === 1, 'staff_reply');

        // Send message via WhatsApp Cloud API
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
        });

        const creds = resolveCredentials(selectCredentialSource(tenant));
        if (creds) {
            try {
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
                    // Store Meta's message id — without it the delivery-status
                    // webhook has nothing to match against, so ticks and the
                    // billing category would never be recorded.
                    const sent = (await response.json().catch(() => ({}))) as {
                        messages?: Array<{ id?: string }>;
                    };
                    const waId = sent.messages?.[0]?.id;
                    if (waId) {
                        await fastify.prisma.message
                            .update({ where: { id: message.id }, data: { whatsappMsgId: waId } })
                            .catch(() => undefined);
                    }

                    // Count successful staff replies toward the tenant's
                    // monthly outbound-message quota (Phase 4a).
                    await incrementMessageUsage(fastify.prisma, request.user.tenantId);

                    // Only now is it actually sent.
                    await emitMessageSent(fastify.prisma, {
                        tenantId: request.user.tenantId, conversationId: id, messageId: message.id, channel: 'WHATSAPP', sentBy: 'HUMAN',
                    });
                }
            } catch (err) {
                fastify.log.error(err, 'Error sending WhatsApp reply');
            }
        }

        return message;
    });

    // POST /conversations/:id/media - Send an attachment (image, video, doc).
    // Mirrors the text-reply route: same 24h window, same quota, same takeover.
    fastify.post('/:id/media', {
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:conversation-media`,
            },
        },
    }, async (request) => {
        const { id } = request.params as { id: string };

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });
        if (!conversation) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        const WINDOW_MS = 24 * 60 * 60 * 1000;
        const withinWindow =
            conversation.lastInboundAt &&
            Date.now() - conversation.lastInboundAt.getTime() < WINDOW_MS;
        if (!withinWindow) {
            throw fastify.httpErrors.badRequest(
                'Cannot send media outside the 24-hour customer-service window. ' +
                'Wait for the customer to message you again, or send an approved template.',
            );
        }

        const quota = await checkOutboundQuota(fastify.prisma, request.user.tenantId);
        if (!quota.ok) {
            throw fastify.httpErrors.paymentRequired(
                `Monthly message quota exhausted (${quota.used}/${quota.limit} on plan ${quota.planId}). ` +
                `Upgrade your plan in Settings → Plan & Usage.`,
            );
        }

        const upload = await request.file();
        if (!upload) {
            throw fastify.httpErrors.badRequest('No file uploaded');
        }
        const caption = typeof upload.fields?.caption === 'object'
            ? String((upload.fields.caption as { value?: unknown }).value ?? '').slice(0, 1024)
            : '';

        const buffer = await upload.toBuffer();
        // @fastify/multipart truncates past its limit rather than throwing.
        if ((upload.file as { truncated?: boolean }).truncated) {
            throw fastify.httpErrors.badRequest('File is too large.');
        }

        // The tenant must be connected before we store anything: media is only
        // useful if it can actually be delivered.
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
        });
        const mediaCreds = resolveCredentials(selectCredentialSource(tenant));
        if (!mediaCreds) {
            throw fastify.httpErrors.badRequest('Connect your WhatsApp number before sending media.');
        }

        let stored;
        try {
            classify(upload.mimetype);
            stored = await storeMedia({
                tenantId: request.user.tenantId,
                mimeType: upload.mimetype,
                buffer,
            });
        } catch (err) {
            if (err instanceof MediaError) throw fastify.httpErrors.badRequest(err.message);
            throw err;
        }

        // Upload to Meta BEFORE persisting, so a rejected file never leaves a
        // message in the thread that the customer will not receive.
        const accessToken = mediaCreds.accessToken;
        let mediaId: string;
        try {
            mediaId = await uploadToWhatsApp({
                phoneNumberId: mediaCreds.phoneNumberId,
                accessToken,
                buffer,
                mimeType: upload.mimetype,
                filename: upload.filename || `upload.${stored.kind}`,
            });
        } catch (err) {
            await deleteStoredMedia(stored.relativePath);
            if (err instanceof MediaError) throw fastify.httpErrors.badGateway(err.message);
            throw err;
        }

        const payload: Record<string, unknown> = {
            messaging_product: 'whatsapp',
            to: conversation.customerPhone,
            type: stored.kind,
            [stored.kind]: {
                id: mediaId,
                // Audio and stickers are the types WhatsApp rejects a caption on.
                ...(caption && stored.kind !== 'audio' && stored.kind !== 'sticker'
                    ? { caption }
                    : {}),
                ...(stored.kind === 'document' && upload.filename
                    ? { filename: upload.filename }
                    : {}),
            },
        };

        const response = await fetch(
            `https://graph.facebook.com/v21.0/${mediaCreds.phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            },
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            fastify.log.error({ status: response.status, error }, 'Failed to send WhatsApp media');
            await deleteStoredMedia(stored.relativePath);
            throw fastify.httpErrors.badGateway('WhatsApp rejected the attachment.');
        }

        const sentPayload = (await response.json().catch(() => ({}))) as {
            messages?: Array<{ id?: string }>;
        };

        const [message, flip] = await fastify.prisma.$transaction([
            fastify.prisma.message.create({
                data: {
                    conversationId: id,
                    whatsappMsgId: sentPayload.messages?.[0]?.id ?? null,
                    direction: 'OUTBOUND',
                    // `content` stays human-readable so every existing surface
                    // (chat list preview, exports) shows something sensible.
                    content: caption || `[${stored.kind}]`,
                    messageType: MESSAGE_TYPE[stored.kind],
                    metadata: {
                        mediaPath: stored.relativePath,
                        mimeType: stored.mimeType,
                        size: stored.size,
                        kind: stored.kind,
                        caption,
                        filename: upload.filename ?? null,
                        whatsappMediaId: mediaId,
                    } as Prisma.InputJsonValue,
                },
            }),
            fastify.prisma.conversation.updateMany(humanFlip(request.user.tenantId, id)),
            fastify.prisma.conversation.updateMany(touch(request.user.tenantId, id)),
        ]);
        await announceHandoff(fastify.prisma, request.user.tenantId, id, flip.count === 1, 'staff_reply');

        await incrementMessageUsage(fastify.prisma, request.user.tenantId);
        await emitMessageSent(fastify.prisma, {
            tenantId: request.user.tenantId, conversationId: id, messageId: message.id, channel: 'WHATSAPP', sentBy: 'HUMAN',
        });

        return message;
    });

    // GET /conversations/:id/media/:messageId - Stream an attachment back to
    // the dashboard. Tenant-scoped and authenticated (the preHandler above),
    // so stored media is never publicly reachable.
    fastify.get('/:id/media/:messageId', async (request, reply) => {
        const { id, messageId } = request.params as { id: string; messageId: string };

        const message = await fastify.prisma.message.findFirst({
            where: {
                id: messageId,
                conversationId: id,
                conversation: { tenantId: request.user.tenantId },
            },
        });
        if (!message) {
            throw fastify.httpErrors.notFound('Message not found');
        }

        const meta = (message.metadata ?? {}) as { mediaPath?: string; mimeType?: string };
        if (!meta.mediaPath) {
            throw fastify.httpErrors.notFound('Message has no attachment');
        }

        try {
            const { stream, size } = await openStoredMedia(meta.mediaPath);
            return reply
                .header('Content-Type', meta.mimeType ?? 'application/octet-stream')
                .header('Content-Length', size)
                // Immutable: a message's attachment never changes.
                .header('Cache-Control', 'private, max-age=31536000, immutable')
                .send(stream);
        } catch (err) {
            request.log.warn({ err, messageId }, 'Stored media missing on disk');
            throw fastify.httpErrors.notFound('Attachment is no longer available');
        }
    });

    // POST /conversations/:id/rich - Send a reaction, a location or a contact
    // card. One route because all three share the same window/quota/persist
    // path and differ only in the payload Meta expects.
    fastify.post('/:id/rich', {
        config: {
            rateLimit: {
                max: 60,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:conversation-rich`,
            },
        },
    }, async (request) => {
        const { id } = request.params as { id: string };

        const body = z.discriminatedUnion('type', [
            z.object({
                type: z.literal('reaction'),
                messageId: z.string().min(1),
                // An empty string is how WhatsApp removes a reaction.
                emoji: z.string().max(8),
            }),
            z.object({
                type: z.literal('location'),
                latitude: z.number().min(-90).max(90),
                longitude: z.number().min(-180).max(180),
                name: z.string().max(200).optional(),
                address: z.string().max(500).optional(),
            }),
            z.object({
                type: z.literal('contact'),
                name: z.string().min(1).max(200),
                phone: z.string().min(3).max(30),
            }),
        ]).parse(request.body);

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });
        if (!conversation) throw fastify.httpErrors.notFound('Conversation not found');

        const WINDOW_MS = 24 * 60 * 60 * 1000;
        const withinWindow =
            conversation.lastInboundAt &&
            Date.now() - conversation.lastInboundAt.getTime() < WINDOW_MS;
        if (!withinWindow) {
            throw fastify.httpErrors.badRequest(
                'Cannot send outside the 24-hour customer-service window. ' +
                'Wait for the customer to message you again, or send an approved template.',
            );
        }

        const quota = await checkOutboundQuota(fastify.prisma, request.user.tenantId);
        if (!quota.ok) {
            throw fastify.httpErrors.paymentRequired(
                `Monthly message quota exhausted (${quota.used}/${quota.limit} on plan ${quota.planId}).`,
            );
        }

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
        });
        const sendCreds = resolveCredentials(selectCredentialSource(tenant));
        if (!sendCreds) {
            throw fastify.httpErrors.badRequest('Connect your WhatsApp number first.');
        }

        // Build Meta's payload and the human-readable content we store alongside
        // it, so the chat list preview and exports stay meaningful.
        let payload: Record<string, unknown>;
        let content: string;
        let messageType: 'REACTION' | 'LOCATION' | 'CONTACT';

        if (body.type === 'reaction') {
            const target = await fastify.prisma.message.findFirst({
                where: { id: body.messageId, conversationId: id },
                select: { whatsappMsgId: true },
            });
            if (!target?.whatsappMsgId) {
                throw fastify.httpErrors.badRequest('That message cannot be reacted to.');
            }
            payload = { type: 'reaction', reaction: { message_id: target.whatsappMsgId, emoji: body.emoji } };
            content = body.emoji || '(reaction removed)';
            messageType = 'REACTION';
        } else if (body.type === 'location') {
            payload = {
                type: 'location',
                location: {
                    latitude: body.latitude,
                    longitude: body.longitude,
                    ...(body.name ? { name: body.name } : {}),
                    ...(body.address ? { address: body.address } : {}),
                },
            };
            content = body.name || body.address || `${body.latitude}, ${body.longitude}`;
            messageType = 'LOCATION';
        } else {
            payload = {
                type: 'contacts',
                contacts: [{
                    name: { formatted_name: body.name, first_name: body.name.split(' ')[0] },
                    phones: [{ phone: body.phone, type: 'CELL' }],
                }],
            };
            content = body.name;
            messageType = 'CONTACT';
        }

        const accessToken = sendCreds.accessToken;
        const response = await fetch(
            `https://graph.facebook.com/v21.0/${sendCreds.phoneNumberId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: conversation.customerPhone,
                    ...payload,
                }),
            },
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            fastify.log.error({ status: response.status, error, type: body.type }, 'WhatsApp rejected rich message');
            throw fastify.httpErrors.badGateway('WhatsApp rejected that message.');
        }

        const sent = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };

        // A reaction is an annotation, not a turn in the conversation — it must
        // not flip the thread to human takeover the way a reply does.
        const isReaction = body.type === 'reaction';

        const message = await fastify.prisma.message.create({
            data: {
                conversationId: id,
                whatsappMsgId: sent.messages?.[0]?.id ?? null,
                direction: 'OUTBOUND',
                content,
                messageType,
                metadata: { ...body } as Prisma.InputJsonValue,
            },
        });

        if (!isReaction) {
            const flip = await fastify.prisma.conversation.updateMany(humanFlip(request.user.tenantId, id));
            await fastify.prisma.conversation.updateMany(touch(request.user.tenantId, id));
            await announceHandoff(fastify.prisma, request.user.tenantId, id, flip.count === 1, 'staff_reply');
        }

        await incrementMessageUsage(fastify.prisma, request.user.tenantId);
        await emitMessageSent(fastify.prisma, {
            tenantId: request.user.tenantId, conversationId: id, messageId: message.id, channel: 'WHATSAPP', sentBy: 'HUMAN',
        });
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

        const { count } = await fastify.prisma.conversation.updateMany({
            // Conditional: only the request that actually changes the state resumes it
            // (and announces it); a concurrent one finds it already back with the bot.
            where: { id, tenantId: request.user.tenantId, state: 'HUMAN_ACTIVE' },
            data: {
                state: 'BOT_ACTIVE',
                // botContext is kept: an in-flight workflow (e.g. waiting on a
                // payment) carries on instead of starting over, and a later
                // payment still finds its step. The customer can type "menu"
                // to start over.
                // A stale count of 3+ would hand the conversation straight
                // back to a human on the customer's next message.
                botFailureCount: 0,
                // Same as resumeBot(): a conversation with the bot has no takeover.
                takeoverAt: null,
                takeoverReason: null,
                assignedUserId: null,
                updatedAt: new Date(),
            },
        });
        if (count === 0) {
            throw fastify.httpErrors.badRequest('Bot is already active');
        }
        await emitConversationResumed(fastify.prisma, { tenantId: request.user.tenantId, conversationId: id });

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
            id,
            state: 'BOT_ACTIVE',
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

        // The conversation was just verified for this tenant, so count 0 means
        // someone else already flipped it: nothing to do and nothing to announce.
        const { count } = await fastify.prisma.conversation.updateMany({
            ...humanFlip(request.user.tenantId, id),
            data: { ...humanFlip(request.user.tenantId, id).data, takeoverReason: 'manual' },
        });
        await announceHandoff(fastify.prisma, request.user.tenantId, id, count === 1, 'manual');

        return {
            id,
            state: 'HUMAN_ACTIVE',
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

        const { count } = await fastify.prisma.conversation.updateMany({
            where: { id, tenantId: request.user.tenantId },
            data: {
                assignedUserId: request.user.userId,
                assignedAt: new Date(),
            },
        });
        if (count === 0) {
            throw fastify.httpErrors.notFound('Conversation not found');
        }

        return {
            id,
            assignedUserId: request.user.userId,
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

        const mask = await resolveMaskPolicy(fastify.prisma, request.user.tenantId, request.user.role);

        return {
            data: conversations.map((c) => maskContact({
                id: c.id,
                customerPhone: c.customerPhone,
                customerName: c.customerName,
                takeoverReason: c.takeoverReason,
                lastMessage: c.messages[0]?.content,
                updatedAt: c.updatedAt,
            }, mask)),
            count: conversations.length,
        };
    });
};

export default conversationsRoutes;
