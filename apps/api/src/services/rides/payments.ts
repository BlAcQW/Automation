/**
 * Payments for the rides pack: the three payment kinds and their two halves.
 *
 *  PREPARERS (run when the flow asks for a link, before Paystack):
 *    ride_package  hold a Founding slot (HELD pass)   -> entity id = pass id
 *    ride_payg     reserve today's PAYG seat + a PENDING_PAYMENT ride -> entity id = ride id
 *    ride_topup    a package ride the balance does not cover: hold the whole remaining
 *                  balance on a PENDING_PAYMENT package ride; the link charges the
 *                  difference (topupMinor) -> entity id = ride id
 *
 *  FULFILLERS (run after the Paystack webhook verified the charge with the
 *  tenant's own key and cross-checked kind + entity + tenant):
 *    ride_package  activate the pass (only here, only on verified money)
 *    ride_payg     confirm the ride
 *    ride_topup    confirm the package ride (amount checked against topupMinor)
 *  then move the conversation's flow off its payment step (success or failure
 *  branch), or message the customer directly when the chat has moved on.
 *
 * Both fulfillers follow the contract in payment-fulfillers.ts: idempotent per
 * reference, amount checked against the row (never metadata), tenant-scoped,
 * throw only for transient failures. Money that cannot be honoured (late
 * payment and the 50 are gone, already has a package, PAYG full) is recorded on
 * the row, NOT applied, and raises a critical alert + a staff notification so
 * TURBO refunds it from their own gateway (Paystack or Payaza: the alert names
 * the one that took the money, input.provider).
 *
 * OWNERS. Each kind also registers an owner resolver (the tenant of a pass /
 * ride, by id). The Payaza webhook uses it to pick the verifying key from OUR
 * row, since Payaza's payload carries nothing trustworthy about the tenant.
 */
import type { FulfillmentInput, FulfillmentOutcome } from '../payment-fulfillers.js';
import { hasFulfillmentOwner, isRegisteredFulfillmentKind, registerFulfillmentOwner, registerPaymentFulfiller } from '../payment-fulfillers.js';
import { hasFlowPaymentPreparer, registerFlowPaymentPreparer, type FlowPaymentPrepareInput, type FlowPaymentPrepared } from '../flow-ports.js';
import { advanceFlowOnPackPayment, endIdleFlowAfterPayment } from '../flow-payments.js';
import { publishEventOnce } from '../events/emit.js';
import { raiseAlert } from '../alerts.js';
import { createNotification } from '../notifications.js';
import type { RidesClient } from './db.js';
import { getRideSettings } from './settings.js';
import { AMOUNT_TOLERANCE_MINOR, activatePassOnPayment, holdFoundingSlot, recordPassLink } from './passes.js';
import { confirmPaygOnPayment, confirmTopupOnPayment, recordRideLink, reservePaygRide, reserveTopupRide, setRideStatus } from './rides.js';
import { afterRideRequested, resolveConversationCustomer, sendActivationWelcome } from './operations.js';
import { emitPassActivated, emitRideRequested } from './events.js';
import { notifyRideCustomer } from './notify.js';
import { PAYG_PAYMENT_RECEIVED_TEXT, money, packageNotActivatedText, paygNotConfirmedText, refundSourceText, topupNotConfirmedText, topupReceivedText } from './texts.js';
import { toMinor } from './geo.js';
import { tripFromVars } from './trip-vars.js';

export const RIDE_PACKAGE_KIND = 'ride_package';
export const RIDE_PAYG_KIND = 'ride_payg';
export const RIDE_TOPUP_KIND = 'ride_topup';

const MAX_REFERENCE_LENGTH = 200;

// ---------------------------------------------------------------- preparers

