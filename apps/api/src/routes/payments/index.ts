import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { fulfillBookingCharge, fulfillOrderCharge } from '../../services/payment-fulfillment.js';
import {
    initializeTransaction,
    verifyTransaction,
    verifyWebhookSignature,
    PaystackError,
} from '../../services/paystack.js';

const SUPPORTED_CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'] as const;

const connectSchema = z.object({
    publicKey: z.string().min(1).max(200),
    secretKey: z.string().min(1).max(200),
    currency: z.enum(SUPPORTED_CURRENCIES).default('NGN'),
});

interface PaystackWebhookEvent {
    event?: string;
    data?: {
        reference?: string;
        metadata?: {
            tenantId?: string;
            orderId?: string;
            bookingId?: string;
            customerPhone?: string;
        };
    };
}

/**
 * Where Paystack redirects the customer after they pay. Per-kind so an order
 * payment lands on `/pay/order` and a booking deposit on `/pay/booking` —
 * both public, unauthenticated confirmation pages that verify-on-return.
 */
function paymentCallbackUrl(kind: 'order' | 'booking'): string | undefined {
    return config.frontendUrl ? `${config.frontendUrl}/pay/${kind}` : undefined;
}

function syntheticCustomerEmail(customerPhone: string): string {
    const digits = customerPhone.replace(/[^0-9]/g, '');
    // Paystack rejects reserved TLDs like `.local` ("Invalid Email Address
    // Passed") — use a real public TLD. The customer doesn't see this; it's
    // a placeholder for Paystack's required `email` field.
    return `${digits || 'customer'}@customer.bookingflow.app`;
}

