import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decrypt } from '../../services/crypto.js';
import { resolveChannelCredentials, sendChannelText } from '../../services/channel-send.js';
import { rollbackOutboundReservation, tryReserveOutbound } from '../../services/usage.js';
import { resolveCredentials, selectCredentialSource } from '../../services/whatsapp-credentials.js';
import { scoped } from '../../lib/logger.js';
import {
    IDEMPOTENCY_WINDOW_MS,
    acquireKeyLock,
    createSentMarkers,
    fingerprint,
    reusedError,
} from './idempotency.js';
import {
    ApiError,
    V1_ROUTE_CONFIG,
    idParam,
    publishBestEffort,
    requireApiKey,
    serializeMessage,
    windowOpen,
} from './shared.js';

const log = scoped('api-v1-messages');

/** WhatsApp's text body limit. */
export const MAX_TEXT_LENGTH = 4096;

const bodySchema = z
    .object({
        conversationId: idParam,
        text: z
            .string()
            .max(MAX_TEXT_LENGTH)
            .refine((t) => t.trim().length > 0, 'text must not be blank'),
    })
    .strict();

const idempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/, 'Idempotency-Key must be 1-200 of A-Z a-z 0-9 _ . : -');

const CHANNEL_FIELDS = {
    whatsappPhoneNumberId: true,
    whatsappAccessToken: true,
    whatsappHosted: true,
    whatsappNumberStatus: true,
    facebookPageId: true,
    facebookPageToken: true,
    instagramUserId: true,
} as const;

interface Outcome {
    status: 200 | 201;
    replayed?: boolean;
    data: unknown;
}