/** The business's thank-you page for this kind (ride settings), when set: the payment page returns there. */
function returnUrl(url: string | null | undefined): { returnUrl?: string } {
    return url ? { returnUrl: url } : {};
}

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
        ...returnUrl(s.packageThanksUrl),
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
    const s = await getRideSettings(prisma, input.tenantId);
    return {
        ok: true,
        entityId: rideId,
        ...returnUrl(s.rideThanksUrl),
        onCreated: ({ reference }) => recordRideLink(prisma, input.tenantId, rideId, reference),
        onFailed: async () => {
            if (reserved.reused) return;
            await setRideStatus(prisma, { tenantId: input.tenantId, rideId, status: 'CANCELLED', reason: 'payment_link_failed', by: 'system' });
        },
    };
}

export async function prepareRideTopup(input: FlowPaymentPrepareInput): Promise<FlowPaymentPrepared> {
    const prisma = input.prisma as RidesClient;
    const trip = tripFromVars(input.vars);
    if (!trip) return { ok: false, reason: 'no_trip' };
    const customer = await resolveConversationCustomer(prisma, input);
    if (!customer) return { ok: false, reason: 'no_customer' };
    const s = await getRideSettings(prisma, input.tenantId);
    if (input.currency.toUpperCase() !== s.currency.toUpperCase()) return { ok: false, reason: 'amount_mismatch' };
    const shownFare = input.vars.pkg_fare ? toMinor(input.vars.pkg_fare) : null;
    const reserved = await reserveTopupRide(prisma, {
        tenantId: input.tenantId, customerId: customer.id, conversationId: input.conversationId,
        pickup: trip.pickup, destination: trip.destination,
        expectedTopupMinor: Math.round(input.amount * 100), expectedFareMinor: shownFare ?? undefined,
    });
    if (!reserved.ok) return { ok: false, reason: reserved.reason };
    const rideId = reserved.ride.id;
    return {
        ok: true,
        entityId: rideId,
        ...returnUrl(s.rideThanksUrl),
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
        message: `A ${args.what} payment of ${money(input.amountMinor, input.currency.toUpperCase())} arrived but was not applied (${args.reason}). Refund it from ${refundSourceText(input.provider)}.`,
        context: { reference: input.reference, amount: input.amountMinor, currency: input.currency, reason: args.reason, ...args.context },
        dedupeKey: `${args.kind}.not_applied:${input.tenantId}:${input.reference}`,
    });
    if (!args.fresh) return;
    await createNotification(input.prisma, {
        tenantId: input.tenantId,
        type: 'SYSTEM',
        title: 'Payment needs a refund',
        message: `A ${args.what} payment of ${money(input.amountMinor, input.currency.toUpperCase())} (${input.reference}) could not be honoured: ${args.reason}. Please refund ${money(input.amountMinor, input.currency.toUpperCase())}.`,
        metadata: { kind: `${args.kind}.refund_due`, reference: input.reference },
    }).catch((err: unknown) => input.log.warn({ err }, 'Refund notification not created'));
}

export async function fulfillRidePackage(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const bad = invalid(input);
    if (bad) return bad;
    const prisma = input.prisma as RidesClient;
    const deps = { prisma, log: input.log };
    const res = await activatePassOnPayment(prisma, {
        tenantId: input.tenantId, passId: input.entityId, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transactionId: input.transactionId, channel: input.channel, provider: input.provider,
    });
    if (res.outcome === 'not_found') return { status: 'rejected', reason: 'pass_not_found' };
    const { pass } = res;
    const facts = { passId: pass.id, conversationId: pass.conversationId, purpose: 'PACKAGE_PURCHASE' };

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
            if (flow === 'not_waiting') {
                // The flow already moved on (e.g. it said pay_failed when the hold lapsed): tell the customer directly
                // ("Payment confirmed" + the package), and reset the stale flow so their next message opens the member menu.
                await sendActivationWelcome(deps, pass);
                if (pass.conversationId) await endIdleFlowAfterPayment(prisma, input.log, { tenantId: input.tenantId, conversationId: pass.conversationId });
            }
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
        tenantId: input.tenantId, rideId: input.entityId, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transactionId: input.transactionId, channel: input.channel, provider: input.provider,
    });
    if (res.outcome === 'not_found') return { status: 'rejected', reason: 'ride_not_found' };
    const { ride } = res;
    const facts = { rideId: ride.id, conversationId: ride.conversationId, purpose: 'PAYG_RIDE' };

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