const paymentsRoutes: FastifyPluginAsync = async (fastify) => {
    // POST /payments/connect — owner-only, validates the secret against
    // Paystack with a cheap verify call before storing it (encrypted).
    fastify.post('/connect', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:payments-connect`,
            },
        },
    }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can connect payments');
        }
        const body = connectSchema.parse(request.body);

        // Probe the key — Paystack accepts any string in Authorization but
        // returns 401 from /transaction/totals on an invalid key.
        try {
            const probeRes = await fetch('https://api.paystack.co/transaction/totals', {
                headers: { Authorization: `Bearer ${body.secretKey}` },
            });
            if (probeRes.status === 401) {
                throw fastify.httpErrors.badRequest('Paystack rejected the secret key (401)');
            }
        } catch (err) {
            if ((err as any).statusCode === 400) throw err;
            request.log.warn({ err }, 'Paystack probe failed');
            // Continue: a probe error is non-fatal — webhook init will surface the real issue.
        }

        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: {
                paystackPublicKey: body.publicKey,
                paystackSecretKey: encrypt(body.secretKey),
                paymentCurrency: body.currency,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'payments.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { currency: body.currency, publicKeyPrefix: body.publicKey.slice(0, 12) },
            ipAddress: request.ip,
        });

        return { success: true, currency: body.currency };
    });

    // POST /payments/disconnect — clear the keys.
    fastify.post('/disconnect', { preHandler: [fastify.authenticate] }, async (request) => {
        if (request.user.role !== 'OWNER') {
            throw fastify.httpErrors.forbidden('Only owner can disconnect payments');
        }
        await fastify.prisma.tenant.update({
            where: { id: request.user.tenantId },
            data: { paystackPublicKey: null, paystackSecretKey: null },
        });
        await audit({
            prisma: fastify.prisma,
            action: 'payments.disconnected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            ipAddress: request.ip,
        });
        return { disconnected: true };
    });

    // GET /payments/status — for the dashboard.
    fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request) => {
        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: request.user.tenantId },
            select: { paystackPublicKey: true, paystackSecretKey: true, paymentCurrency: true },
        });
        return {
            connected: !!tenant?.paystackSecretKey,
            publicKey: tenant?.paystackPublicKey ?? null,
            currency: tenant?.paymentCurrency ?? 'NGN',
        };
    });

    // POST /payments/orders/:id/initialize — (re-)initialise a Paystack
    // transaction for an existing order. Used by staff to re-send a payment
    // link when the original URL has expired or the customer asks again.
    fastify.post('/orders/:id/initialize', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:payments-init`,
            },
        },
    }, async (request) => {
        const { id } = request.params as { id: string };
        const tenantId = request.user.tenantId;

        const [tenant, order] = await Promise.all([
            fastify.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { paystackSecretKey: true, paymentCurrency: true },
            }),
            fastify.prisma.order.findFirst({
                where: { id, tenantId },
                select: {
                    id: true,
                    orderRef: true,
                    customerPhone: true,
                    totalAmount: true,
                    paymentStatus: true,
                },
            }),
        ]);

        if (!order) throw fastify.httpErrors.notFound('Order not found');
        if (order.paymentStatus === 'PAID') {
            throw fastify.httpErrors.badRequest('Order is already paid');
        }
        if (!tenant?.paystackSecretKey) {
            throw fastify.httpErrors.badRequest('Paystack is not connected for this tenant');
        }

        const secretKey = decrypt(tenant.paystackSecretKey);
        const amountKobo = Math.round(Number(order.totalAmount) * 100);
        const reference = `bf_${order.id}_${Date.now()}`;

        let result;
        try {
            result = await initializeTransaction({
                secretKey,
                email: syntheticCustomerEmail(order.customerPhone),
                amountKobo,
                currency: tenant.paymentCurrency,
                reference,
                callbackUrl: paymentCallbackUrl('order'),
                metadata: { tenantId, orderId: order.id, customerPhone: order.customerPhone },
            });
        } catch (err) {
            await audit({
                prisma: fastify.prisma,
                action: 'payments.initialize',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                targetType: 'Order',
                targetId: order.id,
                metadata: {
                    success: false,
                    error: err instanceof PaystackError ? err.message : String(err),
                },
            });
            if (err instanceof PaystackError) {
                throw fastify.httpErrors.badGateway(err.message);
            }
            throw err;
        }

        await fastify.prisma.order.update({
            where: { id: order.id },
            data: {
                paymentReference: result.reference,
                paymentAuthorizationUrl: result.authorizationUrl,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'payments.initialize',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            targetType: 'Order',
            targetId: order.id,
            metadata: { success: true, reference: result.reference, amountKobo },
        });

        return {
            authorizationUrl: result.authorizationUrl,
            reference: result.reference,
        };
    });

    // POST /payments/bookings/:id/initialize — (re-)initialise a Paystack
    // transaction for an existing booking deposit. Mirrors the order flow.
    fastify.post('/bookings/:id/initialize', {
        preHandler: [fastify.authenticate],
        config: {
            rateLimit: {
                max: 30,
                timeWindow: '1 minute',
                keyGenerator: (req: any) => `${req.user?.tenantId ?? req.ip}:payments-init-booking`,
            },
        },
    }, async (request) => {
        const { id } = request.params as { id: string };
        const tenantId = request.user.tenantId;

        const [tenant, booking] = await Promise.all([
            fastify.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { paystackSecretKey: true, paymentCurrency: true },
            }),
            fastify.prisma.booking.findFirst({
                where: { id, tenantId },
                select: {
                    id: true,
                    bookingReference: true,
                    customerPhone: true,
                    depositAmount: true,
                    paymentStatus: true,
                },
            }),
        ]);

        if (!booking) throw fastify.httpErrors.notFound('Booking not found');
        if (booking.paymentStatus === 'PAID') {
            throw fastify.httpErrors.badRequest('Booking is already paid');
        }
        if (!booking.depositAmount) {
            throw fastify.httpErrors.badRequest('This booking has no deposit configured');
        }
        if (!tenant?.paystackSecretKey) {
            throw fastify.httpErrors.badRequest('Paystack is not connected for this tenant');
        }

        const secretKey = decrypt(tenant.paystackSecretKey);
        const amountKobo = Math.round(Number(booking.depositAmount) * 100);
        const reference = `bf_${booking.id}_${Date.now()}`;

        let result;
        try {
            result = await initializeTransaction({
                secretKey,
                email: syntheticCustomerEmail(booking.customerPhone),
                amountKobo,
                currency: tenant.paymentCurrency,
                reference,
                callbackUrl: paymentCallbackUrl('booking'),
                metadata: { tenantId, bookingId: booking.id, customerPhone: booking.customerPhone },
            });
        } catch (err) {
            await audit({
                prisma: fastify.prisma,
                action: 'payments.initialize',
                actorType: 'USER',
                actorId: request.user.userId,
                tenantId,
                targetType: 'Booking',
                targetId: booking.id,
                metadata: { success: false, entity: 'booking', error: err instanceof PaystackError ? err.message : String(err) },
            });
            if (err instanceof PaystackError) {
                throw fastify.httpErrors.badGateway(err.message);
            }
            throw err;
        }

        await fastify.prisma.booking.update({
            where: { id: booking.id },
            data: {
                paymentReference: result.reference,
                paymentAuthorizationUrl: result.authorizationUrl,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'payments.initialize',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId,
            targetType: 'Booking',
            targetId: booking.id,
            metadata: { success: true, entity: 'booking', reference: result.reference, amountKobo },
        });

        return {
            authorizationUrl: result.authorizationUrl,
            reference: result.reference,
        };
    });

    // POST /payments/webhook — Paystack delivers events here.
    // HMAC-verified against the tenant's stored secret. Rate-limit excluded:
    // Paystack retries aggressively on 5xx + delivery isn't tenant-isolated.
    fastify.post('/webhook', { config: { rateLimit: false } }, async (request, reply) => {
        const rawBody = (request as any).rawBody as Buffer | undefined;
        const signatureHeader = request.headers['x-paystack-signature'];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

        const event = (request.body ?? {}) as PaystackWebhookEvent;
        const tenantId = event.data?.metadata?.tenantId;

        // Always return 200 for unrecognised payloads — don't leak which
        // tenants exist on the platform.
        if (!tenantId || !event.data?.reference) {
            return reply.code(200).send({ ignored: 'missing_metadata' });
        }

        const tenant = await fastify.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, paystackSecretKey: true },
        });
        if (!tenant?.paystackSecretKey) {
            return reply.code(200).send({ ignored: 'unknown_tenant' });
        }

        const secretKey = decrypt(tenant.paystackSecretKey);
        if (!verifyWebhookSignature(rawBody, signature, secretKey)) {
            request.log.warn({ tenantId, hasSignature: !!signature }, 'Paystack webhook signature mismatch');
            throw fastify.httpErrors.unauthorized('Invalid Paystack signature');
        }

        if (event.event !== 'charge.success') {
            return reply.code(200).send({ ignored: `event_${event.event ?? 'unknown'}` });
        }

        const reference = event.data.reference;
        const metaOrderId = event.data.metadata?.orderId;
        const metaBookingId = event.data.metadata?.bookingId;

        // Route by metadata. We DO trust the metadata fields for routing
        // because the webhook signature has already been verified — Paystack
        // returns exactly the metadata we set at initialize-time.
        if (metaBookingId) {
            const booking = await fastify.prisma.booking.findFirst({
                where: { id: metaBookingId, tenantId, paymentReference: reference },
                select: {
                    id: true,
                    bookingReference: true,
                    customerName: true,
                    customerPhone: true,
                    startTime: true,
                    paymentStatus: true,
                    serviceId: true,
                    service: { select: { name: true } },
                },
            });
            if (!booking) {
                return reply.code(200).send({ ignored: 'booking_not_found' });
            }
            if (booking.paymentStatus === 'PAID') {
                return reply.code(200).send({ ok: true, idempotent: true });
            }

            let verified;
            try {
                verified = await verifyTransaction(secretKey, reference);
            } catch (err) {
                request.log.error({ err }, 'Paystack verify failed during webhook (booking)');
                throw fastify.httpErrors.badGateway('Paystack verify failed');
            }
            if (verified.status !== 'success') {
                return reply.code(200).send({ ignored: `status_${verified.status}` });
            }

            // Flip UNPAID → PAID + side effects (template, reminder, calendar,
            // audit). Idempotent — a concurrent delivery gets `applied: false`.
            const { applied } = await fulfillBookingCharge({
                fastify,
                logger: request.log,
                tenantId,
                booking,
                verified,
                reference,
            });
            if (!applied) {
                return reply.code(200).send({ ok: true, idempotent: true });
            }

            return reply.code(200).send({ ok: true, entity: 'booking' });
        }

        // Default path: order. Preserves Phase 3c behaviour exactly.
        if (!metaOrderId) {
            return reply.code(200).send({ ignored: 'no_entity_metadata' });
        }

        const order = await fastify.prisma.order.findFirst({
            where: {
                tenantId,
                paymentReference: reference,
            },
            select: {
                id: true,
                orderRef: true,
                customerPhone: true,
                totalAmount: true,
                paymentStatus: true,
            },
        });
        if (!order) {
            return reply.code(200).send({ ignored: 'order_not_found' });
        }
        if (order.paymentStatus === 'PAID') {
            return reply.code(200).send({ ok: true, idempotent: true });
        }

        let verified;
        try {
            verified = await verifyTransaction(secretKey, reference);
        } catch (err) {
            request.log.error({ err }, 'Paystack verify failed during webhook (order)');
            throw fastify.httpErrors.badGateway('Paystack verify failed');
        }

        if (verified.status !== 'success') {
            return reply.code(200).send({ ignored: `status_${verified.status}` });
        }

        // Flip UNPAID → PAID + side effects (confirmation template, audit).
        // Idempotent — same TOCTOU guard as the booking branch.
        const { applied } = await fulfillOrderCharge({
            fastify,
            tenantId,
            order,
            verified,
            reference,
        });
        if (!applied) {
            return reply.code(200).send({ ok: true, idempotent: true });
        }

        return reply.code(200).send({ ok: true, entity: 'order' });
    });
};

export default paymentsRoutes;
