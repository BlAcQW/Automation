/**
 * Payments for the rides pack: the two payment kinds and their two halves.
 *
 *  PREPARERS (run when the flow asks for a link, before Paystack):
 *    ride_package  hold a Founding slot (HELD pass)   -> entity id = pass id
 *    ride_payg     reserve today's PAYG seat + a PENDING_PAYMENT ride -> entity id = ride id
 *
 *  FULFILLERS (run after the Paystack webhook verified the charge with the
 *  tenant's own key and cross-checked kind + entity + tenant):
 *    ride_package  activate the pass (only here, only on verified money)
 *    ride_payg     confirm the ride
 *  then move the conversation's flow off its payment step (success or failure
 *  branch), or message the customer directly when the chat has moved on.
 *
 * Both fulfillers follow the contract in payment-fulfillers.ts: idempotent per
 * reference, amount checked against the row (never metadata), tenant-scoped,
 * throw only for transient failures. Money that cannot be honoured (late
 * payment and the 50 are gone, already has a package, PAYG full) is recorded on
 * the row, NOT applied, and raises a critical alert + a staff notification so
 * TURBO refunds it from their own Paystack.
 */
import type { FulfillmentInput, FulfillmentOutcome } from '../payment-fulfillers.js';
import { isRegisteredFulfillmentKind, registerPaymentFulfiller } from '../payment-fulfillers.js';
import { hasFlowPaymentPreparer, registerFlowPaymentPreparer, type FlowPaymentPrepareInput, type FlowPaymentPrepared } from '../flow-ports.js';
import { advanceFlowOnPackPayment } from '../flow-payments.js';
import { publishEventOnce } from '../events/emit.js';
import { raiseAlert } from '../alerts.js';
import { createNotification } from '../notifications.js';
import type { RidesClient } from './db.js';
import { getRideSettings } from './settings.js';
import { activatePassOnPayment, holdFoundingSlot, recordPassLink } from './passes.js';
import { confirmPaygOnPayment, recordRideLink, reservePaygRide, setRideStatus } from './rides.js';
import { afterRideRequested, resolveConversationCustomer, sendActivationWelcome } from './operations.js';
import { emitPassActivated, emitRideRequested } from './events.js';
import { notifyRideCustomer } from './notify.js';
import { PAYG_PAYMENT_RECEIVED_TEXT, packageNotActivatedText, paygNotConfirmedText } from './texts.js';
import { tripFromVars } from './trip-vars.js';

export const RIDE_PACKAGE_KIND = 'ride_package';
export const RIDE_PAYG_KIND = 'ride_payg';

const MAX_REFERENCE_LENGTH = 200;

// ---------------------------------------------------------------- preparers

export async function prepareRidePackage(input: FlowPaymentPrepareInput): Promise<FlowPaymentPrepared> {
    const prisma = input.prisma as RidesClient;
    const customer = await resolveConversationCustomer(prisma, input);
    if (!customer) return { ok: false, reason: 'no_customer' };
    const s = await getRideSettings(prisma, input.tenantId);
    if (Math.round(input.amount * 100) !== s.packagePriceMinor || input.currency.toUpperCase() !== s.currency.toUpperCase()) {
        return { ok: false, reason: 'amount_mismatch' };
    }
    const hold = await holdFoundingSlot(prisma, { tenantId: input.tenantId, customerId: customer.id, conversationId: input.conversationId });
    if (!hold.ok) return { ok: false, reason: hold.reason };
    const passId = hold.pass.id;
    return {
        ok: true,
        entityId: passId,
        onCreated: ({ reference }) => recordPassLink(prisma, input.tenantId, passId, reference),
        onFailed: async () => {
            if (hold.reused) return;
            // Free the slot this attempt took: a hold nobody can pay is not a hold.
            await prisma.ridePass.updateMany({
                where: { id: passId, tenantId: input.tenantId, status: 'HELD', paidAt: null },
                data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'payment_link_failed', holdExpiresAt: null },
            });
        },
    };
}

export async function prepareRidePayg(input: FlowPaymentPrepareInput): Promise<FlowPaymentPrepared> {
    const prisma = input.prisma as RidesClient;
    const trip = tripFromVars(input.vars);
    if (!trip) return { ok: false, reason: 'no_trip' };
    const customer = await resolveConversationCustomer(prisma, input);
    if (!customer) return { ok: false, reason: 'no_customer' };
    const reserved = await reservePaygRide(prisma, {
        tenantId: input.tenantId, customerId: customer.id, conversationId: input.conversationId,
        pickup: trip.pickup, destination: trip.destination, expectedFareMinor: Math.round(input.amount * 100),
    });
    if (!reserved.ok) return { ok: false, reason: reserved.reason };
    const rideId = reserved.ride.id;
    return {
        ok: true,
        entityId: rideId,
        onCreated: ({ reference }) => recordRideLink(prisma, input.tenantId, rideId, reference),
        onFailed: async () => {
            if (reserved.reused) return;
            await setRideStatus(prisma, { tenantId: input.tenantId, rideId, status: 'CANCELLED', reason: 'payment_link_failed', by: 'system' });
        },
    };
}

