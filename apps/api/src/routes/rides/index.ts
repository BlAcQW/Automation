/**
 * TURBO console API (R6): /rides/*. Response shapes are the ones the console
 * declares in /root/home/turbo/src/lib/api.ts (lists: { data, pagination };
 * single resources: the bare object).
 *
 * AUTH. A Bookly tenant user's access token (Authorization: Bearer), exactly
 * like the dashboard routes. Bearer-authenticated requests carry no ambient
 * credential, so they need no CSRF check; the cookie-authenticated
 * /auth/refresh is what the CSRF guard (plugins/csrf.ts) protects when
 * CROSS_SITE_AUTH is on. A support token is read-only (enforced in auth.ts).
 *
 * ROLES. Any staff user can read and run dispatch (assign, status). Settings,
 * drivers and destinations writes are OWNER only. Customer phone numbers are
 * masked per resolveMaskPolicy.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resolveMaskPolicy } from '../../services/contact-privacy-policy.js';
import { normalizePhone } from '../../services/flows/validators.js';
import { startOfDayInZone } from '../../services/timezone.js';
import { getRideSettings, settingsPatchSchema, toSettingsView, updateRideSettings } from '../../services/rides/settings.js';
import { assignRideDriver, changeRideStatus } from '../../services/rides/operations.js';
import {
    customerDetail, customerList, liveRides, overview, passList, paymentList, rideHistory,
} from '../../services/rides/console.js';
import { destinationView, driverView, rideView } from '../../services/rides/views.js';
import { audit } from '../../services/audit.js';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');
const idParams = z.object({ id });
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess(blankToUndefined, t.optional());

const RIDE_STATUSES = ['REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED'] as const;
const LIVE_STATUSES = ['REQUESTED', 'ASSIGNED', 'EN_ROUTE'] as const;
const KINDS = ['PACKAGE', 'PAYG'] as const;
const PASS_STATUSES = ['PENDING_PAYMENT', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'] as const;
const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;

/** YYYY-MM-DD (a whole day in the tenant's timezone) or a full ISO timestamp. */
const dateParam = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'Use YYYY-MM-DD or an ISO timestamp');

