/**
 * Paystack payment link for a deposit or an order.
 *
 * Lifted out of WhatsAppBotEngine so the LLM agent can take a deposit the
 * same way the menu bot does. Before this, a deposit-bearing service booked
 * through the agent sat in PENDING_PAYMENT with nothing to pay.
 *
 * Best-effort by contract: returns null rather than throwing, and the caller
 * falls back to a "team will send the link" message. Staff can re-trigger
 * from the dashboard. Every side effect here (reference format, placeholder
 * email, metadata shape, the update on the row) is what the bot already did.
 */

import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { decrypt } from './crypto.js';
import { initializeTransaction } from './paystack.js';
import { resolveCollectionRoute } from './collection-route.js';
import { isRegisteredFulfillmentKind } from './payment-fulfillers.js';
import { scoped } from '../lib/logger.js';

const log = scoped('payment-link');

export interface PaymentLinkArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    /** Tenant.paystackSecretKey as stored (encrypted); null if not connected. */
    paystackSecretKeyEncrypted: string | null;
    currency: string;
    entity: 'order' | 'booking';
    id: string;
    /** Major unit, e.g. 25.00 GHS. */
    amount: number;
    customerPhone: string;
}

export async function createPaymentLink(args: PaymentLinkArgs): Promise<string | null> {
    // Default to Bookly's own Paystack so a tenant never has to create a
    // gateway account. Tenants who already connected their own keep using it.
    const route = resolveCollectionRoute(
        { tenantSecretKeyEncrypted: args.paystackSecretKeyEncrypted },
        config.platformPaystack?.secretKey,
    );
    if (!route) {
        log.warn({ tenantId: args.tenantId }, 'No Paystack account available to collect payment');
        return null;
    }

    try {
        const secretKey = route.secretKey;
        const digits = args.customerPhone.replace(/[^0-9]/g, '');
        const callbackUrl =
            config.paystack.callbackUrl ??
            (config.frontendUrl ? `${config.frontendUrl}/orders/paid` : undefined);

        const init = await initializeTransaction({
            secretKey,
            // Paystack rejects reserved TLDs like `.local` — use a real public
            // TLD for this placeholder (the customer never sees it).
            email: `${digits || 'customer'}@customer.bookingflow.app`,
            amountKobo: Math.round(args.amount * 100),
            currency: args.currency,
            // The route is carried on the reference AND the metadata. The
            // webhook needs to know whether this money landed in our balance
            // before it credits anyone's wallet, and metadata alone can be
            // absent on some provider replays.
            reference: `bf_${route.route === 'PLATFORM' ? 'p' : 'o'}_${args.id}_${Date.now()}`,
            callbackUrl,
            metadata: {
                tenantId: args.tenantId,
                collectionRoute: route.route,
                ...(args.entity === 'order' ? { orderId: args.id } : { bookingId: args.id }),
                customerPhone: args.customerPhone,
            },
        });

        // Record WHICH account collected this, server-side. The reference
        // prefix and the provider metadata are both attacker-controlled once a
        // tenant connects their own key, so neither may ever be the source of
        // truth for whether money reached Bookly.
        const data = {
            paymentReference: init.reference,
            paymentAuthorizationUrl: init.authorizationUrl,
            collectionRoute: route.route,
        };
        if (args.entity === 'order') {
            await args.prisma.order.update({ where: { id: args.id }, data });
        } else {
            await args.prisma.booking.update({ where: { id: args.id }, data });
        }

        return init.authorizationUrl;
    } catch (err) {
        log.error({ err, entity: args.entity, id: args.id }, 'Paystack init failed');
        return null;
    }
}