// ---------------------------------------------------------------- fulfillers

function invalid(input: FulfillmentInput): FulfillmentOutcome | null {
    if (!input.reference || input.reference.length > MAX_REFERENCE_LENGTH) return { status: 'rejected', reason: 'reference_invalid' };
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) return { status: 'rejected', reason: 'amount_invalid' };
    if (!/^[A-Za-z]{3}$/.test(input.currency ?? '')) return { status: 'rejected', reason: 'currency_invalid' };
    return null;
}

/** The money fact, once per reference. Throws on a transient failure (Paystack retries). */
async function recordPayment(input: FulfillmentInput, type: 'payment.succeeded' | 'payment.failed', extra: Record<string, unknown>): Promise<void> {
    await publishEventOnce(input.prisma, {
        tenantId: input.tenantId,
        type,
        payload: {
            ...extra,
            paymentId: input.reference, amount: input.amountMinor, currency: input.currency.toUpperCase(), reference: input.reference,
            entityRef: input.entityId,
        },
    }, { field: 'reference', equals: input.reference });
}

async function flowOutcome(input: FulfillmentInput, conversationId: string | null, kind: string, success: boolean) {
    if (!conversationId) return 'not_waiting' as const;
    return advanceFlowOnPackPayment(input, { conversationId, kind, success });
}

async function refuseLoudly(
    input: FulfillmentInput,
    args: { kind: string; what: string; reason: string; context: Record<string, unknown>; fresh: boolean },
): Promise<void> {
    await raiseAlert(input.prisma, {
        kind: `${args.kind}.not_applied`,
        severity: 'critical',
        tenantId: input.tenantId,
        message: `A ${args.what} payment arrived but was not applied (${args.reason}). Refund it from your Paystack dashboard.`,
        context: { reference: input.reference, amount: input.amountMinor, currency: input.currency, reason: args.reason, ...args.context },
        dedupeKey: `${args.kind}.not_applied:${input.tenantId}:${input.reference}`,
    });
    if (!args.fresh) return;
    await createNotification(input.prisma, {
        tenantId: input.tenantId,
        type: 'SYSTEM',
        title: 'Payment needs a refund',
        message: `A ${args.what} payment (${input.reference}) could not be honoured: ${args.reason}. Please refund it.`,
        metadata: { kind: `${args.kind}.refund_due`, reference: input.reference },
    }).catch((err: unknown) => input.log.warn({ err }, 'Refund notification not created'));
}

export async function fulfillRidePackage(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const bad = invalid(input);
    if (bad) return bad;
    const prisma = input.prisma as RidesClient;
    const deps = { prisma, log: input.log };
    const res = await activatePassOnPayment(prisma, {
        tenantId: input.tenantId, passId: input.entityId, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transactionId: input.transactionId, channel: input.channel,
    });
    if (res.outcome === 'not_found') return { status: 'rejected', reason: 'pass_not_found' };
    const { pass } = res;
    const facts = { passId: pass.id, conversationId: pass.conversationId };

    switch (res.outcome) {
        case 'underpaid':
            await recordPayment(input, 'payment.failed', { ...facts, reason: 'underpaid' });
            await refuseLoudly(input, { kind: RIDE_PACKAGE_KIND, what: 'Founding Package', reason: 'underpaid', context: { passId: pass.id, customerId: pass.customerId, owedMinor: pass.priceMinor }, fresh: true });
            await flowOutcome(input, pass.conversationId, RIDE_PACKAGE_KIND, false);
            return { status: 'rejected', reason: 'amount_insufficient' };
        case 'activated':
        case 'already_activated': {
            // Everything that must happen once is done BEFORE the flow is moved: a lost flow-state write throws (Paystack
            // retries), and the retry sees already_activated. The event is once-per-pass, so it is safe to repeat.
            await recordPayment(input, 'payment.succeeded', facts);
            await emitPassActivated(prisma, pass);
            const flow = await flowOutcome(input, pass.conversationId, RIDE_PACKAGE_KIND, true);
            if (res.outcome === 'already_activated') return { status: 'already_applied' };
            if (flow === 'not_waiting') await sendActivationWelcome(deps, pass);
            return { status: 'applied' };
        }
        case 'refused':
        case 'already_refused': {
            await recordPayment(input, 'payment.succeeded', facts);
            const fresh = res.outcome === 'refused';
            await refuseLoudly(input, { kind: RIDE_PACKAGE_KIND, what: 'Founding Package', reason: res.reason, context: { passId: pass.id, customerId: pass.customerId }, fresh });
            const flow = await flowOutcome(input, pass.conversationId, RIDE_PACKAGE_KIND, false);
            if (fresh && flow === 'not_waiting') {
                await notifyRideCustomer(deps, {
                    tenantId: input.tenantId, customerId: pass.customerId, conversationId: pass.conversationId,
                    kind: 'ride_pass.not_activated', text: packageNotActivatedText(res.reason), emailSubject: 'About your TURBO payment',
                });
            }
            return { status: 'rejected', reason: `not_activated:${res.reason}` };
        }
    }
}