const messageRoutes: FastifyPluginAsync = async (fastify) => {
    const opts = { config: V1_ROUTE_CONFIG, preHandler: fastify.authenticateApiKey(['messages:write']) };
    const sentMarkers = createSentMarkers((fastify as any).redis);

    const unrecorded = (conversationId: string, text: string) => ({
        id: null, recorded: false, conversationId, direction: 'OUTBOUND', content: text,
        messageType: 'TEXT', status: null, source: 'api', createdAt: new Date(),
    });

    /**
     * lookup -> send -> store. `db` is the transaction client when an
     * Idempotency-Key lock is held, else the plain client. Returns the response;
     * throws ApiError for the 4xx/5xx cases.
     */
    async function sendOnce(
        db: any,
        args: { tenantId: string; prefix: string; conversation: any; text: string; key?: string },
        progress: { sent?: boolean },
    ): Promise<Outcome> {
        const { tenantId, prefix, conversation, text, key } = args;
        const fp = key ? fingerprint(conversation.id, text) : '';

        if (key) {
            // Replay BEFORE the window check: a retry of something already sent
            // must succeed even if the window has since closed.
            const previous = await db.message.findFirst({
                where: {
                    direction: 'OUTBOUND',
                    conversation: { tenantId },
                    createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
                    metadata: { path: ['idempotencyKey'], equals: key },
                },
            });
            if (previous) {
                if (previous.conversationId !== conversation.id || previous.content !== text) throw reusedError();
                return { status: 200, replayed: true, data: serializeMessage(previous) };
            }
            const marker = await sentMarkers.get(tenantId, key);
            if (marker) {
                if (marker !== fp) throw reusedError();
                return { status: 200, replayed: true, data: unrecorded(conversation.id, text) };
            }
        }

        if (!windowOpen(conversation.lastInboundAt)) {
            throw new ApiError(
                422,
                'window_closed',
                'The 24-hour customer-service window is closed: the customer has not messaged in the last 24 hours, ' +
                    'so a free-form message cannot be delivered. A message template is required to reach them; ' +
                    'wait for the customer to write again, or use a template.',
            );
        }

        const tenant = await fastify.prisma.tenant.findUnique({ where: { id: tenantId }, select: CHANNEL_FIELDS });
        const credentials = tenant
            ? resolveChannelCredentials(tenant, conversation.channel, decrypt, resolveCredentials(selectCredentialSource(tenant)))
            : null;
        if (!credentials) {
            throw new ApiError(422, 'channel_not_connected', `This organisation has no connected ${conversation.channel} channel to send on.`);
        }

        // Atomic: two parallel sends cannot both take the last slot.
        const reservation = await tryReserveOutbound(fastify.prisma, tenantId);
        if (!reservation.ok) {
            throw new ApiError(402, 'quota_exceeded', 'The monthly message quota for this organisation is used up. Upgrade the plan or wait for the next cycle.');
        }

        let providerMessageId: string | undefined;
        try {
            const sent = await sendChannelText({
                channel: conversation.channel,
                credentials,
                recipientId: conversation.externalId,
                text,
            });
            providerMessageId = sent.messageId;
        } catch (err) {
            log.error({ err, tenantId, channel: conversation.channel }, 'API message send failed');
            await rollbackOutboundReservation(fastify.prisma, tenantId).catch((e) => log.error({ err: e }, 'quota rollback failed'));
            throw new ApiError(502, 'send_failed', 'The message could not be delivered to the channel provider. Try again.');
        }
        progress.sent = true;

        const metadata = { source: 'api', apiKeyPrefix: prefix, ...(key ? { idempotencyKey: key } : {}) };
        try {
            const stored = await db.message.create({
                data: {
                    conversationId: conversation.id,
                    direction: 'OUTBOUND',
                    content: text,
                    messageType: 'TEXT',
                    whatsappMsgId: providerMessageId,
                    metadata,
                },
            });
            return { status: 201, data: serializeMessage(stored) };
        } catch (err) {
            log.error({ err, tenantId, conversationId: conversation.id }, 'message sent but not stored');
            return { status: 201, data: unrecorded(conversation.id, text) };
        }
    }

    // POST /v1/messages - send text into an existing conversation
    fastify.post('/messages', opts, async (request, reply) => {
        const { tenantId, prefix } = requireApiKey(request);
        const body = bodySchema.parse(request.body);
        const rawKey = request.headers['idempotency-key'];
        const key = rawKey === undefined ? undefined : idempotencyKey.parse(Array.isArray(rawKey) ? rawKey[0] : rawKey);

        const conversation = await fastify.prisma.conversation.findFirst({
            where: { id: body.conversationId, tenantId },
        });
        if (!conversation) throw new ApiError(404, 'not_found', 'Conversation not found');

        const args = { tenantId, prefix, conversation, text: body.text, key };
        const progress: { sent?: boolean } = {};
        let outcome: Outcome | undefined;

        if (!key) {
            outcome = await sendOnce(fastify.prisma, args, progress);
        } else {
            try {
                // The lock lives as long as this transaction, which spans the send.
                await fastify.prisma.$transaction(
                    async (tx: any) => {
                        await acquireKeyLock(tx, tenantId, key);
                        outcome = await sendOnce(tx, args, progress);
                    },
                    { timeout: 30_000, maxWait: 5_000 },
                );
            } catch (err) {
                // The provider accepted the message but the transaction did not
                // commit (so the row is not there). Never surface a 500 that
                // invites a duplicate send.
                if (!progress.sent) throw err;
                log.error({ err, tenantId, conversationId: conversation.id }, 'message sent but its transaction failed');
                outcome = { status: 201, data: unrecorded(conversation.id, body.text) };
            }
        }

        const result = outcome!;
        const data = result.data as { id: string | null; recorded?: boolean };
        if (key && data.recorded === false && !result.replayed) {
            await sentMarkers.set(tenantId, key, fingerprint(conversation.id, body.text));
        }
        if (result.replayed) {
            reply.header('Idempotent-Replayed', 'true');
            reply.code(result.status);
            return { data: result.data };
        }

        if (data.id) {
            await fastify.prisma.conversation
                .updateMany({ where: { id: conversation.id, tenantId }, data: { updatedAt: new Date() } })
                .catch(() => undefined);
            await publishBestEffort(fastify.prisma, tenantId, 'message.sent', {
                conversationId: conversation.id, messageId: data.id, channel: conversation.channel, sentBy: 'APP',
            });
        }

        reply.code(result.status);
        return { data: result.data };
    });
};

export default messageRoutes;