export interface FulfillmentPaymentLinkArgs {
    tenantId: string;
    /** Tenant.paystackSecretKey as stored (encrypted); null if not connected. */
    paystackSecretKeyEncrypted: string | null;
    currency: string;
    /** A kind registered via registerPaymentFulfiller (never 'booking'/'order'). */
    kind: string;
    /** The caller's own entity id (e.g. a ride package purchase). */
    entityId: string;
    /** Major unit, e.g. 25.00 GHS. */
    amount: number;
    customerPhone: string;
    /**
     * Where Paystack returns the customer after paying — e.g. a wa.me link
     * back into the WhatsApp chat. Falls back to PAYSTACK_CALLBACK_URL, then
     * to Paystack's dashboard default. Deliberately never the orders page.
     */
    callbackUrl?: string;
    /**
     * REQUIRED persistence hook. The new entity lives outside this service, so
     * the caller must save `reference` and `authorizationUrl` on it (and
     * `collectionRoute` if its table has such a column). Awaited; if it throws
     * no link is returned. Persisting the route is informational only: the
     * webhook finds no booking/order row for these charges and therefore
     * verifies them with the tenant's own key, which is why this function
     * refuses to collect on the platform account.
     */
    onCreated: (link: {
        reference: string;
        authorizationUrl: string;
        collectionRoute: 'OWN_GATEWAY';
    }) => Promise<void> | void;
}

/**
 * Payment link for a registered fulfillment kind (rides, etc.).
 *
 * Writes `fulfillmentKind` + `entityId` + `tenantId` into the Paystack
 * metadata; the webhook dispatches on them (services/payment-fulfillers.ts).
 *
 * OWN_GATEWAY ONLY. Unlike bookings/orders there is no stored row whose
 * `collectionRoute` the webhook can read before choosing the verifying key; it
 * falls back to the tenant's key. A PLATFORM-collected charge would therefore
 * fail signature verification, and would also have no ledger handling. So with
 * no usable tenant key this returns null (best-effort contract, like
 * createPaymentLink) instead of falling back to the platform account.
 */
export async function createFulfillmentPaymentLink(args: FulfillmentPaymentLinkArgs): Promise<string | null> {
    if (!isRegisteredFulfillmentKind(args.kind)) {
        log.error({ kind: args.kind, tenantId: args.tenantId }, 'Refusing payment link for unregistered fulfillment kind');
        return null;
    }
    if (!Number.isFinite(args.amount) || Math.round(args.amount * 100) <= 0) {
        log.error({ kind: args.kind, tenantId: args.tenantId }, 'Refusing payment link with non-positive amount');
        return null;
    }

    // Platform key deliberately omitted: own gateway or nothing.
    const route = resolveCollectionRoute({ tenantSecretKeyEncrypted: args.paystackSecretKeyEncrypted }, undefined);
    if (!route) {
        log.warn({ tenantId: args.tenantId, kind: args.kind }, 'No tenant Paystack key available for fulfillment payment');
        return null;
    }

    try {
        const digits = args.customerPhone.replace(/[^0-9]/g, '');
        const callbackUrl = args.callbackUrl ?? config.paystack.callbackUrl ?? undefined;

        const init = await initializeTransaction({
            secretKey: route.secretKey,
            email: `${digits || 'customer'}@customer.bookingflow.app`,
            amountKobo: Math.round(args.amount * 100),
            currency: args.currency,
            // bf_f_ = fulfillment, distinct from order (bf_o_) references.
            reference: `bf_f_${args.kind}_${args.entityId}_${Date.now()}`,
            callbackUrl,
            metadata: {
                tenantId: args.tenantId,
                collectionRoute: route.route,
                fulfillmentKind: args.kind,
                entityId: args.entityId,
                customerPhone: args.customerPhone,
            },
        });

        await args.onCreated({
            reference: init.reference,
            authorizationUrl: init.authorizationUrl,
            collectionRoute: 'OWN_GATEWAY',
        });

        return init.authorizationUrl;
    } catch (err) {
        log.error({ err, kind: args.kind, entityId: args.entityId }, 'Fulfillment payment link failed');
        return null;
    }
}
