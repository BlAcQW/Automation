import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../services/crypto.js';
import { audit } from '../../services/audit.js';
import { fulfillBookingCharge, fulfillOrderCharge } from '../../services/payment-fulfillment.js';
import { dispatchFulfillment } from '../../services/payment-fulfillers.js';
import { markPayoutFailed, markPayoutPaid } from '../../services/payout-transfer.js';
import { raiseAlert } from '../../services/alerts.js';
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

export type KeyValidation =
    | { ok: true; secretKey: string; publicKey: string }
    | { ok: false; message: string };

const LIVE_SECRET_KEY = /^sk_live_[A-Za-z0-9]+$/;
const LIVE_PUBLIC_KEY = /^pk_live_[A-Za-z0-9]+$/;

/**
 * Live-money guard. In production a key pair must positively look live — an
 * allowlist, not a denylist, so restricted test keys (rk_test_), odd casing
 * and malformed strings cannot slip through. A test key would otherwise let
 * Paystack test cards "pay" for real bookings.
 *
 * Returns the keys trimmed, so what is stored is exactly what was checked.
 */
export function validatePaystackKeysForEnv(
    secretKeyRaw: string,
    publicKeyRaw: string,
    nodeEnv: string | undefined,
): KeyValidation {
    const secretKey = secretKeyRaw.trim();
    const publicKey = publicKeyRaw.trim();
    if (nodeEnv === 'production') {
        if (!LIVE_SECRET_KEY.test(secretKey)) {
            return {
                ok: false,
                message: secretKey.toLowerCase().includes('test')
                    ? 'This is a Paystack TEST secret key. Use your LIVE secret key (sk_live_...) to accept real payments.'
                    : 'That does not look like a Paystack live secret key. It should start with sk_live_.',
            };
        }
        if (!LIVE_PUBLIC_KEY.test(publicKey)) {
            return {
                ok: false,
                message: 'Use your LIVE public key (pk_live_...) together with the live secret key.',
            };
        }
    }
    return { ok: true, secretKey, publicKey };
}

export interface UnattributedChargeInput {
    reference: string;
    tenantId: string;
    amount?: number | null;
    currency?: string | null;
}

/**
 * Real Paystack references are short; a tenant holding its own key can sign a
 * webhook with any reference it likes, so bound what reaches logs and audit.
 */
export const MAX_LOGGED_REFERENCE_LENGTH = 100;
const MAX_LOGGED_CURRENCY_LENGTH = 8;

/** Shape the log line and audit entry for a verified charge we could not attribute. */
export function buildUnattributedChargeReport(reason: string, input: UnattributedChargeInput) {
    const amountMinor =
        typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null;
    const currency =
        typeof input.currency === 'string' ? input.currency.slice(0, MAX_LOGGED_CURRENCY_LENGTH) : null;
    const reference = String(input.reference).slice(0, MAX_LOGGED_REFERENCE_LENGTH);
    const base = { reference, tenantId: input.tenantId, amountMinor, currency, reason };
    return { auditAction: 'payment.unattributed', targetId: reference, log: base, metadata: base };
}

