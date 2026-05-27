import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma, TemplateCategory, TemplatePurpose } from '@prisma/client';
import { audit } from '../../services/audit.js';

const purposeEnum = z.nativeEnum(TemplatePurpose);
const categoryEnum = z.nativeEnum(TemplateCategory);

const createTemplateSchema = z.object({
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(10).default('en_US'),
    purpose: purposeEnum,
    category: categoryEnum,
    variableCount: z.number().int().min(0).max(20).default(0),
    bodyPreview: z.string().max(2048).optional(),
    isApproved: z.boolean().default(false),
});

const updateTemplateSchema = z.object({
    name: z.string().min(1).max(512).optional(),
    language: z.string().min(2).max(10).optional(),
    category: categoryEnum.optional(),
    variableCount: z.number().int().min(0).max(20).optional(),
    bodyPreview: z.string().max(2048).optional(),
    isApproved: z.boolean().optional(),
});

const listQuerySchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    purpose: purposeEnum.optional(),
});

const templatesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /templates — list this tenant's registered templates.
    fastify.get('/', async (request) => {
        const query = listQuerySchema.parse(request.query);
        const tenantId = request.user.tenantId;
        const skip = (query.page - 1) * query.limit;

        const where: Prisma.MessageTemplateWhereInput = {
            tenantId,
            ...(query.purpose && { purpose: query.purpose }),
        };

        const [templates, total] = await Promise.all([
            fastify.prisma.messageTemplate.findMany({
                where,
                skip,
                take: query.limit,
                orderBy: { createdAt: 'desc' },
            }),
            fastify.prisma.messageTemplate.count({ where }),
        ]);

        return {
            data: templates,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                totalPages: Math.ceil(total / query.limit),
            },
        };
    });

    // GET /templates/:id
    fastify.get('/:id', async (request) => {
        const { id } = request.params as { id: string };

        const template = await fastify.prisma.messageTemplate.findFirst({
            where: { id, tenantId: request.user.tenantId },
        });

        if (!template) {
            throw fastify.httpErrors.notFound('Template not found');
        }

        return template;
    });

    // POST /templates — register a template the tenant has set up in Meta.
    // Template registrations are rare; tight per-tenant limit catches abuse.
    fastify.post('/', {
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:templates-create`,
            },
        },
    }, async (request) => {
        const body = createTemplateSchema.parse(request.body);
        const tenantId = request.user.tenantId;

        // Only OWNER can register templates (they're per-tenant business config).
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can register templates');
        }

        try {
            const created = await fastify.prisma.messageTemplate.create({
                data: {
                    tenantId,
                    name: body.name,
                    language: body.language,
                    purpose: body.purpose,
                    category: body.category,
                    variableCount: body.variableCount,
                    bodyPreview: body.bodyPreview,
                    isApproved: body.isApproved,
                },
            });

            await audit({
                prisma: fastify.prisma,
                action: 'template.created',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                targetType: 'MessageTemplate',
                targetId: created.id,
                metadata: {
                    purpose: created.purpose,
                    name: created.name,
                    language: created.language,
                    variableCount: created.variableCount,
                },
                ipAddress: request.ip,
            });

            return created;
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw fastify.httpErrors.conflict(
                    'A template is already registered for this purpose or (name, language) pair',
                );
            }
            throw err;
        }
    });

    // PATCH /templates/:id
    fastify.patch('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const body = updateTemplateSchema.parse(request.body);
        const tenantId = request.user.tenantId;

        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can modify templates');
        }

        const existing = await fastify.prisma.messageTemplate.findFirst({
            where: { id, tenantId },
            select: { id: true },
        });
        if (!existing) {
            throw fastify.httpErrors.notFound('Template not found');
        }

        try {
            return await fastify.prisma.messageTemplate.update({
                where: { id },
                data: body,
            });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw fastify.httpErrors.conflict(
                    'Another template already uses that name/language for this tenant',
                );
            }
            throw err;
        }
    });

    // DELETE /templates/:id
    fastify.delete('/:id', async (request) => {
        const { id } = request.params as { id: string };
        const tenantId = request.user.tenantId;

        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can delete templates');
        }

        const existing = await fastify.prisma.messageTemplate.findFirst({
            where: { id, tenantId },
            select: { id: true },
        });
        if (!existing) {
            throw fastify.httpErrors.notFound('Template not found');
        }

        await fastify.prisma.messageTemplate.delete({ where: { id } });

        return { deleted: true };
    });
};

export default templatesRoutes;
