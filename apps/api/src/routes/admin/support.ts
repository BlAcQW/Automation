import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AdminPermission } from '../../services/admin-permissions.js';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import {
    endSupportSession,
    findOwnLiveSession,
    listSupportSessions,
    startSupportSession,
    supportTokenPayload,
    supportTokenTtlSeconds,
    SupportSessionError,
} from '../../services/support-session.js';
import {
    getPlatformSwitches,
    setPlatformSwitch,
    setTenantSwitch,
    SwitchError,
    type SwitchKind,
} from '../../services/platform-switches.js';
import { triggerTakeover } from '../../services/human-takeover.js';
import { adminActor, adminGuard } from './guard.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const startBody = z
    .object({
        reason: z.string().trim().min(5).max(300),
        // Capped again server-side (MAX_SUPPORT_MINUTES); no `mode`: READ_ONLY only.
        minutes: z.number().int().min(1).max(600).optional(),
    })
    .strict();
const switchBody = z.object({ paused: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();
const kindParam = z.object({ id: z.string().min(1).max(64), kind: z.enum(['outbound', 'payouts']) });
const platformKindParam = z.object({ kind: z.enum(['outbound', 'payouts']) });

const supportRoutes: FastifyPluginAsync = async (fastify) => {
    function signSupportToken(session: { id: string; adminId: string; tenantId: string; expiresAt: Date }) {
        const ttl = supportTokenTtlSeconds(session);
        if (ttl <= 0) throw fastify.httpErrors.gone('Support session has expired');
        const token = fastify.jwt.sign(supportTokenPayload(session), { expiresIn: `${ttl}s` });
        return { token, tokenExpiresInSeconds: ttl };
    }

    // POST /admin/tenants/:id/support-sessions - open a read-only session + token.
    fastify.post('/tenants/:id/support-sessions', { preHandler: adminGuard(fastify, 'support:access') }, async (request, reply) => {
        const { id: tenantId } = idParam.parse(request.params);
        const body = startBody.parse(request.body);
        let session;
        try {
            session = await startSupportSession(fastify.prisma, { adminId: request.admin!.adminId, tenantId, reason: body.reason, minutes: body.minutes });
        } catch (err) {
            if (err instanceof SupportSessionError) {
                if (err.code === 'tenant_not_found') throw fastify.httpErrors.notFound(err.message);
                throw fastify.httpErrors.badRequest(err.message);
            }
            throw err;
        }
        await audit({
            prisma: fastify.prisma,
            action: 'support.session.started',
            ...adminActor(request),
            tenantId,
            targetType: 'SupportSession',
            targetId: session.id,
            metadata: { reason: session.reason, mode: session.mode, expiresAt: session.expiresAt.toISOString() },
        });
        reply.code(201);
        return {
            session: { id: session.id, tenantId, mode: session.mode, reason: session.reason, expiresAt: session.expiresAt },
            ...signSupportToken(session),
        };
    });

    // POST /admin/support-sessions/:id/token - a fresh short-lived token for MY live session.
    fastify.post('/support-sessions/:id/token', { preHandler: adminGuard(fastify, 'support:access') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const found = await findOwnLiveSession(fastify.prisma, id, request.admin!.adminId);
        if (!found) throw fastify.httpErrors.notFound('No live support session with that id');
        await audit({
            prisma: fastify.prisma,
            action: 'support.token.issued',
            ...adminActor(request),
            tenantId: found.tenantId,
            targetType: 'SupportSession',
            targetId: id,
        });
        return signSupportToken(found);
    });

    // POST /admin/support-sessions/:id/end
    fastify.post('/support-sessions/:id/end', { preHandler: adminGuard(fastify, 'support:access') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const ended = await endSupportSession(fastify.prisma, id, { adminId: request.admin!.adminId, role: request.admin!.role });
        if (!ended) throw fastify.httpErrors.notFound('No live support session with that id');
        const row = await fastify.prisma.supportSession.findUnique({ where: { id }, select: { id: true, tenantId: true } });
        await audit({
            prisma: fastify.prisma,
            action: 'support.session.ended',
            ...adminActor(request),
            tenantId: row?.tenantId ?? null,
            targetType: 'SupportSession',
            targetId: id,
        });
        return { ended: true };
    });

    // GET /admin/support-sessions - visible to every role that can read the audit log.
    fastify.get('/support-sessions', { preHandler: adminGuard(fastify, 'audit:read') }, async (request) => {
        const q = z.object({
            tenantId: z.string().min(1).max(64).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
        }).parse(request.query);
        return { data: await listSupportSessions(fastify.prisma, q) };
    });

    // ------------------------------------------------------------
    // Emergency switches
    // ------------------------------------------------------------
    const SWITCH_PERMISSION: Record<string, AdminPermission> = { outbound: 'outbound:switch', payouts: 'payouts:switch' };
    const PLATFORM_PERMISSION: Record<string, AdminPermission> = { outbound: 'outbound:platform_switch', payouts: 'payouts:platform_switch' };
    const kindOf = (r: FastifyRequest) => String((r.params as { kind?: unknown }).kind);

    // PUT /admin/tenants/:id/switches/:kind  (kind = outbound | payouts)
    fastify.put('/tenants/:id/switches/:kind', {
        // Which permission applies depends on the switch. An unknown kind falls
        // back to the weakest read permission and is then refused as a 400.
        preHandler: adminGuard(fastify, (r) => SWITCH_PERMISSION[kindOf(r)] ?? 'attention:read'),
    }, async (request) => {
        const { id: tenantId, kind } = kindParam.parse(request.params);
        const body = switchBody.parse(request.body);
        let found: boolean;
        try {
            found = await setTenantSwitch(fastify.prisma, tenantId, kind as SwitchKind, body.paused, body.reason);
        } catch (err) {
            if (err instanceof SwitchError) throw fastify.httpErrors.badRequest(err.message);
            throw err;
        }
        if (!found) throw fastify.httpErrors.notFound('Organisation not found');
        await audit({
            prisma: fastify.prisma,
            action: `tenant.${kind}.${body.paused ? 'paused' : 'resumed'}`,
            ...adminActor(request),
            tenantId,
            targetType: 'Tenant',
            targetId: tenantId,
            metadata: body.paused ? { reason: body.reason?.trim() } : null,
        });
        return { tenantId, kind, paused: body.paused };
    });

    // GET /admin/platform/switches
    fastify.get('/platform/switches', { preHandler: adminGuard(fastify, 'attention:read') }, async () =>
        getPlatformSwitches(fastify.prisma));

    // PUT /admin/platform/switches/:kind
    fastify.put('/platform/switches/:kind', {
        preHandler: adminGuard(fastify, (r) => PLATFORM_PERMISSION[kindOf(r)] ?? 'attention:read'),
    }, async (request) => {
        const { kind } = platformKindParam.parse(request.params);
        const body = switchBody.parse(request.body);
        try {
            await setPlatformSwitch(fastify.prisma, kind, body.paused, body.reason, request.admin!.adminId);
        } catch (err) {
            if (err instanceof SwitchError) throw fastify.httpErrors.badRequest(err.message);
            throw err;
        }
        await audit({
            prisma: fastify.prisma,
            action: `platform.${kind}.${body.paused ? 'paused' : 'resumed'}`,
            ...adminActor(request),
            tenantId: null,
            metadata: body.paused ? { reason: body.reason?.trim() } : null,
        });
        return { kind, paused: body.paused };
    });

    // POST /admin/conversations/:id/handoff - force a conversation to a human.
    fastify.post('/conversations/:id/handoff', { preHandler: adminGuard(fastify, 'conversations:handoff') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).strict().parse(request.body);
        const convo = await fastify.prisma.conversation.findFirst({ where: { id }, select: { id: true, tenantId: true, state: true } });
        if (!convo) throw fastify.httpErrors.notFound('Conversation not found');
        if (convo.state === 'HUMAN_ACTIVE') throw fastify.httpErrors.conflict('This conversation is already with a person');
        await triggerTakeover(fastify.prisma, id, `Admin handoff: ${reason}`);
        await audit({
            prisma: fastify.prisma,
            action: 'conversation.handoff.forced',
            ...adminActor(request),
            tenantId: convo.tenantId,
            targetType: 'Conversation',
            targetId: id,
            metadata: { reason },
        });
        return { id, state: 'HUMAN_ACTIVE' };
    });
};

export default supportRoutes;
