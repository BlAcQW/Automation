/**
 * /assistant: what the assistant knows about the business (Settings > Your
 * assistant) and the "Try your assistant" preview.
 *
 *   GET  /assistant/knowledge   any staff member (read)
 *   PUT  /assistant/knowledge   owner only, like every other business setting
 *   POST /assistant/preview     any staff member; 20 per 10 minutes per tenant
 *
 * Every query is keyed by the authenticated tenant; nothing in the body or
 * query string can name another tenant (the body schema is strict).
 */
import { Prisma } from '@prisma/client';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../services/api-error.js';
import { audit } from '../../services/audit.js';
import {
    cleanText,
    filledSections,
    knowledgeInputSchema,
    toKnowledgeData,
    toKnowledgeDto,
    type KnowledgeData,
} from '../../services/business-knowledge.js';
import { previewAssistant, PreviewTenantNotFound } from '../../services/assistant-preview.js';
import { isLlmEnabled } from '../../services/llm-agent.js';
import { safeZone, zonedDateString } from '../../services/timezone.js';

/** Previews cost a model call each; this is plenty for an owner trying things out. */
export const PREVIEW_RATE_LIMIT = { max: 20, timeWindow: '10 minutes' } as const;
export const PREVIEW_QUESTION_MAX = 500;

const previewBodySchema = z
    .object({
        question: z
            .string()
            .transform(cleanText)
            .pipe(z.string().min(1, 'Type a question to try.').max(PREVIEW_QUESTION_MAX, `Keep the question under ${PREVIEW_QUESTION_MAX} characters.`)),
        knowledge: knowledgeInputSchema.optional(),
    })
    .strict();

const perTenant = (suffix: string) => (req: FastifyRequest) => `${req.user?.tenantId ?? req.ip}:${suffix}`;

/** Prisma wants DbNull, not null, to clear a Json column. */
function toPrismaData(data: KnowledgeData) {
    return {
        ...data,
        team: data.team ?? Prisma.DbNull,
        faqs: data.faqs ?? Prisma.DbNull,
    };
}

const assistantRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    async function todayFor(tenantId: string): Promise<string> {
        const tenant = await fastify.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
        return zonedDateString(new Date(), safeZone(tenant?.timezone));
    }

    async function knowledgeResponse(request: FastifyRequest, row: Record<string, any> | null) {
        const { tenantId, role } = request.user;
        const knowledge = toKnowledgeDto(row);
        const updatedBy = row?.updatedByUserId
            ? await fastify.prisma.user.findFirst({ where: { id: row.updatedByUserId, tenantId }, select: { name: true } })
            : null;
        return {
            knowledge,
            updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
            updatedBy: updatedBy ? { name: updatedBy.name } : null,
            canEdit: role === 'OWNER' && !request.user.support,
            completeness: filledSections(knowledge, await todayFor(tenantId)),
        };
    }

    fastify.get('/knowledge', async (request) => {
        const row = await fastify.prisma.businessKnowledge.findUnique({ where: { tenantId: request.user.tenantId } });
        return knowledgeResponse(request, row);
    });

    fastify.put('/knowledge', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: perTenant('assistant-knowledge') } },
    }, async (request) => {
        const { tenantId, userId, role } = request.user;
        // Same rule as the other business settings (templates, channels, payments).
        if (role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only the account owner can change what your assistant knows.');
        }
        const input = knowledgeInputSchema.parse(request.body);
        const data = toPrismaData(toKnowledgeData(input));

        const row = await fastify.prisma.businessKnowledge.upsert({
            where: { tenantId },
            create: { tenantId, ...data, updatedByUserId: userId },
            update: { ...data, updatedByUserId: userId },
        });

        const response = await knowledgeResponse(request, row);
        // Which sections, never what they say: the content is the business's own.
        await audit({
            prisma: fastify.prisma,
            action: 'assistant.knowledge_updated',
            actorType: 'USER',
            actorId: userId,
            tenantId,
            targetType: 'BusinessKnowledge',
            targetId: row.id,
            metadata: { sectionsFilled: response.completeness.filled },
            ipAddress: request.ip,
        });
        return response;
    });

    fastify.post('/preview', {
        config: { rateLimit: { ...PREVIEW_RATE_LIMIT, keyGenerator: perTenant('assistant-preview') } },
    }, async (request) => {
        const { tenantId } = request.user;
        const body = previewBodySchema.parse(request.body);
        if (!isLlmEnabled()) {
            throw new ApiError(503, 'ASSISTANT_OFF', "Your assistant isn't switched on yet, so it can't answer test questions.");
        }
        try {
            return await previewAssistant(fastify.prisma, {
                tenantId,
                question: body.question,
                knowledge: body.knowledge ? toKnowledgeDto(toKnowledgeData(body.knowledge)) : undefined,
                log: request.log,
            });
        } catch (err) {
            if (err instanceof PreviewTenantNotFound) throw fastify.httpErrors.notFound('Business not found');
            // Neither the question nor the knowledge is logged: only that it failed.
            request.log.warn({ errName: err instanceof Error ? err.name : 'Error' }, 'Assistant preview failed');
            throw new ApiError(502, 'PREVIEW_FAILED', "Your assistant couldn't answer just now. Try again in a moment.");
        }
    });
};

export default assistantRoutes;
