/**
 * Platform admin: an organisation's messaging channels (WhatsApp, Instagram,
 * Messenger) on one panel, and the actions support needs on them.
 *
 *   GET  /admin/tenants/:id/channels                   tenants:read
 *   GET  /admin/tenants/:id/whatsapp                   tenants:read     (WhatsApp slice)
 *   POST /admin/tenants/:id/whatsapp/disconnect        channels:manage  { reason }
 *   POST /admin/tenants/:id/whatsapp/hosted/resend     channels:manage  { codeMethod? }
 *   POST /admin/tenants/:id/whatsapp/health-check      channels:manage
 *   POST /admin/tenants/:id/facebook/disconnect        channels:manage  { reason }  (Messenger + Instagram)
 *   POST /admin/tenants/:id/instagram/disconnect       channels:manage  { reason }  (Instagram only)
 *
 * No token or PIN ever leaves this file: credential columns are not selected.
 * Every action is audited with the admin and (for disconnects) the reason,
 * and the organisation is told in-app.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { createNotification } from '../../services/notifications.js';
import {
    buildWhatsappStatus,
    CONNECTION_STATUS_SELECT,
    disconnectWhatsapp,
    resendHostedCode,
    waError,
} from '../../services/whatsapp-connection.js';
import { checkTenantWhatsappHealth, PROBLEM_TEXT, type HealthProblem } from '../../services/whatsapp-health.js';
import { disconnectFacebookPage, unlinkInstagram } from '../../services/facebook-connection.js';
import { adminActor, adminGuard } from './guard.js';

const idParam = z.object({ id: z.string().min(1).max(64) });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const EVENTS_LISTED = 20;

export const CHANNEL_AUDIT_ACTIONS = [
    'whatsapp.connected',
    'whatsapp.disconnected',
    'whatsapp.connect_failed',
    'whatsapp.hosted_started',
    'whatsapp.hosted_code_resent',
    'whatsapp.hosted_registered',
    'whatsapp.health_checked',
    'channels.facebook_connected',
    'channels.facebook_disconnected',
    'channels.instagram_disconnected',
] as const;

async function requireTenant(fastify: FastifyInstance, id: string) {
    const tenant = await fastify.prisma.tenant.findUnique({
        where: { id },
        select: {
            id: true, name: true,
            ...CONNECTION_STATUS_SELECT,
            whatsappConnectedByUserId: true,
            facebookPageId: true, facebookPageName: true, facebookConnectedAt: true, facebookConnectedByUserId: true,
            instagramUserId: true, instagramUsername: true, instagramConnectedAt: true,
        },
    });
    if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');
    return tenant;
}

type Person = { id: string; name: string | null; email: string | null };

async function loadChannels(fastify: FastifyInstance, id: string, actions: readonly string[] = CHANNEL_AUDIT_ACTIONS) {
    const prisma = fastify.prisma;
    const t = await requireTenant(fastify, id);
    const [lastInbound, events] = await Promise.all([
        prisma.conversation.groupBy({ by: ['channel'], where: { tenantId: id }, _max: { lastInboundAt: true } }),
        prisma.auditLog.findMany({
            where: { tenantId: id, action: { in: [...actions] } },
            orderBy: { createdAt: 'desc' },
            take: EVENTS_LISTED,
            select: { id: true, action: true, actorType: true, actorId: true, createdAt: true, metadata: true },
        }),
    ]);

    const userIds = new Set<string>();
    if (t.whatsappConnectedByUserId) userIds.add(t.whatsappConnectedByUserId);
    if (t.facebookConnectedByUserId) userIds.add(t.facebookConnectedByUserId);
    const adminIds = new Set<string>();
    for (const e of events) {
        if (e.actorId && e.actorType === 'USER') userIds.add(e.actorId);
        if (e.actorId && e.actorType === 'ADMIN') adminIds.add(e.actorId);
    }
    const [users, admins] = await Promise.all([
        userIds.size
            ? prisma.user.findMany({ where: { tenantId: id, id: { in: [...userIds] } }, select: { id: true, name: true, email: true } })
            : Promise.resolve([] as Person[]),
        adminIds.size
            ? prisma.admin.findMany({ where: { id: { in: [...adminIds] } }, select: { id: true, name: true, email: true } })
            : Promise.resolve([] as Person[]),
    ]);
    const userById = new Map<string, Person>(users.map((u: Person) => [u.id, u]));
    const adminById = new Map<string, Person>(admins.map((a: Person) => [a.id, a]));
    const person = (userId: string | null): Person | null =>
        userId ? userById.get(userId) ?? { id: userId, name: null, email: null } : null;
    const last = (channel: string): Date | null =>
        lastInbound.find((g: any) => g.channel === channel)?._max?.lastInboundAt ?? null;

    const wa = buildWhatsappStatus(t);
    const problem = wa.health.problem as HealthProblem | null;
    return {
        tenant: { id: t.id, name: t.name },
        whatsapp: {
            state: wa.state,
            connected: wa.connected,
            mode: wa.mode,
            phoneNumberId: wa.phoneNumberId,
            displayNumber: wa.displayNumber,
            verifiedName: wa.verifiedName,
            nameStatus: wa.nameStatus,
            hosted: wa.hosted,
            numberStatus: wa.numberStatus,
            billedBy: wa.billedBy,
            connectedAt: wa.connectedAt,
            connectedBy: wa.connected ? person(t.whatsappConnectedByUserId) : null,
            pending: wa.pending,
            health: { ...wa.health, problemText: problem ? PROBLEM_TEXT[problem] ?? problem : null },
            lastInboundAt: last('WHATSAPP'),
            hostedAvailable: wa.hostedAvailable,
        },
        instagram: {
            connected: !!t.instagramUserId,
            username: t.instagramUsername,
            connectedAt: t.instagramUserId ? t.instagramConnectedAt : null,
            connectedBy: t.instagramUserId ? person(t.facebookConnectedByUserId) : null,
            lastInboundAt: last('INSTAGRAM'),
        },
        messenger: {
            connected: !!t.facebookPageId,
            pageId: t.facebookPageId,
            pageName: t.facebookPageName,
            connectedAt: t.facebookPageId ? t.facebookConnectedAt : null,
            connectedBy: t.facebookPageId ? person(t.facebookConnectedByUserId) : null,
            lastInboundAt: last('MESSENGER'),
        },
        recentEvents: events.map((e: any) => ({
            id: e.id,
            action: e.action,
            actorType: e.actorType,
            actor: e.actorId
                ? (e.actorType === 'ADMIN' ? adminById.get(e.actorId) : e.actorType === 'USER' ? userById.get(e.actorId) : undefined)
                    ?? { id: e.actorId, name: null, email: null }
                : null,
            createdAt: e.createdAt,
            metadata: e.metadata,
        })),
    };
}

/** Best effort: a failed notification never undoes an action that already happened. */
async function notifyOrganisation(fastify: FastifyInstance, request: FastifyRequest, tenantId: string, title: string, message: string, kind: string) {
    try {
        await createNotification(fastify.prisma, { tenantId, type: 'SYSTEM', title, message, metadata: { kind } }, request.log);
    } catch (err) {
        request.log.warn({ err, tenantId, kind }, 'channel notification failed');
    }
}

const adminChannelRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/tenants/:id/channels', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = idParam.parse(request.params);
        return { data: await loadChannels(fastify, id) };
    });

    fastify.get('/tenants/:id/whatsapp', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const all = await loadChannels(fastify, id, CHANNEL_AUDIT_ACTIONS.filter((a) => a.startsWith('whatsapp.')));
        return { data: { tenant: all.tenant, whatsapp: all.whatsapp, recentEvents: all.recentEvents } };
    });

    fastify.post('/tenants/:id/whatsapp/disconnect', { preHandler: adminGuard(fastify, 'channels:manage') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = reasonBody.parse(request.body);
        const t = await requireTenant(fastify, id);
        if (!t.whatsappPhoneNumberId) throw waError('NOT_CONNECTED');

        const outcome = await disconnectWhatsapp(fastify.prisma, id, request.log);
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'whatsapp.disconnected',
            tenantId: id,
            targetType: 'TENANT',
            targetId: id,
            metadata: {
                mode: outcome.mode, phoneNumberId: outcome.phoneNumberId, displayNumber: outcome.displayNumber,
                metaCleanup: outcome.metaCleanup, reason, by: 'admin',
            },
        });
        await notifyOrganisation(fastify, request, id, 'WhatsApp disconnected by Bookly',
            `Bookly support disconnected your WhatsApp number${outcome.displayNumber ? ` ${outcome.displayNumber}` : ''}. Reason: ${reason}. Customers cannot reach you on WhatsApp until you connect it again.`,
            'whatsapp.admin_disconnected');
        return { data: { disconnected: true, metaCleanup: outcome.metaCleanup } };
    });

    fastify.post('/tenants/:id/whatsapp/hosted/resend', {
        preHandler: adminGuard(fastify, 'channels:manage'),
        config: {
            // After the guard (hook: preHandler) so the key is the signed-in admin + organisation.
            rateLimit: {
                max: 3,
                timeWindow: '10 minutes',
                hook: 'preHandler',
                keyGenerator: (req: any) => `admin:${req.admin?.adminId ?? req.ip}:${req.params?.id}:hosted-resend`,
                errorResponseBuilder: () => waError('TOO_MANY_ATTEMPTS'),
            },
        },
    }, async (request) => {
        const { id } = idParam.parse(request.params);
        const body = z.object({ codeMethod: z.enum(['SMS', 'VOICE']).optional() }).strict().parse(request.body ?? {});
        await requireTenant(fastify, id);
        const codeMethod = body.codeMethod ?? 'SMS';
        try {
            const outcome = await resendHostedCode(fastify.prisma, id, codeMethod, request.log);
            await audit({
                prisma: fastify.prisma,
                ...adminActor(request),
                action: 'whatsapp.hosted_code_resent',
                tenantId: id,
                targetType: 'TENANT',
                targetId: id,
                metadata: { codeMethod: outcome.codeMethod, by: 'admin', outcome: 'sent' },
            });
            return { data: outcome };
        } catch (err) {
            // Every admin attempt is on the record, including refused ones.
            await audit({
                prisma: fastify.prisma,
                ...adminActor(request),
                action: 'whatsapp.hosted_code_resent',
                tenantId: id,
                targetType: 'TENANT',
                targetId: id,
                metadata: { codeMethod, by: 'admin', outcome: 'refused', code: (err as { publicCode?: string }).publicCode ?? 'ERROR' },
            });
            throw err;
        }
    });

    fastify.post('/tenants/:id/whatsapp/health-check', { preHandler: adminGuard(fastify, 'channels:manage') }, async (request) => {
        const { id } = idParam.parse(request.params);
        await requireTenant(fastify, id);
        const result = await checkTenantWhatsappHealth(fastify.prisma, id, { log: request.log });
        if (!result.checked) throw waError('NOT_CONNECTED');
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'whatsapp.health_checked',
            tenantId: id,
            targetType: 'TENANT',
            targetId: id,
            metadata: { problem: result.problem, qualityRating: result.qualityRating, transient: !!result.transient },
        });
        return { data: result };
    });

    fastify.post('/tenants/:id/facebook/disconnect', { preHandler: adminGuard(fastify, 'channels:manage') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = reasonBody.parse(request.body);
        const t = await requireTenant(fastify, id);
        if (!t.facebookPageId) throw fastify.httpErrors.conflict('Facebook is not connected');

        const outcome = await disconnectFacebookPage(fastify.prisma, id, request.log);
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'channels.facebook_disconnected',
            tenantId: id,
            targetType: 'TENANT',
            targetId: id,
            metadata: { pageId: outcome.pageId, pageName: outcome.pageName, instagram: outcome.instagramUsername, metaCleanup: outcome.metaCleanup, reason, by: 'admin' },
        });
        await notifyOrganisation(fastify, request, id, 'Facebook and Instagram disconnected by Bookly',
            `Bookly support disconnected your Facebook Page${outcome.pageName ? ` "${outcome.pageName}"` : ''}${outcome.instagramUsername ? ` and Instagram @${outcome.instagramUsername}` : ''}. Reason: ${reason}. Connect them again under Channels when you are ready.`,
            'channels.admin_facebook_disconnected');
        return { data: { disconnected: true, metaCleanup: outcome.metaCleanup } };
    });

    fastify.post('/tenants/:id/instagram/disconnect', { preHandler: adminGuard(fastify, 'channels:manage') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const { reason } = reasonBody.parse(request.body);
        const t = await requireTenant(fastify, id);
        if (!t.instagramUserId) throw fastify.httpErrors.conflict('Instagram is not connected');

        const outcome = await unlinkInstagram(fastify.prisma, id);
        await audit({
            prisma: fastify.prisma,
            ...adminActor(request),
            action: 'channels.instagram_disconnected',
            tenantId: id,
            targetType: 'TENANT',
            targetId: id,
            metadata: { instagram: outcome.instagramUsername, reason, by: 'admin' },
        });
        await notifyOrganisation(fastify, request, id, 'Instagram disconnected by Bookly',
            `Bookly support disconnected Instagram${outcome.instagramUsername ? ` @${outcome.instagramUsername}` : ''}. Reason: ${reason}. Messenger stays connected.`,
            'channels.admin_instagram_disconnected');
        return { data: { disconnected: true } };
    });
};

export default adminChannelRoutes;
