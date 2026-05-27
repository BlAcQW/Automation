import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { verifyApiKey } from '../../services/arkesel.js';

const connectSchema = z.object({
    apiKey: z.string().min(1).max(200),
    senderId: z.string().min(1).max(11),
});

const smsRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);

    // GET /sms/status — drives the Settings card.
    fastify.get('/status', async (request) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { arkeselApiKey: true, arkeselSenderId: true },
        });
        if (!tenant?.arkeselApiKey || !tenant.arkeselSenderId) {
            return { connected: false, senderId: null, balance: null };
        }

        // Live balance probe — lazy fail.
        let balance: number | null = null;
        try {
            const decrypted = decrypt(tenant.arkeselApiKey);
            const res = await verifyApiKey(decrypted);
            if (res.ok && typeof res.balance === 'number') {
                balance = res.balance;
            }
        } catch {
            /* fall through with balance=null */
        }

        return {
            connected: true,
            senderId: tenant.arkeselSenderId,
            balance,
        };
    });

    // POST /sms/connect — validate the key against Arkesel before storing.
    fastify.post('/connect', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:sms-connect`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect SMS');
        }
        const body = connectSchema.parse(request.body);

        const probe = await verifyApiKey(body.apiKey);
        if (!probe.ok) {
            throw fastify.httpErrors.badRequest(probe.error ?? 'Arkesel rejected the API key');
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                arkeselApiKey: encrypt(body.apiKey),
                arkeselSenderId: body.senderId,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'sms.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { senderId: body.senderId },
            ipAddress: request.ip,
        });

        return { success: true, senderId: body.senderId, balance: probe.balance ?? null };
    });

    fastify.post('/disconnect', async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect SMS');
        }
        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { arkeselApiKey: null, arkeselSenderId: null },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'sms.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            ipAddress: request.ip,
        });
        return { disconnected: true };
    });
};

export default smsRoutes;
