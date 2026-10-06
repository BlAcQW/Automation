/**
 * Rides domain events. Published AFTER the business change committed, once per
 * key (publishEventOnce), and best-effort: a failed publish is logged and never
 * turns a completed dispatch action into an error (the caller would retry and
 * repeat it).
 *
 *   ride.requested       once per ride
 *   ride.assigned        once per (ride, driver)
 *   ride.completed       once per ride
 *   ride_pass.activated  once per pass
 */
import type { Ride, RidePass } from '@prisma/client';
import { publishEventOnce } from '../events/emit.js';
import { scoped } from '../../lib/logger.js';
import type { RidesClient } from './db.js';

const log = scoped('rides-events');

async function once(prisma: RidesClient, tenantId: string, type: string, payload: Record<string, unknown>, field: string, equals: string): Promise<void> {
    try {
        await publishEventOnce(prisma, { tenantId, type, payload }, { field, equals });
    } catch (err) {
        log.warn({ err, type, tenantId }, 'Ride event not published; the ride change itself is saved');
    }
}

function rideFacts(r: Pick<Ride, 'id' | 'ref' | 'kind' | 'customerId'>) {
    return { rideId: r.id, ref: r.ref, kind: r.kind, customerId: r.customerId };
}

export function emitRideRequested(prisma: RidesClient, r: Ride): Promise<void> {
    return once(prisma, r.tenantId, 'ride.requested', {
        ...rideFacts(r), distanceKm: r.distanceKm, fare: r.fareMinor, currency: r.currency, source: r.source,
    }, 'rideId', r.id);
}

export function emitRideAssigned(prisma: RidesClient, r: Ride): Promise<void> {
    return once(prisma, r.tenantId, 'ride.assigned', { ...rideFacts(r), driverId: r.driverId }, 'assignment', `${r.id}:${r.driverId}`);
}

export function emitRideCompleted(prisma: RidesClient, r: Ride, ridesRemaining: number | null): Promise<void> {
    return once(prisma, r.tenantId, 'ride.completed', { ...rideFacts(r), passId: r.passId, ridesRemaining }, 'rideId', r.id);
}

export function emitPassActivated(prisma: RidesClient, p: RidePass): Promise<void> {
    return once(prisma, p.tenantId, 'ride_pass.activated', {
        passId: p.id, customerId: p.customerId, rides: p.ridesTotal, expiresAt: p.expiresAt?.toISOString() ?? null, reference: p.paymentReference,
    }, 'passId', p.id);
}
