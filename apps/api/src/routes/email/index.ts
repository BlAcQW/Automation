import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { encrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { verifyGmailCreds } from '../../services/gmail-smtp.js';

const connectSchema = z.object({
    user: z.string().email().max(254),
    appPassword: z.string().min(8).max(64),
    fromName: z.string().min(1).max(120).optional(),
});

const emailRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    fastify.get('/status', async (request) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { gmailUser: true, gmailFromName: true, gmailAppPassword: true },
        });
        return {
            connected: !!(tenant?.gmailUser && tenant.gmailAppPassword),
            user: tenant?.gmailUser ?? null,
            fromName: tenant?.gmailFromName ?? null,
        };
    });

    fastify.post('/connect', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:email-connect`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect email');
        }
        const body = connectSchema.parse(request.body);

        // Strip whitespace from app password — Google's UI inserts spaces
        // every 4 chars and users almost always paste those in.
        const cleanAppPassword = body.appPassword.replace(/\s+/g, '');

        const probe = await verifyGmailCreds({
            user: body.user,
            appPassword: cleanAppPassword,
        });
        if (!probe.ok) {
            const msg = probe.error?.startsWith('gmail_eauth')
                ? 'Gmail rejected the app password. Generate a fresh one at myaccount.google.com/apppasswords.'
                : probe.error ?? 'Gmail SMTP verification failed';
            throw fastify.httpErrors.badRequest(msg);
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                gmailUser: body.user,
                gmailAppPassword: encrypt(cleanAppPassword),
                gmailFromName: body.fromName ?? null,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'email.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { user: body.user, fromName: body.fromName ?? null },
            ipAddress: request.ip,
        });

        return { success: true, user: body.user, fromName: body.fromName ?? null };
    });

    fastify.post('/disconnect', async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect email');
        }
        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { gmailUser: null, gmailAppPassword: null, gmailFromName: null },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'email.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            ipAddress: request.ip,
        });
        return { disconnected: true };
    });
};

export default emailRoutes;
