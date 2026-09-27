import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../services/audit.js';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';

/**
 * Break-glass reveal of a single customer's contact details.
 *
 * Masking staff out of the customer book only works if there is a legitimate
 * way through it — otherwise people photograph the screen, ring the owner, or
 * the owner simply turns masking off. So staff can reveal one customer at a
 * time, and every reveal is written to the audit log with who, what and when.
 *
 * The rate limit is the actual security control here, not the masking. Masking
 * stops casual copying; the limit is what stops a departing staff member
 * harvesting the whole list one record at a time on their last afternoon.
 */
const REVEALS_PER_HOUR = 20;

const privacyRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.post('/reveal', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: REVEALS_PER_HOUR,
                timeWindow: '1 hour',
                keyGenerator: (req: any) => `${req.user?.userId ?? req.ip}:contact-reveal`,
            },
        },
    }, async (request) => {
        const body = z.object({
            scope: z.enum(['conversation', 'booking', 'order']),
            id: z.string().min(1),
        }).parse(request.body);

        const tenantId = request.user.tenantId;

        // Always scoped by tenantId as well as id: an id alone must never be
        // enough to read another tenant's customer.
        let contact: { customerPhone?: string | null; customerEmail?: string | null; customerName?: string | null } | null = null;

        if (body.scope === 'conversation') {
            contact = await fastify.prisma.conversation.findFirst({
                where: { id: body.id, tenantId },
                select: { customerPhone: true, customerName: true },
            });
        } else if (body.scope === 'booking') {
            contact = await fastify.prisma.booking.findFirst({
                where: { id: body.id, tenantId },
                select: { customerPhone: true, customerEmail: true, customerName: true },
            });
        } else {
            contact = await fastify.prisma.order.findFirst({
                where: { id: body.id, tenantId },
                select: { customerPhone: true, customerName: true },
            });
        }

        if (!contact) {
            throw fastify.httpErrors.notFound('Not found');
        }

        // Logged even for the owner: the value of the log is answering "who
        // looked at this customer", and an owner-shaped hole spoils that.
        await audit({
            prisma: fastify.prisma,
            action: 'privacy.contact_revealed',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            metadata: { scope: body.scope, recordId: body.id, role: request.user.role },
            ipAddress: request.ip,
        });

        return {
            customerName: contact.customerName ?? null,
            customerPhone: contact.customerPhone ?? null,
            customerEmail: contact.customerEmail ?? null,
        };
    });

    // GET /privacy/policy — lets a client know whether to render reveal
    // affordances at all, without having to infer it from bullet characters.
    fastify.get('/policy', { preHandler: [fastify.authenticate] }, async (request) => {
        const masked = await resolveMaskPolicy(
            fastify.prisma,
            request.user.tenantId,
            request.user.role,
        );
        return { contactsMasked: masked, revealsPerHour: REVEALS_PER_HOUR };
    });
};

export default privacyRoutes;