interface PaystackWebhookEvent {
    event?: string;
    data?: {
        reference?: string;
        /** Minor units, as Paystack reports them. */
        amount?: number;
        currency?: string;
        metadata?: {
            tenantId?: string;
            orderId?: string;
            bookingId?: string;
            customerPhone?: string;
            /** Vertical-specific purchases; see services/payment-fulfillers.ts. */
            fulfillmentKind?: unknown;
            entityId?: unknown;
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
    /**
     * A signature-verified charge that matches nothing of ours: money arrived
     * and nothing is attributed. Still 200 (Paystack must not retry forever),
     * but loud — error log plus an audit row a human can find.
     */
    async function reportUnattributed(
        log: { error: (obj: object, msg: string) => void },
        reason: string,
        input: UnattributedChargeInput,
    ): Promise<void> {
        const report = buildUnattributedChargeReport(reason, input);
        log.error(report.log, 'Verified Paystack charge could not be attributed to a booking or order');
        await audit({
            prisma: fastify.prisma,
            action: report.auditAction,
            actorType: 'SYSTEM',
            tenantId: input.tenantId,
            targetType: 'PaystackCharge',
            targetId: report.targetId,
            metadata: report.metadata,
        });
        await raiseAlert(fastify.prisma, {
            kind: 'payment.unattributed',
            severity: 'critical',
            tenantId: input.tenantId,
            message: `Verified Paystack charge could not be attributed (${reason}).`,
            context: { reference: input.reference, reason, amount: input.amount, currency: input.currency },
            // Tenant in the key: two tenants' charges sharing a reference stay separate.
            dedupeKey: `payment.unattributed:${input.tenantId}:${String(input.reference)}`,
        });
    }

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

        const keyCheck = validatePaystackKeysForEnv(body.secretKey, body.publicKey, config.nodeEnv);
        if (!keyCheck.ok) {
            throw fastify.httpErrors.badRequest(keyCheck.message);
        }
        const { secretKey, publicKey } = keyCheck;

        // Probe the key — Paystack accepts any string in Authorization but
        // returns 401 from /transaction/totals on an invalid key.
        try {
            const probeRes = await fetch('https://api.paystack.co/transaction/totals', {
                headers: { Authorization: `Bearer ${secretKey}` },
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
                paystackPublicKey: publicKey,
                paystackSecretKey: encrypt(secretKey),
                paymentCurrency: body.currency,
            },
        });

        await audit({
            prisma: fastify.prisma,
            action: 'payments.connected',
            actorType: 'USER',
            actorId: request.user.userId,
            tenantId: request.user.tenantId,
            metadata: { currency: body.currency, publicKeyPrefix: publicKey.slice(0, 12) },
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

        await fastify.prisma.order.updateMany({
            where: { id: order.id, tenantId },
            data: {
                paymentReference: result.reference,
                paymentAuthorizationUrl: result.authorizationUrl,
                // This handler always initialises on the TENANT's own key, so
                // the money never reaches Bookly's balance and must never
                // credit a wallet.
                collectionRoute: 'OWN_GATEWAY',
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

        await fastify.prisma.booking.updateMany({
            where: { id: booking.id, tenantId },
            data: {
                paymentReference: result.reference,
                paymentAuthorizationUrl: result.authorizationUrl,
                // This handler always initialises on the TENANT's own key, so
                // the money never reaches Bookly's balance and must never
                // credit a wallet.
                collectionRoute: 'OWN_GATEWAY',
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

        // Paystack signs with the key of the account the event belongs to,
        // and Bookly now has two. Transfers are always ours; a charge depends
        // on where it was collected. Picking the wrong key rejects a genuine
        // event — and a rejected charge means a customer paid and nobody was
        // told.
        // NOTE: the route is read from the DB row below, never from the body.
        // A tenant with their own Paystack key controls the reference and the
        // metadata, so letting either choose the verifying key would let them
        // sign a fabricated payment with their own key and have Bookly credit
        // it.

        // ---- Transfers: payouts leaving Bookly's balance -------------------
        if (event.event?.startsWith('transfer.')) {
            const platformSecret = config.platformPaystack?.secretKey;
            if (!platformSecret || !verifyWebhookSignature(rawBody, signature, platformSecret)) {
                request.log.warn({ event: event.event }, 'Transfer webhook signature mismatch');
                throw fastify.httpErrors.unauthorized('Invalid Paystack signature');
            }

            // Our payout id, set as the transfer reference when we started it.
            const payoutId = (event.data as { reference?: string } | undefined)?.reference;
            if (!payoutId) return reply.code(200).send({ ignored: 'missing_reference' });

            if (event.event === 'transfer.success') {
                await markPayoutPaid({ prisma: fastify.prisma, payoutId, logger: request.log });
            } else {
                // failed OR reversed — either way the money goes back so the
                // owner can try again.
                await markPayoutFailed({
                    prisma: fastify.prisma,
                    payoutId,
                    failureReason: 'The transfer did not go through. Check your Mobile Money number and try again.',
                    logger: request.log,
                });
            }
            return reply.code(200).send({ ok: true });
        }

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
        if (!tenant) {
            return reply.code(200).send({ ignored: 'unknown_tenant' });
        }

        // Which account collected this, as recorded when the link was made.
        // Read-only lookup before any verification, so the key is chosen by
        // our own data rather than by the sender.
        const reference0 = event.data.reference;
        const [bookingRow, orderRow] = await Promise.all([
            fastify.prisma.booking.findFirst({
                where: { tenantId, paymentReference: reference0 },
                select: { collectionRoute: true },
            }),
            fastify.prisma.order.findFirst({
                where: { tenantId, paymentReference: reference0 },
                select: { collectionRoute: true },
            }),
        ]);
        const storedRoute = bookingRow?.collectionRoute ?? orderRow?.collectionRoute ?? null;

        const secretKey =
            storedRoute === 'PLATFORM'
                ? config.platformPaystack?.secretKey
                : tenant.paystackSecretKey
                    ? decrypt(tenant.paystackSecretKey)
                    : undefined;

        if (!secretKey) {
            return reply.code(200).send({ ignored: 'no_verifying_key' });
        }

        if (!verifyWebhookSignature(rawBody, signature, secretKey)) {
            request.log.warn({ tenantId, storedRoute, hasSignature: !!signature }, 'Paystack webhook signature mismatch');
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
                    // Needed to check the customer actually paid what was
                    // asked before the slot is confirmed and the salon credited.
                    depositAmount: true,
                    collectionRoute: true,
                    service: { select: { name: true } },
                },
            });
            if (!booking) {
                await reportUnattributed(request.log, 'booking_not_found', { reference, tenantId, amount: event.data.amount, currency: event.data.currency });
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

        // Registered fulfillers (rides etc.). Only reached when the charge
        // names neither a booking nor an order, so the built-in paths above
        // and below are untouched. The key was already chosen from the stored
        // collectionRoute; these payments never have a stored row, so they
        // verify against the tenant's OWN key and never reach the ledger.
        if (!metaOrderId && event.data.metadata?.fulfillmentKind !== undefined) {
            const result = await dispatchFulfillment({
                prisma: fastify.prisma,
                tenantId,
                reference,
                metadata: event.data.metadata as Record<string, unknown>,
                log: request.log,
                verify: async () => {
                    try {
                        return await verifyTransaction(secretKey, reference);
                    } catch (err) {
                        request.log.error({ err }, 'Paystack verify failed during webhook (fulfillment)');
                        throw fastify.httpErrors.badGateway('Paystack verify failed');
                    }
                },
            });
            if (result.unattributedReason) {
                await reportUnattributed(request.log, result.unattributedReason, {
                    reference,
                    tenantId,
                    amount: result.amountMinor ?? event.data.amount,
                    currency: result.currency ?? event.data.currency,
                });
            }
            return reply.code(200).send(result.body);
        }

        // Default path: order. Preserves Phase 3c behaviour exactly.
        if (!metaOrderId) {
            await reportUnattributed(request.log, 'no_entity_metadata', { reference, tenantId, amount: event.data.amount, currency: event.data.currency });
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
            await reportUnattributed(request.log, 'order_not_found', { reference, tenantId, amount: event.data.amount, currency: event.data.currency });
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
