/**
 * Ride operations = the service change + what follows it once committed
 * (events, customer messages, driver SMS, staff alerts). Routes, flow actions
 * and the app API call these, so every entry point behaves the same.
 */
import type { Ride, RidePass } from '@prisma/client';
import type { RidesClient } from './db.js';
import { getRideSettings } from './settings.js';
import { passBalance } from './passes.js';
import {
    assignDriver, requestPackageRide, setRideStatus,
    type Place, type RequestRideResult, type RideWithRelations, type StatusChange,
} from './rides.js';
import { emitRideAssigned, emitRideCompleted, emitRideRequested } from './events.js';
import { notifyRideCustomer, smsDriver, type NotifyDeps } from './notify.js';
import {
    driverAssignedText, driverSmsText, packageActivatedText, rideCancelledText, rideCompletedText,
} from './texts.js';
import { createNotification } from '../notifications.js';
import { raiseAlert } from '../alerts.js';
import { upsertCustomerByPhone, linkConversationToCustomer } from '../customers.js';

export type OpsDeps = NotifyDeps;

async function staffNotice(deps: OpsDeps, tenantId: string, title: string, message: string, metadata: Record<string, string>): Promise<void> {
    await createNotification(deps.prisma, { tenantId, type: 'SYSTEM', title, message, metadata }, { warn: (o, m) => deps.log.warn(o as object, m ?? 'notification warning') })
        .catch((err: unknown) => deps.log.warn({ err }, 'Staff notification not created'));
}

/**
 * The customer behind a conversation: its linked record, else the record for
 * its (verified WhatsApp) phone, created and linked if needed.
 */
export async function resolveConversationCustomer(
    prisma: RidesClient,
    args: { tenantId: string; conversationId: string; customerPhone: string | null },
): Promise<{ id: string; name: string | null; email: string | null; phone: string; attributes: unknown } | null> {
    const conv = await prisma.conversation.findFirst({ where: { id: args.conversationId, tenantId: args.tenantId }, select: { customerId: true, customerPhone: true } });
    if (!conv) return null;
    if (conv.customerId) {
        const linked = await prisma.customer.findFirst({ where: { id: conv.customerId, tenantId: args.tenantId } });
        if (linked) return linked;
    }
    const phone = conv.customerPhone ?? args.customerPhone;
    if (!phone) return null;
    const customer = await upsertCustomerByPhone(prisma, { tenantId: args.tenantId, phone });
    if (!customer) return null;
    await linkConversationToCustomer(prisma, { tenantId: args.tenantId, conversationId: args.conversationId, customerId: customer.id });
    return customer;
}

export async function afterRideRequested(deps: OpsDeps, ride: Ride): Promise<void> {
    await emitRideRequested(deps.prisma, ride);
    await staffNotice(deps, ride.tenantId, 'New ride request', `${ride.ref}: ${ride.pickupLabel} → ${ride.destinationLabel} (${ride.kind === 'PAYG' ? 'PAYG' : 'Package'})`, {
        kind: 'ride.requested', rideId: ride.id,
    });
}

export async function bookPackageRide(
    deps: OpsDeps,
    args: { tenantId: string; customerId: string; conversationId?: string | null; pickup: Place; destination: Place; source?: 'WHATSAPP' | 'APP' | 'CONSOLE' },
): Promise<RequestRideResult> {
    const result = await requestPackageRide(deps.prisma, args);
    if (result.ok) await afterRideRequested(deps, result.ride);
    return result;
}

export async function assignRideDriver(deps: OpsDeps, args: { tenantId: string; rideId: string; driverId: string }) {
    const result = await assignDriver(deps.prisma, args);
    if (!result.ok || !result.changed) return result;
    const ride = result.ride;
    await emitRideAssigned(deps.prisma, ride);
    if (ride.driver) {
        await notifyRideCustomer(deps, {
            tenantId: ride.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
            kind: 'ride.driver_assigned', text: driverAssignedText(ride.driver), emailSubject: 'Your TURBO driver is on the way',
        });
        const s = await getRideSettings(deps.prisma, ride.tenantId);
        if (s.driverSms && ride.driver.phone) {
            await smsDriver(deps, {
                tenantId: ride.tenantId,
                phone: ride.driver.phone,
                text: driverSmsText({
                    ref: ride.ref, customerName: ride.customer.name, customerPhone: ride.customer.phone,
                    pickup: ride.pickupLabel, destination: ride.destinationLabel, kind: ride.kind,
                }),
            });
        }
    }
    return result;
}

export async function changeRideStatus(
    deps: OpsDeps,
    args: { tenantId: string; rideId: string; status: StatusChange; reason?: string | null; by?: 'ops' | 'customer' },
) {
    const result = await setRideStatus(deps.prisma, args);
    if (!result.ok || !result.changed) return result;
    const ride: RideWithRelations = result.ride;
    if (args.status === 'COMPLETED') {
        await emitRideCompleted(deps.prisma, ride, result.remaining);
        await notifyRideCustomer(deps, {
            tenantId: ride.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
            kind: 'ride.completed', text: rideCompletedText(result.remaining), emailSubject: 'Your TURBO ride is complete',
        });
    }
    if (args.status === 'CANCELLED') {
        if (result.refundDue) {
            await raiseAlert(deps.prisma, {
                kind: 'ride_payg.refund_due', severity: 'warning', tenantId: ride.tenantId,
                message: `A paid PAYG ride (${ride.ref}) was cancelled. Refund it from your Paystack dashboard.`,
                context: { rideId: ride.id, reference: ride.paymentReference, by: args.by ?? 'ops' },
                dedupeKey: `ride_payg.refund_due:${ride.tenantId}:${ride.id}`,
            });
            await staffNotice(deps, ride.tenantId, 'PAYG refund due', `Ride ${ride.ref} was paid and then cancelled. Refund reference ${ride.paymentReference ?? '-'}.`, { kind: 'ride.refund_due', rideId: ride.id });
        }
        // The customer cancelled in chat (the flow replies there); ops cancellations are announced.
        if (args.by !== 'customer' && result.previousStatus !== 'PENDING_PAYMENT') {
            await notifyRideCustomer(deps, {
                tenantId: ride.tenantId, customerId: ride.customerId, conversationId: ride.conversationId,
                kind: 'ride.cancelled', text: rideCancelledText({ ref: ride.ref, paidPayg: result.refundDue }), emailSubject: 'Your TURBO ride was cancelled',
            });
        }
    }
    return result;
}

/** The welcome message for an activated package, when the chat did not already say it. */
export async function sendActivationWelcome(deps: OpsDeps, pass: RidePass): Promise<void> {
    const [customer, balance] = await Promise.all([
        deps.prisma.customer.findFirst({ where: { id: pass.customerId, tenantId: pass.tenantId }, select: { name: true } }),
        passBalance(deps.prisma, pass.tenantId, pass.id),
    ]);
    await notifyRideCustomer(deps, {
        tenantId: pass.tenantId, customerId: pass.customerId, conversationId: pass.conversationId,
        kind: 'ride_pass.activated', emailSubject: 'Welcome to TURBO',
        text: packageActivatedText({ name: customer?.name ?? null, rides: pass.ridesTotal, days: pass.validityDays, maxKm: pass.maxKm, balance: balance.remaining }),
    });
}
