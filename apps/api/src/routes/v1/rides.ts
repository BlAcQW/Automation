/**
 * Public API v1 for the RIDES pack (R7): what the future TURBO app needs to
 * carry WhatsApp customers over with their balance.
 *
 *   GET  /v1/rides/customers/:id/balance   rides:read   current package + balance
 *   GET  /v1/rides/customers/:id/passes    rides:read   all packages (cursor pages)
 *   GET  /v1/rides/customers/:id/rides     rides:read   ride history (cursor pages)
 *   POST /v1/rides                         rides:write  book a package ride
 *
 * Booking follows the same rules as WhatsApp (active package, rides left,
 * within the package distance, one open ride at a time). A retried POST for the
 * same trip while that ride is still waiting returns the same ride (200), not a
 * second one. Buying a package stays in WhatsApp for now (payment link flow).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Ride, RidePass } from '@prisma/client';
import { z } from 'zod';
import { ApiError, V1_ROUTE_CONFIG, idParam, pageArgs, paginationQuery, requireApiKey, toPage } from './shared.js';
import { customerBalance, passBalances, type PassBalance } from '../../services/rides/passes.js';
import { BOOKED_RIDE, findOpenRide, type Place } from '../../services/rides/rides.js';
import { bookPackageRide } from '../../services/rides/operations.js';
import { formatMinor } from '../../services/rides/geo.js';
import { passStatusOf } from '../../services/rides/views.js';

const idParams = z.object({ id: idParam });
const place = z.object({
    label: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
}).strict();
const bookBody = z.object({
    customerId: idParam,
    pickup: place,
    destination: place.optional(),
    /** A saved place (GET it from the console's destinations); instead of `destination`. */
    destinationId: idParam.optional(),
}).strict().refine((b) => (b.destination === undefined) !== (b.destinationId === undefined), 'Give exactly one of destination or destinationId');

function serializePass(p: RidePass, b: PassBalance | undefined) {
    const bal = b ?? { purchased: 0, used: 0, remaining: 0 };
    return {
        id: p.id,
        status: passStatusOf(p, bal.remaining),
        ridesTotal: p.ridesTotal,
        ridesUsed: bal.used,
        ridesRemaining: p.activatedAt ? Math.max(0, bal.remaining) : 0,
        maxKm: p.maxKm,
        price: formatMinor(p.priceMinor),
        currency: p.currency,
        activatedAt: p.activatedAt,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
    };
}

function serializeRide(r: Ride & { driver?: { id: string; name: string; vehicle: string; plate: string } | null }) {
    return {
        id: r.id,
        ref: r.ref,
        kind: r.kind,
        status: r.status,
        pickup: { label: r.pickupLabel, lat: r.pickupLat, lng: r.pickupLng },
        destination: { label: r.destinationLabel, lat: r.destinationLat, lng: r.destinationLng },
        distanceKm: r.distanceKm,
        fare: r.kind === 'PAYG' ? formatMinor(r.fareMinor) : null,
        currency: r.currency,
        driver: r.driver ? { id: r.driver.id, name: r.driver.name, vehicle: r.driver.vehicle, plate: r.driver.plate } : null,
        source: r.source,
        requestedAt: r.requestedAt,
        assignedAt: r.assignedAt,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
    };
}

const BOOK_ERRORS: Record<string, [number, string]> = {
    no_package: [409, 'The customer has no active package.'],
    no_rides_left: [409, 'The customer has no rides left on their package.'],
    open_ride: [409, 'The customer already has a ride in progress.'],
    too_far: [422, 'The trip is longer than the package allows.'],
    bad_location: [400, 'Invalid pickup or destination.'],
};

const rideRoutes: FastifyPluginAsync = async (fastify) => {
    const cfg = { config: V1_ROUTE_CONFIG };
    const read = { ...cfg, preHandler: fastify.authenticateApiKey(['rides:read']) };
    const write = { ...cfg, preHandler: fastify.authenticateApiKey(['rides:write']) };
    const deps = { prisma: fastify.prisma, log: fastify.log };

    async function ownCustomer(tenantId: string, customerId: string) {
        const c = await fastify.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
        if (!c) throw new ApiError(404, 'not_found', 'Customer not found');
        return c;
    }

    fastify.get('/rides/customers/:id/balance', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        await ownCustomer(tenantId, id);
        const b = await customerBalance(fastify.prisma, tenantId, id);
        return {
            data: {
                customerId: id,
                active: b.active,
                package: b.pass ? serializePass(b.pass, { purchased: b.purchased, used: b.used, remaining: b.remaining }) : null,
                purchased: b.purchased,
                used: b.used,
                remaining: b.active ? Math.max(0, b.remaining) : 0,
                expiresAt: b.expiresAt,
            },
        };
    });

    fastify.get('/rides/customers/:id/passes', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const q = paginationQuery.parse(request.query);
        await ownCustomer(tenantId, id);
        const rows = await fastify.prisma.ridePass.findMany({
            where: { tenantId, customerId: id, status: { not: 'HELD' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...pageArgs(q),
        });
        const { items, pagination } = toPage(rows, q.limit);
        const balances = await passBalances(fastify.prisma, tenantId, items.map((p) => p.id));
        return { data: items.map((p) => serializePass(p, balances.get(p.id))), pagination };
    });

    fastify.get('/rides/customers/:id/rides', read, async (request) => {
        const { tenantId } = requireApiKey(request);
        const { id } = idParams.parse(request.params);
        const q = paginationQuery.parse(request.query);
        await ownCustomer(tenantId, id);
        const rows = await fastify.prisma.ride.findMany({
            where: { tenantId, customerId: id, ...BOOKED_RIDE },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: { driver: { select: { id: true, name: true, vehicle: true, plate: true } } },
            ...pageArgs(q),
        });
        const { items, pagination } = toPage(rows, q.limit);
        return { data: items.map(serializeRide), pagination };
    });

    fastify.post('/rides', write, async (request, reply) => {
        const { tenantId } = requireApiKey(request);
        const body = bookBody.parse(request.body);
        await ownCustomer(tenantId, body.customerId);

        let destination: Place;
        if (body.destinationId) {
            const d = await fastify.prisma.rideDestination.findFirst({ where: { id: body.destinationId, tenantId, active: true } });
            if (!d) throw new ApiError(404, 'not_found', 'Destination not found');
            destination = { label: d.label, lat: d.latitude, lng: d.longitude, id: d.id };
        } else {
            destination = body.destination!;
        }

        const result = await bookPackageRide(deps, { tenantId, customerId: body.customerId, pickup: body.pickup, destination, source: 'APP' });
        if (result.ok) {
            reply.code(201);
            return { data: serializeRide(result.ride) };
        }
        if (result.reason === 'open_ride') {
            const open = await findOpenRide(fastify.prisma, tenantId, body.customerId);
            const sameTrip = open && open.status === 'REQUESTED' && open.source === 'APP'
                && open.pickupLat === body.pickup.lat && open.pickupLng === body.pickup.lng
                && open.destinationLat === destination.lat && open.destinationLng === destination.lng;
            if (sameTrip) return { data: serializeRide(open) };
        }
        const [status, message] = BOOK_ERRORS[result.reason] ?? [409, 'The ride could not be booked.'];
        throw new ApiError(status, result.reason, message);
    });
};

export default rideRoutes;