/**
 * More than the difference was paid (e.g. a payment on an older link after the
 * difference shrank on a re-quote). The ride is still confirmed; the excess is
 * TURBO's to refund: a critical alert once per reference, and a staff notice
 * on the first delivery.
 */
async function flagTopupOverpayment(input: FulfillmentInput, ride: { id: string; ref: string; customerId: string; topupMinor: number | null }, fresh: boolean): Promise<void> {
    const excess = input.amountMinor - (ride.topupMinor ?? 0);
    if (excess <= AMOUNT_TOLERANCE_MINOR) return;
    const currency = input.currency.toUpperCase();
    await raiseAlert(input.prisma, {
        kind: `${RIDE_TOPUP_KIND}.overpaid`,
        severity: 'critical',
        tenantId: input.tenantId,
        message: `A package ride top-up (${ride.ref}) was overpaid: ${money(input.amountMinor, currency)} received for ${money(ride.topupMinor ?? 0, currency)}. The ride is booked; refund the extra ${money(excess, currency)} from ${refundSourceText(input.provider)}.`,
        context: { reference: input.reference, rideId: ride.id, customerId: ride.customerId, paidMinor: input.amountMinor, topupMinor: ride.topupMinor, excessMinor: excess },
        dedupeKey: `${RIDE_TOPUP_KIND}.overpaid:${input.tenantId}:${input.reference}`,
    });
    if (!fresh) return;
    await createNotification(input.prisma, {
        tenantId: input.tenantId,
        type: 'SYSTEM',
        title: 'Payment needs a refund',
        message: `Top-up ${input.reference} for ride ${ride.ref} was overpaid. Please refund ${money(excess, currency)}.`,
        metadata: { kind: `${RIDE_TOPUP_KIND}.refund_due`, reference: input.reference },
    }).catch((err: unknown) => input.log.warn({ err }, 'Refund notification not created'));
}