const text = (max: number) => z.string().trim().min(1).max(max);
const phone = z.string().trim().max(30).transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use a phone number like 0241234567 or +233241234567' });
        return z.NEVER;
    }
    return p;
});
const driverBody = z.object({ name: text(80), phone, vehicle: text(80), plate: text(20), active: z.boolean().default(true) }).strict();
const driverPatch = z.object({ name: text(80), phone, vehicle: text(80), plate: text(20), active: z.boolean() })
    .partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const destinationBody = z.object({
    label: text(60), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    active: z.boolean().default(true), sort: z.number().int().min(-10_000).max(10_000).default(0),
}).strict();
const destinationPatch = z.object({
    label: text(60), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    active: z.boolean(), sort: z.number().int().min(-10_000).max(10_000),
}).partial().strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const ridesRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('preHandler', fastify.authenticate);
    const deps = { prisma: fastify.prisma, log: fastify.log };

    const mask = (r: FastifyRequest) => resolveMaskPolicy(fastify.prisma, r.user.tenantId, r.user.role, !!r.user.support);
    const requireOwner = (r: FastifyRequest) => {
        if (r.user.role !== 'OWNER') throw fastify.httpErrors.forbidden('Only the account owner can change this');
    };
    const actor = (r: FastifyRequest) => ({ prisma: fastify.prisma, actorType: 'USER' as const, actorId: r.user.userId, tenantId: r.user.tenantId });

    async function dayBounds(tenantId: string, raw: string | undefined, end: boolean): Promise<Date | undefined> {
        if (!raw) return undefined;
        if (raw.length > 10) {
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) throw fastify.httpErrors.badRequest('Invalid date');
            return d;
        }
        const { timezone } = await getRideSettings(fastify.prisma, tenantId);
        const startOfDay = startOfDayInZone(raw, timezone);
        if (!startOfDay) throw fastify.httpErrors.badRequest('Invalid date');
        return end ? new Date(startOfDay.getTime() + 24 * 3600_000) : startOfDay;
    }

    // ---------------------------------------------------------------- read

    fastify.get('/overview', async (request) => overview(fastify.prisma, request.user.tenantId));

    fastify.get('/live', async (request) => {
        const q = z.object({ status: opt(z.enum(LIVE_STATUSES)) }).parse(request.query);
        return liveRides(fastify.prisma, request.user.tenantId, q.status, await mask(request));
    });

    fastify.get('/', async (request) => {
        const q = z.object({
            from: opt(dateParam), to: opt(dateParam), status: opt(z.enum(RIDE_STATUSES)), kind: opt(z.enum(KINDS)), page, limit,
        }).parse(request.query);
        const { tenantId } = request.user;
        return rideHistory(fastify.prisma, tenantId, {
            page: q.page, limit: q.limit, status: q.status, kind: q.kind,
            from: await dayBounds(tenantId, q.from, false), to: await dayBounds(tenantId, q.to, true),
        }, await mask(request));
    });

    fastify.get('/customers', async (request) => {
        const q = z.object({ search: opt(z.string().trim().max(100)), page, limit }).parse(request.query);
        return customerList(fastify.prisma, request.user.tenantId, q, await mask(request));
    });

    fastify.get('/customers/:id', async (request) => {
        const { id: customerId } = idParams.parse(request.params);
        const detail = await customerDetail(fastify.prisma, request.user.tenantId, customerId, await mask(request));
        if (!detail) throw fastify.httpErrors.notFound('Customer not found');
        return detail;
    });

    fastify.get('/passes', async (request) => {
        const q = z.object({ status: opt(z.enum(PASS_STATUSES)), page, limit }).parse(request.query);
        return passList(fastify.prisma, request.user.tenantId, q, await mask(request));
    });

    fastify.get('/payments', async (request) => {
        const q = z.object({ kind: opt(z.enum(KINDS)), status: opt(z.enum(PAYMENT_STATUSES)), page, limit }).parse(request.query);
        return paymentList(fastify.prisma, request.user.tenantId, q, await mask(request));
    });

    // ---------------------------------------------------------------- dispatch (any staff)

    fastify.post('/:id/assign', async (request) => {
        const { id: rideId } = idParams.parse(request.params);
        const { driverId } = z.object({ driverId: id }).strict().parse(request.body);
        const result = await assignRideDriver(deps, { tenantId: request.user.tenantId, rideId, driverId });
        if (!result.ok) {
            if (result.error === 'not_found') throw fastify.httpErrors.notFound('Ride not found');
            if (result.error === 'driver_not_found') throw fastify.httpErrors.badRequest('Driver not found or not active');
            throw fastify.httpErrors.conflict(`A ${result.status} ride cannot be assigned`);
        }
        if (result.changed) await audit({ ...actor(request), action: 'rides.assign', targetType: 'Ride', targetId: rideId, metadata: { driverId } });
        return rideView(result.ride, await mask(request));
    });

    fastify.post('/:id/status', async (request) => {
        const { id: rideId } = idParams.parse(request.params);
        const body = z.object({ status: z.enum(['EN_ROUTE', 'COMPLETED', 'CANCELLED']), reason: z.string().trim().max(300).optional() }).strict().parse(request.body);
        const result = await changeRideStatus(deps, { tenantId: request.user.tenantId, rideId, status: body.status, reason: body.reason, by: 'ops' });
        if (!result.ok) {
            if (result.error === 'not_found') throw fastify.httpErrors.notFound('Ride not found');
            throw fastify.httpErrors.conflict(`A ${result.status} ride cannot be marked ${body.status}`);
        }
        // Repeating a change (a second COMPLETED click) changed nothing and deducted nothing.
        if (!result.changed) throw fastify.httpErrors.conflict(`Ride is already ${body.status}`);
        await audit({ ...actor(request), action: 'rides.status', targetType: 'Ride', targetId: rideId, metadata: { status: body.status, deducted: result.deducted } });
        return rideView(result.ride, await mask(request));
    });

    // ---------------------------------------------------------------- drivers

    fastify.get('/drivers', async (request) => {
        const rows = await fastify.prisma.driver.findMany({ where: { tenantId: request.user.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], take: 500 });
        return { data: rows.map(driverView), pagination: { page: 1, limit: 500, total: rows.length, totalPages: 1 } };
    });

    fastify.post('/drivers', async (request, reply) => {
        requireOwner(request);
        const body = driverBody.parse(request.body);
        const row = await fastify.prisma.driver.create({ data: { tenantId: request.user.tenantId, ...body } });
        await audit({ ...actor(request), action: 'rides.driver.create', targetType: 'Driver', targetId: row.id });
        reply.code(201);
        return driverView(row);
    });

    fastify.patch('/drivers/:id', async (request) => {
        requireOwner(request);
        const { id: driverId } = idParams.parse(request.params);
        const body = driverPatch.parse(request.body);
        const { tenantId } = request.user;
        const { count } = await fastify.prisma.driver.updateMany({ where: { id: driverId, tenantId }, data: body });
        if (count === 0) throw fastify.httpErrors.notFound('Driver not found');
        await audit({ ...actor(request), action: 'rides.driver.update', targetType: 'Driver', targetId: driverId, metadata: { fields: Object.keys(body) } });
        return driverView((await fastify.prisma.driver.findFirst({ where: { id: driverId, tenantId } }))!);
    });

    // ---------------------------------------------------------------- destinations

    fastify.get('/destinations', async (request) => {
        const rows = await fastify.prisma.rideDestination.findMany({ where: { tenantId: request.user.tenantId }, orderBy: [{ sort: 'asc' }, { label: 'asc' }], take: 500 });
        return { data: rows.map(destinationView), pagination: { page: 1, limit: 500, total: rows.length, totalPages: 1 } };
    });

    fastify.post('/destinations', async (request, reply) => {
        requireOwner(request);
        const body = destinationBody.parse(request.body);
        const row = await fastify.prisma.rideDestination.create({ data: { tenantId: request.user.tenantId, ...body } });
        await audit({ ...actor(request), action: 'rides.destination.create', targetType: 'RideDestination', targetId: row.id });
        reply.code(201);
        return destinationView(row);
    });

    fastify.patch('/destinations/:id', async (request) => {
        requireOwner(request);
        const { id: destId } = idParams.parse(request.params);
        const body = destinationPatch.parse(request.body);
        const { tenantId } = request.user;
        const { count } = await fastify.prisma.rideDestination.updateMany({ where: { id: destId, tenantId }, data: body });
        if (count === 0) throw fastify.httpErrors.notFound('Destination not found');
        await audit({ ...actor(request), action: 'rides.destination.update', targetType: 'RideDestination', targetId: destId, metadata: { fields: Object.keys(body) } });
        return destinationView((await fastify.prisma.rideDestination.findFirst({ where: { id: destId, tenantId } }))!);
    });

    // ---------------------------------------------------------------- settings

    fastify.get('/settings', async (request) => toSettingsView(await getRideSettings(fastify.prisma, request.user.tenantId)));

    fastify.patch('/settings', async (request) => {
        requireOwner(request);
        const patch = settingsPatchSchema.parse(request.body);
        const updated = await updateRideSettings(fastify.prisma, request.user.tenantId, patch);
        await audit({ ...actor(request), action: 'rides.settings.update', targetType: 'RideSettings', targetId: request.user.tenantId, metadata: { patch } });
        return toSettingsView(updated);
    });
};

export default ridesRoutes;
