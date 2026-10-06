/**
 * Bots ("packs") an organisation can run, installable from the admin.
 *
 * Today one: TURBO's rides bot (the RIDES pack's "turbo-founding" flow, its
 * ride settings, and the organisation switched to that flow). The installer
 * is idempotent: it never overwrites settings the organisation changed and
 * publishes a new flow version only when the wording changed.
 *
 * Installing publishes a conversation flow, so it needs flows:write (the same
 * permission as the workflow editor); viewing needs tenants:read. Every
 * install is audited with the admin who pressed the button.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { installTurboPack } from '../../services/rides/install.js';
import { adminActor, adminGuard } from './guard.js';

interface PackDefinition {
    key: string;
    name: string;
    description: string;
    vertical: 'RIDES' | 'APPOINTMENTS';
    install: (db: PrismaClient, args: { tenantId: string; createdBy: string }) => Promise<{
        settingsCreated: boolean; flowVersion: number; flowPublished: boolean;
    }>;
}

export const PACKS: readonly PackDefinition[] = [
    {
        key: 'turbo-founding',
        name: 'TURBO rides bot',
        description: 'Founding 50 package, PAYG rides, booking with pickup and destination, balance and ride history, in TURBO\'s wording.',
        vertical: 'RIDES',
        install: installTurboPack,
    },
];

const idParam = z.object({ id: z.string().min(1).max(64) });
const installParams = z.object({ id: z.string().min(1).max(64), key: z.string().min(1).max(64) });

const adminPackRoutes: FastifyPluginAsync = async (fastify) => {
    const loadTenant = async (id: string) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id },
            select: { id: true, name: true, vertical: true, conversationMode: true, activeFlowKey: true },
        });
        if (!tenant) throw fastify.httpErrors.notFound('Organisation not found');
        return tenant;
    };
    const isInstalled = (t: { conversationMode: string | null; activeFlowKey: string | null }, key: string) =>
        t.conversationMode === 'flow' && t.activeFlowKey === key;

    fastify.get('/tenants/:id/packs', { preHandler: adminGuard(fastify, 'tenants:read') }, async (request) => {
        const { id } = idParam.parse(request.params);
        const tenant = await loadTenant(id);
        return {
            data: PACKS.map((p) => ({
                key: p.key,
                name: p.name,
                description: p.description,
                vertical: p.vertical,
                compatible: tenant.vertical === p.vertical,
                installed: isInstalled(tenant, p.key),
            })),
        };
    });

    fastify.post('/tenants/:id/packs/:key/install', { preHandler: adminGuard(fastify, 'flows:write') }, async (request) => {
        const { id, key } = installParams.parse(request.params);
        const pack = PACKS.find((p) => p.key === key);
        if (!pack) throw fastify.httpErrors.notFound('Unknown bot');
        const tenant = await loadTenant(id);
        if (tenant.vertical !== pack.vertical) {
            throw fastify.httpErrors.conflict(`${pack.name} needs a ${pack.vertical} organisation. Change the organisation type to ${pack.vertical} first.`);
        }
        const actor = adminActor(request);
        const result = await pack.install(fastify.prisma as unknown as PrismaClient, { tenantId: id, createdBy: `admin:${actor.actorId}` });
        await audit({
            prisma: fastify.prisma,
            ...actor,
            action: 'pack.installed',
            tenantId: id,
            targetType: 'Tenant',
            targetId: id,
            metadata: { pack: pack.key, flowVersion: result.flowVersion, flowPublished: result.flowPublished, settingsCreated: result.settingsCreated },
        });
        return { data: { ...result, pack: pack.key, upToDate: !result.flowPublished && !result.settingsCreated } };
    });
};

export default adminPackRoutes;