export async function fulfillRideTopup(input: FulfillmentInput): Promise<FulfillmentOutcome> {
    const bad = invalid(input);
    if (bad) return bad;
    const prisma = input.prisma as RidesClient;
    const deps = { prisma, log: input.log };
    const res = await confirmTopupOnPayment(prisma, {
        tenantId: input.tenantId, rideId: input.entityId, reference: input.reference, amountMinor: input.amountMinor, currency: input.currency, transactionId: input.transactionId, channel: input.channel, provider: input.provider,
    });
    if (res.outcome === 'not_found') return { status: 'rejected', reason: 'ride_not_found' };
    const { ride } = res;
    const facts = { rideId: ride.id, conversationId: ride.conversationId, purpose: 'PACKAGE_TOPUP' };
    const what = `package ride top-up (${ride.ref}, ${money(input.amountMinor, input.currency.toUpperCase())})`;

    switch (res.outcome) {
        case 'underpaid':
            await recordPayment(input, 'payment.failed', { ...facts, reason: 'underpaid' });
            await refuseLoudly(input, { kind: RIDE_TOPUP_KIND, what, reason: 'underpaid', context: { rideId: ride.id, customerId: ride.customerId, owedMinor: ride.topupMinor }, fresh: true });
            await flowOutcome(input, ride.conversationId, RIDE_TOPUP_KIND, false);
            return { status: 'rejected', reason: 'amount_insufficient' };
        case 'confirmed':
        case 'already_confirmed': {
            await recordPayment(input, 'payment.succeeded', facts);
            await flagTopupOverpayment(input, ride, res.outcome === 'confirmed');
            if (res.outcome === 'confirmed') await afterRideRequested(deps, ride);
            else await emitRideRequested(prisma, ride);
            const flow = await flowOutcome(input, ride.conversationId, RIDE_TOPUP_KIND, true);
            if (res.outcome === 'already_confirmed') return { status: 'already_applied' };
            if (flow === 'not_waiting') {
                await notifyRideCustomer(deps, {
                    tenantId: input.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
                    kind: 'ride_topup.paid', text: topupReceivedText(ride.balanceAppliedMinor ?? 0, ride.currency), emailSubject: 'Your TURBO ride is confirmed',
                });
            }
            return { status: 'applied' };
        }
        case 'refused':
        case 'already_refused': {
            await recordPayment(input, 'payment.succeeded', facts);
            const fresh = res.outcome === 'refused';
            await refuseLoudly(input, { kind: RIDE_TOPUP_KIND, what, reason: res.reason, context: { rideId: ride.id, customerId: ride.customerId, refundMinor: input.amountMinor }, fresh });
            const flow = await flowOutcome(input, ride.conversationId, RIDE_TOPUP_KIND, false);
            if (fresh && flow === 'not_waiting') {
                await notifyRideCustomer(deps, {
                    tenantId: input.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
                    kind: 'ride_topup.not_confirmed', text: topupNotConfirmedText(input.amountMinor, input.currency.toUpperCase()), emailSubject: 'About your TURBO payment',
                });
            }
            return { status: 'rejected', reason: `not_confirmed:${res.reason}` };
        }
    }
}

// ---------------------------------------------------------------- owners

/** The tenant of a pass / ride, by id. Webhook context (no tenant yet), so not tenant-scoped by design. */
export async function ridePassOwner(prisma: RidesClient, id: string): Promise<string | null> {
    const row = await prisma.ridePass.findUnique({ where: { id }, select: { tenantId: true } });
    return row?.tenantId ?? null;
}

export async function rideOwner(prisma: RidesClient, id: string): Promise<string | null> {
    const row = await prisma.ride.findUnique({ where: { id }, select: { tenantId: true } });
    return row?.tenantId ?? null;
}

/** Safe to call more than once. */
export function registerRidePayments(): void {
    if (!isRegisteredFulfillmentKind(RIDE_PACKAGE_KIND)) registerPaymentFulfiller(RIDE_PACKAGE_KIND, fulfillRidePackage);
    if (!isRegisteredFulfillmentKind(RIDE_PAYG_KIND)) registerPaymentFulfiller(RIDE_PAYG_KIND, fulfillRidePayg);
    if (!isRegisteredFulfillmentKind(RIDE_TOPUP_KIND)) registerPaymentFulfiller(RIDE_TOPUP_KIND, fulfillRideTopup);
    if (!hasFlowPaymentPreparer(RIDE_PACKAGE_KIND)) registerFlowPaymentPreparer(RIDE_PACKAGE_KIND, prepareRidePackage);
    if (!hasFlowPaymentPreparer(RIDE_PAYG_KIND)) registerFlowPaymentPreparer(RIDE_PAYG_KIND, prepareRidePayg);
    if (!hasFlowPaymentPreparer(RIDE_TOPUP_KIND)) registerFlowPaymentPreparer(RIDE_TOPUP_KIND, prepareRideTopup);
    if (!hasFulfillmentOwner(RIDE_PACKAGE_KIND)) registerFulfillmentOwner(RIDE_PACKAGE_KIND, ridePassOwner);
    if (!hasFulfillmentOwner(RIDE_PAYG_KIND)) registerFulfillmentOwner(RIDE_PAYG_KIND, rideOwner);
    if (!hasFulfillmentOwner(RIDE_TOPUP_KIND)) registerFulfillmentOwner(RIDE_TOPUP_KIND, rideOwner);
}
