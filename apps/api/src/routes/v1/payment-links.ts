import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createFulfillmentPaymentLink } from '../../services/payment-link.js';
import { ENTITY_REF_PATTERN, EXTERNAL_APP_FULFILLMENT_KIND } from '../../services/external-app.js';
import { ApiError, V1_ROUTE_CONFIG, e164, requireApiKey } from './shared.js';

/** 1,000,000.00 in major units: a sanity ceiling against a unit mix-up (major sent as minor). */
export const MAX_AMOUNT_MINOR = 100_000_000;

const httpsUrl = z
    .string()
    .max(500)
    .url()
    .refine((u) => {
        try {
            const p = new URL(u);
            return p.protocol === 'https:' && !p.username && !p.password;
        } catch {
            return false;
        }
    }, 'callbackUrl must be an https URL without credentials');

const bodySchema = z
    .object({
        entityRef: z.string().regex(ENTITY_REF_PATTERN, 'entityRef must be 1-100 of A-Z a-z 0-9 _ . : -'),
        amountMinor: z.number().int().min(1).max(MAX_AMOUNT_MINOR),
        customerPhone: e164,
        callbackUrl: httpsUrl.optional(),
    })
    .strict();

const paymentLinkRoutes: FastifyPluginAsync = async (fastify) => {
    const opts = { config: V1_ROUTE_CONFIG, preHandler: fastify.authenticateApiKey(['payments:write']) };

    // POST /v1/payment-links
    fastify.post('/payment-links', opts, async (request, reply) => {
        const { tenantId } = requireApiKey(request);
        const body = bodySchema.parse(request.body);

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { paystackSecretKey: true, paymentCurrency: true },
        });
        if (!tenant) throw new ApiError(401, 'unauthorized', 'Invalid or missing API key');

        let reference = '';
        const url = await createFulfillmentPaymentLink({
            tenantId,
            paystackSecretKeyEncrypted: tenant.paystackSecretKey,
            currency: tenant.paymentCurrency,
            kind: EXTERNAL_APP_FULFILLMENT_KIND,
            entityId: body.entityRef,
            amount: body.amountMinor / 100,
            customerPhone: body.customerPhone,
            callbackUrl: body.callbackUrl,
            // Nothing of ours to persist: the app owns the entity, and Paystack
            // holds kind + entity + tenant in the charge metadata, which the
            // webhook cross-checks. We only capture the reference to return it.
            onCreated: (link) => { reference = link.reference; },
        });
        if (!url) {
            throw new ApiError(
                422,
                'payments_not_configured',
                'A payment link could not be created. The organisation must connect its own Paystack account before external apps can collect payments.',
            );
        }

        reply.code(201);
        return {
            data: { url, reference, entityRef: body.entityRef, amountMinor: body.amountMinor, currency: tenant.paymentCurrency },
        };
    });
};

export default paymentLinkRoutes;
