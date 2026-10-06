/**
 * Workflow editor API (A6). Admin can list a tenant's (or a vertical's) flow
 * definitions and versions, validate an edited definition, save it as a NEW
 * version, and activate any version (activating an older one is the rollback).
 *
 * Nothing is ever edited in place: there is no update or delete route for a
 * version. Every write goes through the definitions service, which validates
 * with parseFlowDefinition and assigns the next version number.
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import {
    createDefinitionsService,
    createPrismaFlowStore,
    FlowDefinitionError,
    FlowNotFoundError,
    FlowVersionConflictError,
    parseFlowDefinition,
    type FlowPrismaLike,
} from '../../services/flows/index.js';
import type { DefinitionScope } from '../../services/flows/definitions.js';
import { VERTICALS } from '../../services/verticals.js';
import { adminActor, adminGuard } from './guard.js';

export const MAX_DEFINITION_BYTES = 200_000;
const LIST_CAP = 500;

const scopeShape = {
    tenantId: z.string().min(1).max(64).optional(),
    vertical: z.enum(VERTICALS).optional(),
};
const oneScope = (v: { tenantId?: string; vertical?: string }) => (v.tenantId === undefined) !== (v.vertical === undefined);
const SCOPE_MESSAGE = 'Give exactly one of tenantId (a tenant\'s own flow) or vertical (the platform default for that vertical)';

const scopeQuery = z.object(scopeShape).refine(oneScope, { message: SCOPE_MESSAGE });
const keyParam = z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/i, 'Invalid flow key') });
const definitionField = z
    .record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= MAX_DEFINITION_BYTES, { message: 'Definition is too large' });

const validateBody = z.object({ definition: definitionField, key: keyParam.shape.key.optional() }).strict();
const saveBody = z
    .object({ ...scopeShape, definition: definitionField, activate: z.boolean().default(false) })
    .strict()
    .refine(oneScope, { message: SCOPE_MESSAGE });
const activateBody = z
    .object({ ...scopeShape, version: z.number().int().min(1) })
    .strict()
    .refine(oneScope, { message: SCOPE_MESSAGE });

const flowRoutes: FastifyPluginAsync = async (fastify) => {
    const store = () => createPrismaFlowStore(fastify.prisma as unknown as FlowPrismaLike);
    const service = () => createDefinitionsService(store());

    const unprocessable = (reply: FastifyReply, errors: string[]) =>
        reply.code(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'This workflow is not valid', errors });

    async function resolveScope(s: { tenantId?: string; vertical?: string }): Promise<{ scope: DefinitionScope; vertical: string | null }> {
        if (s.tenantId) {
            const tenant = await fastify.prisma.tenant.findUnique({ where: { id: s.tenantId }, select: { id: true } });
            if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');
            return { scope: { tenantId: s.tenantId }, vertical: null };
        }
        return { scope: { tenantId: null }, vertical: s.vertical ?? null };
    }

    // GET /admin/flows?tenantId=|vertical=  - flows by key, versions newest first. No bodies.
    fastify.get('/flows', { preHandler: adminGuard(fastify, 'flows:read') }, async (request) => {
        const q = scopeQuery.parse(request.query);
        const { scope, vertical } = await resolveScope(q);
        const rows = await fastify.prisma.flowDefinition.findMany({
            where: { tenantId: scope.tenantId, ...(vertical ? { vertical: vertical as never } : {}) },
            orderBy: [{ key: 'asc' }, { version: 'desc' }],
            take: LIST_CAP,
            select: { id: true, key: true, version: true, isActive: true, createdAt: true, createdBy: true, vertical: true },
        });
        const byKey = new Map<string, typeof rows>();
        // Newest first, whatever order the store returned them in.
        for (const r of [...rows].sort((a, b) => b.version - a.version)) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
        return {
            data: [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, versions]) => ({
                key,
                vertical: versions[0].vertical,
                activeVersion: versions.filter((v) => v.isActive).reduce((m, v) => Math.max(m, v.version), 0) || null,
                versions: versions.map(({ id, version, isActive, createdAt, createdBy }) => ({ id, version, isActive, createdAt, createdBy })),
            })),
        };
    });

    // GET /admin/flows/:key/versions/:version?tenantId=|vertical=  - one version WITH its definition.
    fastify.get('/flows/:key/versions/:version', { preHandler: adminGuard(fastify, 'flows:read') }, async (request) => {
        const { key } = keyParam.parse(request.params);
        const version = z.coerce.number().int().min(1).parse((request.params as { version: string }).version);
        const q = scopeQuery.parse(request.query);
        const { scope } = await resolveScope(q);
        const row = await service().getVersion(scope, key, version);
        if (!row) throw fastify.httpErrors.notFound('Version not found');
        return { key, version: row.version, isActive: row.isActive, tenantId: row.tenantId, vertical: row.vertical, createdAt: row.createdAt, createdBy: row.createdBy, definition: row.definition };
    });

    // POST /admin/flows/validate - dry run; nothing is stored.
    fastify.post('/flows/validate', { preHandler: adminGuard(fastify, 'flows:read') }, async (request) => {
        const { definition, key } = validateBody.parse(request.body);
        // Saving overwrites key and version with the assigned ones, so the dry
        // run does the same: an editor never has to keep them correct by hand.
        const parsed = parseFlowDefinition({ ...definition, key: key ?? 'draft', version: 1 });
        return parsed.ok ? { ok: true, errors: [] } : { ok: false, errors: parsed.errors };
    });

    // POST /admin/flows/:key/versions - save as the NEXT version (inactive draft unless activate).
    fastify.post('/flows/:key/versions', { preHandler: adminGuard(fastify, 'flows:write') }, async (request, reply) => {
        const { key } = keyParam.parse(request.params);
        const body = saveBody.parse(request.body);
        const { scope, vertical } = await resolveScope(body);
        try {
            const row = await service().createVersion({
                tenantId: scope.tenantId, vertical, key, definition: body.definition,
                createdBy: request.admin!.adminId, activate: body.activate,
            });
            await audit({
                prisma: fastify.prisma,
                action: 'flow.version.created',
                ...adminActor(request),
                tenantId: scope.tenantId,
                targetType: 'FlowDefinition',
                targetId: row.id,
                metadata: { key, version: row.version, vertical, activated: row.isActive },
            });
            reply.code(201);
            return { id: row.id, key, version: row.version, isActive: row.isActive, tenantId: row.tenantId, vertical: row.vertical };
        } catch (err) {
            if (err instanceof FlowDefinitionError) return unprocessable(reply, err.errors);
            if (err instanceof FlowVersionConflictError) throw fastify.httpErrors.conflict('Someone else saved a version at the same moment. Reload and try again.');
            throw err;
        }
    });

    // POST /admin/flows/:key/activate  { tenantId|vertical, version }  - publish, or roll back to an older one.
    fastify.post('/flows/:key/activate', { preHandler: adminGuard(fastify, 'flows:write') }, async (request, reply) => {
        const { key } = keyParam.parse(request.params);
        const body = activateBody.parse(request.body);
        const { scope, vertical } = await resolveScope(body);
        const svc = service();
        const before = await svc.listVersions(scope, key);
        const previousActive = before.filter((r) => r.isActive).reduce((m, r) => Math.max(m, r.version), 0) || null;
        try {
            await svc.activateVersion(scope, key, body.version);
        } catch (err) {
            if (err instanceof FlowNotFoundError) throw fastify.httpErrors.notFound('Version not found');
            if (err instanceof FlowDefinitionError) return unprocessable(reply, err.errors);
            throw err;
        }
        const rollback = previousActive !== null && body.version < previousActive;
        await audit({
            prisma: fastify.prisma,
            action: 'flow.version.activated',
            ...adminActor(request),
            tenantId: scope.tenantId,
            targetType: 'FlowDefinition',
            targetId: before.find((r) => r.version === body.version)?.id ?? null,
            metadata: { key, version: body.version, previousActiveVersion: previousActive, rollback, vertical },
        });
        return { key, activeVersion: body.version, previousActiveVersion: previousActive, rollback };
    });
};

export default flowRoutes;
