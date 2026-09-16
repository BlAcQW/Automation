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
    if (!args.paystackSecretKeyEncrypted) return null;

    try {
        const secretKey = decrypt(args.paystackSecretKeyEncrypted);
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
            reference: `bf_${args.id}_${Date.now()}`,
            callbackUrl,
            metadata: {
                tenantId: args.tenantId,
                ...(args.entity === 'order' ? { orderId: args.id } : { bookingId: args.id }),
                customerPhone: args.customerPhone,
            },
        });

        const data = { paymentReference: init.reference, paymentAuthorizationUrl: init.authorizationUrl };
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