export async function fulfillRidePayg(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const bad = invalid(input);
    if (bad) return bad;
    const prisma = input.prisma as RidesClient;
    const deps = { prisma, log: input.log };
    const res = await confirmPaygOnPayment(prisma, {
        tenantId: input.tenantId, rideId: input.entityId, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transactionId: input.transactionId, channel: input.channel,
    });
    if (res.outcome === 'not_found') return { status: 'rejected', reason: 'ride_not_found' };
    const { ride } = res;
    const facts = { rideId: ride.id, conversationId: ride.conversationId };

    switch (res.outcome) {
        case 'underpaid':
            await recordPayment(input, 'payment.failed', { ...facts, reason: 'underpaid' });
            await refuseLoudly(input, { kind: RIDE_PAYG_KIND, what: 'PAYG ride', reason: 'underpaid', context: { rideId: ride.id, customerId: ride.customerId, owedMinor: ride.fareMinor }, fresh: true });
            await flowOutcome(input, ride.conversationId, RIDE_PAYG_KIND, false);
            return { status: 'rejected', reason: 'amount_insufficient' };
        case 'confirmed':
        case 'already_confirmed': {
            await recordPayment(input, 'payment.succeeded', facts);
            // Once-only follow-up before the flow moves (see fulfillRidePackage). On a redelivery only the
            // once-per-ride event is repeated, never the staff notice.
            if (res.outcome === 'confirmed') await afterRideRequested(deps, ride);
            else await emitRideRequested(prisma, ride);
            const flow = await flowOutcome(input, ride.conversationId, RIDE_PAYG_KIND, true);
            if (res.outcome === 'already_confirmed') return { status: 'already_applied' };
            if (flow === 'not_waiting') {
                await notifyRideCustomer(deps, {
                    tenantId: input.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
                    kind: 'ride_payg.paid', text: PAYG_PAYMENT_RECEIVED_TEXT, emailSubject: 'Your TURBO ride is confirmed',
                });
            }
            return { status: 'applied' };
        }
        case 'refused':
        case 'already_refused': {
            await recordPayment(input, 'payment.succeeded', facts);
            const fresh = res.outcome === 'refused';
            await refuseLoudly(input, { kind: RIDE_PAYG_KIND, what: 'PAYG ride', reason: res.reason, context: { rideId: ride.id, customerId: ride.customerId }, fresh });
            const flow = await flowOutcome(input, ride.conversationId, RIDE_PAYG_KIND, false);
            if (fresh && flow === 'not_waiting') {
                await notifyRideCustomer(deps, {
                    tenantId: input.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
                    kind: 'ride_payg.not_confirmed', text: paygNotConfirmedText(), emailSubject: 'About your TURBO payment',
                });
            }
            return { status: 'rejected', reason: `not_confirmed:${res.reason}` };
        }
    }
}

/** Safe to call more than once. */
export function registerRidePayments(): void {
    if (!isRegisteredFulfillmentKind(RIDE_PACKAGE_KIND)) registerPaymentFulfiller(RIDE_PACKAGE_KIND, fulfillRidePackage);
    if (!isRegisteredFulfillmentKind(RIDE_PAYG_KIND)) registerPaymentFulfiller(RIDE_PAYG_KIND, fulfillRidePayg);
    if (!hasFlowPaymentPreparer(RIDE_PACKAGE_KIND)) registerFlowPaymentPreparer(RIDE_PACKAGE_KIND, prepareRidePackage);
    if (!hasFlowPaymentPreparer(RIDE_PAYG_KIND)) registerFlowPaymentPreparer(RIDE_PAYG_KIND, prepareRidePayg);
}
