/**
 * Public, no-login customer self-service endpoints.
 *
 * These are reached from tokenized links in SMS / WhatsApp messages:
 *   - GET  /public/track/:token   — order tracking page data
 *   - GET  /public/cancel/:token  — booking summary for the cancel page
 *   - POST /public/cancel/:token  — actually cancel the booking
 *
 * No `fastify.authenticate` preHandler — the non-guessable `publicToken`
 * (96 bits of entropy) IS the credential. Rate-limited by IP since there's
 * no tenant/user context.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cancelBooking } from '../../services/booking-cancel.js';
import { audit } from '../../services/audit.js';
import { decrypt } from '../../services/crypto.js';
import { verifyTransaction, PaystackError } from '../../services/paystack.js';
import { fulfillBookingCharge, fulfillOrderCharge } from '../../services/payment-fulfillment.js';

const ipRateLimit = {
    rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (req: { ip: string }) => `${req.ip}:public`,
    },
};

const verifyQuerySchema = z.object({
    reference: z.string().min(1).max(200),
});

const publicRoutes: FastifyPluginAsync = async (fastify) => {
    // GET /public/track/:token — order status for the tracking page.
    fastify.get('/track/:token', { config: ipRateLimit }, async (request, reply) => {
        const { token } = request.params as { token: string };

        const order = await fastify.prisma.order.findUnique({
            where: { publicToken: token },
            select: {
                orderRef: true,
                status: true,
                paymentStatus: true,
                totalAmount: true,
                createdAt: true,
                updatedAt: true,
                tenant: { select: { name: true } },
                items: {
                    select: {
                        quantity: true,
                        unitPrice: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });

        if (!order) {
            return reply.code(404).send({ error: 'Order not found' });
        }

        // Sanitized payload — no customer phone/email, no delivery address.
        return {
            orderRef: order.orderRef,
            status: order.status,
            paymentStatus: order.paymentStatus,
            totalAmount: Number(order.totalAmount),
            businessName: order.tenant.name,
            placedAt: order.createdAt,
            updatedAt: order.updatedAt,
            items: order.items.map((it) => ({
                name: it.product.name,
                quantity: it.quantity,
                unitPrice: Number(it.unitPrice),
            })),
        };
    });

    // GET /public/cancel/:token — booking summary so the cancel page can
    // show the customer what they're about to cancel.
    fastify.get('/cancel/:token', { config: ipRateLimit }, async (request, reply) => {
        const { token } = request.params as { token: string };

        const booking = await fastify.prisma.booking.findUnique({
            where: { publicToken: token },
            select: {
                bookingReference: true,
                status: true,
                startTime: true,
                endTime: true,
                service: { select: { name: true } },
                tenant: { select: { name: true } },
            },
        });

        if (!booking) {
            return reply.code(404).send({ error: 'Booking not found' });
        }

        return {
            bookingReference: booking.bookingReference,
            status: booking.status,
            serviceName: booking.service.name,
            businessName: booking.tenant.name,
            startTime: booking.startTime,
            endTime: booking.endTime,
            cancellable: booking.status === 'CONFIRMED',
        };
    });

    // POST /public/cancel/:token — cancel the booking behind the token.
    fastify.post('/cancel/:token', { config: ipRateLimit }, async (request, reply) => {
        const { token } = request.params as { token: string };

        const booking = await fastify.prisma.booking.findUnique({
            where: { publicToken: token },
            select: { id: true, tenantId: true },
        });

        if (!booking) {
            return reply.code(404).send({ error: 'Booking not found' });
        }

        const result = await cancelBooking({
            prisma: fastify.prisma,
            bookingId: booking.id,
            reason: 'customer_sms_link',
            notificationsQueue: fastify.queues.notifications,
            remindersQueue: fastify.queues.reminders,
        });

        await audit({
            prisma: fastify.prisma,
            action: 'booking.cancelled.public',
            actorType: 'SYSTEM',
            tenantId: booking.tenantId,
            targetType: 'Booking',
            targetId: booking.id,
            metadata: { via: 'sms_cancel_link', outcome: result.ok ? 'cancelled' : result.reason },
            ipAddress: request.ip,
        });

        if (!result.ok) {
            return reply.send({
                ok: false,
                alreadyCancelled: result.reason === 'already_cancelled',
                reason: result.reason,
            });
        }

        return {
            ok: true,
            bookingReference: result.booking.bookingReference,
            serviceName: result.booking.serviceName,
        };
    });

    // GET /public/payments/verify?reference=... — verify-on-return fallback.
    //
    // Paystack redirects the customer here (via `/pay/order` | `/pay/booking`)
    // after they pay. The webhook is the primary path; this is the backstop
    // for when a tenant hasn't configured their webhook URL or the API was
    // briefly unreachable. Verifying the transaction directly with Paystack
    // IS the proof of payment — so this can be public: a random reference
    // 404s, and a real reference only ever flips a row to PAID when Paystack
    // independently confirms the money arrived.
    fastify.get('/payments/verify', { config: ipRateLimit }, async (request, reply) => {
        const parsed = verifyQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'reference is required' });
        }
        const { reference } = parsed.data;

        // `paymentReference` is unique across each table — find which entity
        // this reference belongs to.
        const order = await fastify.prisma.order.findUnique({
            where: { paymentReference: reference },
            select: {
                id: true,
                tenantId: true,
                orderRef: true,
                customerPhone: true,
                totalAmount: true,
                paymentStatus: true,
                publicToken: true,
                tenant: {
                    select: { name: true, paystackSecretKey: true, paymentCurrency: true },
                },
            },
        });

        const booking = order
            ? null
            : await fastify.prisma.booking.findUnique({
                  where: { paymentReference: reference },
                  select: {
                      id: true,
                      tenantId: true,
                      bookingReference: true,
                      customerName: true,
                      customerPhone: true,
                      startTime: true,
                      serviceId: true,
                      depositAmount: true,
                      paymentStatus: true,
                      service: { select: { name: true } },
                      tenant: {
                          select: { name: true, paystackSecretKey: true, paymentCurrency: true },
                      },
                  },
              });

        if (!order && !booking) {
            return reply.code(404).send({ error: 'Payment not found' });
        }

        const tenant = (order ?? booking)!.tenant;
        if (!tenant.paystackSecretKey) {
            return reply.code(409).send({ error: 'payments_not_configured' });
        }

        // Already PAID — idempotent short-circuit, no Paystack call needed.
        if (order && order.paymentStatus === 'PAID') {
            return {
                status: 'PAID',
                kind: 'order',
                ref: order.orderRef,
                amount: Number(order.totalAmount),
                currency: tenant.paymentCurrency,
                businessName: tenant.name,
                trackToken: order.publicToken,
            };
        }
        if (booking && booking.paymentStatus === 'PAID') {
            return {
                status: 'PAID',
                kind: 'booking',
                ref: booking.bookingReference,
                amount: booking.depositAmount ? Number(booking.depositAmount) : null,
                currency: tenant.paymentCurrency,
                businessName: tenant.name,
                startTime: booking.startTime,
            };
        }

        let verified;
        try {
            verified = await verifyTransaction(decrypt(tenant.paystackSecretKey), reference);
        } catch (err) {
            request.log.error({ err, reference }, 'Paystack verify failed (public verify)');
            if (err instanceof PaystackError) {
                return reply.code(502).send({ error: 'paystack_verify_failed' });
            }
            throw err;
        }

        if (verified.status === 'pending') {
            return { status: 'PENDING' };
        }
        if (verified.status !== 'success') {
            return { status: 'FAILED' };
        }

        if (order) {
            await fulfillOrderCharge({
                fastify,
                tenantId: order.tenantId,
                order,
                verified,
                reference,
            });
            return {
                status: 'PAID',
                kind: 'order',
                ref: order.orderRef,
                amount: Number(order.totalAmount),
                currency: tenant.paymentCurrency,
                businessName: tenant.name,
                trackToken: order.publicToken,
            };
        }

        await fulfillBookingCharge({
            fastify,
            logger: request.log,
            tenantId: booking!.tenantId,
            booking: booking!,
            verified,
            reference,
        });
        return {
            status: 'PAID',
            kind: 'booking',
            ref: booking!.bookingReference,
            amount: booking!.depositAmount ? Number(booking!.depositAmount) : null,
            currency: tenant.paymentCurrency,
            businessName: tenant.name,
            startTime: booking!.startTime,
        };
    });
};

export default publicRoutes;
