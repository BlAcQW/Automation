import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
    ApiError,
    V1_ROUTE_CONFIG,
    idParam,
    pageArgs,
    paginationQuery,
    publishBestEffort,
    requireApiKey,
    serializeConversation,
    serializeMessage,
    toPage,
} from './shared.js';

const idParams = z.object({ id: idParam });
const listQuery = paginationQuery.extend({
    state: z.enum(['BOT_ACTIVE', 'HUMAN_ACTIVE']).optional(),
    customerId: idParam.optional(),
});
const handoffBody = z.object({ reason: z.string().trim().min(1).max(200).optional() }).strict();

const DEFAULT_HANDOFF_REASON = 'external_app_handoff';

const conversationRoutes: FastifyPluginAsync = async (fastify) => {
    const cfg = { config: V1_ROUTE_CONFIG };
    const read = { ...cfg, preHandler: fastify.authenticateApiKey(['conversations:read']) };
    const write = { ...cfg, preHandler: fastify.authenticateApiKey(['conversations:write']) };

    /** Tenant-scoped lookup; a foreign or unknown id is the same 404. */
    const findOwned = async (tenantId: string, id: string) => {
        const conversation = await fastify.prisma.conversation.findFirst({ where: { id, tenantId } });
        if (!conversation) throw new ApiError(404, 'not_found', 'Conversation not found');
        return conversation;
    };

    /** After losing a race, tell the caller what the conversation really is now. */
    const currentState = async (tenantId: string, id: string): Promise<string> =>
        (await fastify.prisma.conversation.findFirst({ where: { id, tenantId }, select: { state: true } }))?.state ?? 'BOT_ACTIVE';

    // GET /v1/conversations
    fastify.get('/conversations', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const q = listQuery.parse(request.query);
        const rows = await fastify.prisma.conversation.findMany({
            where: {
                tenantId,
                ...(q.state ? { state: q.state } : {}),
                ...(q.customerId ? { customerId: q.customerId } : {}),
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            ...pageArgs(q),
        });
        const { items, pagination } = toPage(rows, q.limit);
        return { data: items.map(serializeConversation), pagination };
    });

    // GET /v1/conversations/:id
    fastify.get('/conversations/:id', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        return { data: serializeConversation(await findOwned(tenantId, id)) };
    });

    // GET /v1/conversations/:id/messages
    fastify.get('/conversations/:id/messages', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const q = paginationQuery.parse(request.query);
        await findOwned(tenantId, id);
        // Message has no tenantId of its own; the relation filter re-asserts
        // the tenant on the query itself, not just on the check above.
        const rows = await fastify.prisma.message.findMany({
            where: { conversationId: id, conversation: { tenantId } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...pageArgs(q),
        });
        const { items, pagination } = toPage(rows, q.limit);
        return { data: items.map(serializeMessage), pagination };
    });

    // POST /v1/conversations/:id/handoff - app -> person
    fastify.post('/conversations/:id/handoff', write, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const body = handoffBody.parse(request.body ?? {});
        const conversation = await findOwned(tenantId, id);

        if (conversation.state === 'HUMAN_ACTIVE') {
            return { data: { id, state: 'HUMAN_ACTIVE', changed: false } };
        }
        // Guarded on the state we read, so a concurrent change wins cleanly.
        const { count } = await fastify.prisma.conversation.updateMany({
            where: { id, tenantId, state: 'BOT_ACTIVE' },
            data: { state: 'HUMAN_ACTIVE', takeoverReason: body.reason ?? DEFAULT_HANDOFF_REASON, takeoverAt: new Date() },
        });
        if (count === 1) {
            await publishBestEffort(fastify.prisma, tenantId, 'conversation.handoff', {
                conversationId: id, to: 'HUMAN', reason: body.reason ?? null,
            });
        }
        return { data: { id, state: count === 1 ? 'HUMAN_ACTIVE' : await currentState(tenantId, id), changed: count === 1 } };
    });

    // POST /v1/conversations/:id/resume - back to the assistant
    fastify.post('/conversations/:id/resume', write, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const conversation = await findOwned(tenantId, id);

        if (conversation.state !== 'HUMAN_ACTIVE') {
            return { data: { id, state: 'BOT_ACTIVE', changed: false } };
        }
        const { count } = await fastify.prisma.conversation.updateMany({
            where: { id, tenantId, state: 'HUMAN_ACTIVE' },
            data: {
                state: 'BOT_ACTIVE',
                // botContext is deliberately NOT cleared: it holds in-flight flow
                // state, and a payment link sent earlier would otherwise come
                // back unmatched. (The takeover itself never changed it.)
                // A stale failure count of 3+ would hand the conversation
                // straight back to a person on the customer's next message.
                botFailureCount: 0,
                assignedUserId: null,
                takeoverReason: null,
                takeoverAt: null,
            },
        });
        if (count === 1) {
            await publishBestEffort(fastify.prisma, tenantId, 'conversation.resumed', { conversationId: id });
        }
        return { data: { id, state: count === 1 ? 'BOT_ACTIVE' : await currentState(tenantId, id), changed: count === 1 } };
    });
};

export default conversationRoutes;
