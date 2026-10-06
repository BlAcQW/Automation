/**
 * The bot's pack actions (flow `action` steps), all named `turbo.*`.
 *
 * Each returns ok:true with the variables its step declares in `produces`;
 * a business "no" (sold out, too far, no rides left) is a variable the flow
 * branches on, not a failure. ok:false is kept for the unexpected (no customer
 * could be resolved, the database is down) and sends the flow to its onError
 * state.
 *
 * Actions get no database handle from the engine (it stays pure), so they are
 * registered with one: registerRideFlowActions(prisma).
 */
import type { FlowActionFn } from '../flows/actions.js';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { ActionRequest, ActionResult } from '../flows/engine.js';
import { isRegisteredFlowAction, registerFlowAction } from '../flows/actions.js';
import type { RidesClient, RidesDb } from './db.js';
import { getRideSettings } from './settings.js';
import { customerBalance, foundingAvailability, PASS_DISPLAY_NAME } from './passes.js';
import {
    BOOKED_RIDE, findOpenRide, paygStatus, quotePackageRide, quotePaygRide, type Place,
} from './rides.js';
import { bookPackageRide, changeRideStatus, resolveConversationCustomer, type OpsDeps } from './operations.js';
import { formatMinor, isValidCoordinate } from './geo.js';
import { formatDate, rides } from './texts.js';
import { pickupFromVars, tripFromVars } from './trip-vars.js';
import { scoped } from '../../lib/logger.js';

const log = scoped('rides-flow');

export const TURBO_ACTIONS = [
    'turbo.register', 'turbo.founding_available', 'turbo.balance', 'turbo.history', 'turbo.account',
    'turbo.destinations', 'turbo.quote_ride', 'turbo.request_ride', 'turbo.payg_open', 'turbo.payg_quote', 'turbo.cancel_ride',
] as const;

const yes = (b: boolean) => (b ? 'yes' : 'no');
/** "960", "25.50" */
const amount = (minor: number) => formatMinor(minor).replace(/\.00$/, '');
const km = (n: number) => (Math.round(n * 10) / 10).toString();

const STATUS_TEXT: Record<string, string> = {
    REQUESTED: 'waiting for a driver',
    ASSIGNED: 'assigned to a driver',
    EN_ROUTE: 'on the way',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    PENDING_PAYMENT: 'waiting for payment',
};

export const UNKNOWN_PLACE_TEXT = "I couldn't find that place. Reply with a number from the list, or share the location pin.";

// ---------------------------------------------------------------- destinations

async function activeDestinations(db: RidesDb, tenantId: string) {
    return db.rideDestination.findMany({
        where: { tenantId, active: true },
        orderBy: [{ sort: 'asc' }, { label: 'asc' }],
        take: 30,
    });
}

/** The destination the customer gave: a pin, a number from the list, or a saved place's name. */
export async function resolveDestination(db: RidesDb, tenantId: string, vars: Record<string, string>): Promise<Place | null> {
    const lat = Number(vars.dest_lat);
    const lng = Number(vars.dest_lng);
    if (vars.dest_lat && isValidCoordinate(lat, lng)) return { label: vars.dest_label || 'Shared location', lat, lng };
    const typed = (vars.dest_text ?? '').trim().toLowerCase();
    if (!typed) return null;
    const list = await activeDestinations(db, tenantId);
    const toPlace = (d: (typeof list)[number]): Place => ({ label: d.label, lat: d.latitude, lng: d.longitude, id: d.id });
    if (/^\d{1,2}$/.test(typed)) {
        const d = list[Number(typed) - 1];
        return d ? toPlace(d) : null;
    }
    const exact = list.find((d) => d.label.toLowerCase() === typed);
    if (exact) return toPlace(exact);
    const partial = list.filter((d) => d.label.toLowerCase().includes(typed));
    return partial.length === 1 ? toPlace(partial[0]) : null;
}

// ---------------------------------------------------------------- the actions

const registerSchema = z.object({
    full_name: z.string().trim().min(2).max(60),
    student_id: z.string().trim().min(1).max(64),
    university: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
});

export function createRideFlowActions(prisma: RidesClient) {
    const deps: OpsDeps = { prisma, log };
    const customerOf = (req: ActionRequest) => resolveConversationCustomer(prisma, req);

    const actions: Record<(typeof TURBO_ACTIONS)[number], (req: ActionRequest) => Promise<ActionResult>> = {
        /** Save the registration on the Customer (phone = the verified WhatsApp number). */
        async 'turbo.register'(req) {
            const parsed = registerSchema.safeParse(req.vars);
            if (!parsed.success) return { ok: false };
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const { full_name, student_id, university, email } = parsed.data;
            const attrs = customer.attributes && typeof customer.attributes === 'object' && !Array.isArray(customer.attributes)
                ? (customer.attributes as Record<string, unknown>) : {};
            await prisma.customer.updateMany({
                where: { id: customer.id, tenantId: req.tenantId },
                data: { name: full_name, email, attributes: { ...attrs, studentId: student_id, university } as Prisma.InputJsonObject },
            });
            return { ok: true, vars: { customer_name: full_name, welcome_name: full_name.toUpperCase() } };
        },

        async 'turbo.founding_available'(req) {
            const s = await getRideSettings(prisma, req.tenantId);
            const a = await foundingAvailability(prisma, req.tenantId, new Date(), s);
            return {
                ok: true,
                vars: {
                    pkg_price: amount(s.packagePriceMinor),
                    pkg_rides: s.packageRides,
                    pkg_days: s.validityDays,
                    pkg_max_km: s.maxKm,
                    pkg_per_ride: amount(Math.round(s.packagePriceMinor / Math.max(1, s.packageRides))),
                    founding_cap: a.cap,
                    founding_left: a.left,
                    founding_open: yes(a.available),
                    hold_minutes: s.holdMinutes,
                },
            };
        },

        async 'turbo.balance'(req) {
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const s = await getRideSettings(prisma, req.tenantId);
            const [b, open] = await Promise.all([
                customerBalance(prisma, req.tenantId, customer.id),
                findOpenRide(prisma, req.tenantId, customer.id),
            ]);
            return {
                ok: true,
                vars: {
                    member: yes(b.active),
                    pass_name: PASS_DISPLAY_NAME,
                    rides_total: b.purchased,
                    rides_used: b.used,
                    rides_left: b.active ? b.remaining : 0,
                    expiry_date: b.expiresAt ? formatDate(b.expiresAt, s.timezone) : '-',
                    open_ride: yes(!!open),
                    open_ride_ref: open?.ref ?? '',
                    open_ride_status: open ? STATUS_TEXT[open.status] ?? open.status.toLowerCase() : '',
                },
            };
        },

        /** Last 5 rides, one line each. */
        async 'turbo.history'(req) {
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const s = await getRideSettings(prisma, req.tenantId);
            const list = await prisma.ride.findMany({
                where: { tenantId: req.tenantId, customerId: customer.id, ...BOOKED_RIDE },
                orderBy: { createdAt: 'desc' },
                take: 5,
            });
            const lines = list.map((r, i) =>
                `${i + 1}. ${formatDate(r.requestedAt, s.timezone)} · ${r.pickupLabel} → ${r.destinationLabel} · ${r.kind === 'PAYG' ? `PAYG GHS ${amount(r.fareMinor)}` : 'Package'} · ${STATUS_TEXT[r.status] ?? r.status}`);
            return { ok: true, vars: { history_text: lines.length ? lines.join('\n') : 'No rides yet.', history_count: list.length } };
        },

        async 'turbo.account'(req) {
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const s = await getRideSettings(prisma, req.tenantId);
            const b = await customerBalance(prisma, req.tenantId, customer.id);
            const attrs = (customer.attributes ?? {}) as Record<string, unknown>;
            const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '-');
            return {
                ok: true,
                vars: {
                    account_name: str(customer.name),
                    account_phone: customer.phone,
                    account_email: str(customer.email),
                    account_student_id: str(attrs.studentId),
                    account_university: str(attrs.university),
                    package_status: b.active && b.expiresAt
                        ? `${PASS_DISPLAY_NAME} · ${rides(b.remaining)} left · expires ${formatDate(b.expiresAt, s.timezone)}`
                        : 'No active package',
                },
            };
        },

        /** The numbered list of saved places, as one block for the destination prompt. */
        async 'turbo.destinations'(req) {
            const list = await activeDestinations(prisma, req.tenantId);
            const menu = list.length
                ? `Reply with a number:\n${list.map((d, i) => `${i + 1}. ${d.label}`).join('\n')}\n\nOr share the destination's location pin.`
                : "Share the destination's location pin (tap 📎 or +, then Location).";
            return { ok: true, vars: { destination_menu: menu, dest_count: list.length } };
        },

        async 'turbo.quote_ride'(req) {
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const pickup = pickupFromVars(req.vars);
            const destination = await resolveDestination(prisma, req.tenantId, req.vars);
            if (!pickup || !destination) return { ok: true, vars: { quote_ok: 'no', quote_code: 'unknown_place', quote_reason: UNKNOWN_PLACE_TEXT } };
            const q = await quotePackageRide(prisma, { tenantId: req.tenantId, customerId: customer.id, pickup, destination });
            const trip = tripVarsOf(destination, q.distanceKm);
            if (q.ok) return { ok: true, vars: { quote_ok: 'yes', quote_code: 'ok', quote_reason: '', ...trip, rides_left: q.remaining } };
            const reason = q.reason === 'too_far'
                ? `That trip is about ${km(q.distanceKm ?? 0)} km. Founding Package rides cover 0–${q.maxKm} km.\n\nFor longer trips, choose PAYG Ride from the menu.`
                : q.reason === 'no_rides_left' ? "You've used all the rides on your package."
                    : q.reason === 'no_package' ? "You don't have an active TURBO package."
                        : UNKNOWN_PLACE_TEXT;
            return { ok: true, vars: { quote_ok: 'no', quote_code: q.reason, quote_reason: reason, ...trip, rides_left: q.remaining ?? 0 } };
        },

        async 'turbo.request_ride'(req) {
            const customer = await customerOf(req);
            const trip = tripFromVars(req.vars);
            if (!customer || !trip) return { ok: false };
            const r = await bookPackageRide(deps, {
                tenantId: req.tenantId, customerId: customer.id, conversationId: req.conversationId,
                pickup: trip.pickup, destination: trip.destination, source: 'WHATSAPP',
            });
            if (r.ok) return { ok: true, vars: { request_ok: 'yes', request_reason: '', ride_ref: r.ride.ref } };
            if (r.reason === 'open_ride') {
                // A re-run of this very turn (lost state write) finds the ride it just made: report it, do not refuse it.
                const open = await findOpenRide(prisma, req.tenantId, customer.id);
                if (open && open.status === 'REQUESTED' && open.conversationId === req.conversationId
                    && open.pickupLat === trip.pickup.lat && open.pickupLng === trip.pickup.lng
                    && open.destinationLat === trip.destination.lat && open.destinationLng === trip.destination.lng) {
                    return { ok: true, vars: { request_ok: 'yes', request_reason: '', ride_ref: open.ref } };
                }
                return { ok: true, vars: { request_ok: 'no', request_reason: `You already have a ride in progress${open ? ` (${open.ref})` : ''}.`, ride_ref: '' } };
            }
            const reason = r.reason === 'too_far' ? `That trip is about ${km(r.distanceKm ?? 0)} km, beyond your package's 0–${r.maxKm} km.`
                : r.reason === 'no_rides_left' ? "You've used all the rides on your package."
                    : r.reason === 'no_package' ? "You don't have an active TURBO package."
                        : UNKNOWN_PLACE_TEXT;
            return { ok: true, vars: { request_ok: 'no', request_reason: reason, ride_ref: '' } };
        },

        /** payg_open = the switch is on (the option is offered); payg_reason = open | closed | full (today's seats). */
        async 'turbo.payg_open'(req) {
            const [p, s] = await Promise.all([paygStatus(prisma, req.tenantId), getRideSettings(prisma, req.tenantId)]);
            return {
                ok: true,
                vars: { payg_open: yes(s.paygOpen), payg_reason: p.reason, payg_fare_from: amount(p.fromFareMinor), payg_left: p.available, hold_minutes: s.holdMinutes },
            };
        },

        async 'turbo.payg_quote'(req) {
            const pickup = pickupFromVars(req.vars);
            const destination = await resolveDestination(prisma, req.tenantId, req.vars);
            if (!pickup || !destination) return { ok: true, vars: { quote_ok: 'no', quote_code: 'unknown_place', quote_reason: UNKNOWN_PLACE_TEXT } };
            const [q, status] = await Promise.all([
                quotePaygRide(prisma, { tenantId: req.tenantId, pickup, destination }),
                paygStatus(prisma, req.tenantId),
            ]);
            const trip = tripVarsOf(destination, q.distanceKm);
            if (q.ok && status.open) return { ok: true, vars: { quote_ok: 'yes', quote_code: 'ok', quote_reason: '', ...trip, payg_fare: amount(q.fareMinor) } };
            const code = !q.ok ? q.reason : status.reason;
            const reason = code === 'not_offered'
                ? `That trip is about ${km(q.distanceKm ?? 0)} km. PAYG rides go up to ${!q.ok ? q.maxKm : ''} km.`
                : code === 'full' ? "🔴 PAYG is currently unavailable\n\nToday's available PAYG slots have been filled.\n\nPioneer Members receive priority access.\n\nPlease try again later."
                    : code === 'closed' ? '🔴 PAYG is currently unavailable\n\nPioneer Members receive priority access.\n\nPlease try again later.'
                        : UNKNOWN_PLACE_TEXT;
            return { ok: true, vars: { quote_ok: 'no', quote_code: code, quote_reason: reason, ...trip, payg_fare: '' } };
        },

        /** Cancel the customer's ride while no driver is assigned yet (free; never deducts). */
        async 'turbo.cancel_ride'(req) {
            const customer = await customerOf(req);
            if (!customer) return { ok: false };
            const open = await findOpenRide(prisma, req.tenantId, customer.id);
            if (!open) return { ok: true, vars: { cancel_ok: 'no', cancel_reason: "You don't have a ride in progress." } };
            if (open.status !== 'REQUESTED') {
                return { ok: true, vars: { cancel_ok: 'no', cancel_reason: `A driver is already ${open.status === 'EN_ROUTE' ? 'on the way' : 'assigned'} for ${open.ref}, so it can't be cancelled here. Reply SUPPORT to talk to the team.` } };
            }
            const r = await changeRideStatus(deps, { tenantId: req.tenantId, rideId: open.id, status: 'CANCELLED', reason: 'customer', by: 'customer' });
            if (!r.ok) return { ok: true, vars: { cancel_ok: 'no', cancel_reason: "That ride can't be cancelled any more. Reply SUPPORT to talk to the team." } };
            const refund = r.refundDue ? '\n\nYour payment will be refunded by the TURBO team.' : '';
            return { ok: true, vars: { cancel_ok: 'yes', cancel_reason: `❌ Ride ${open.ref} cancelled. No ride was deducted.${refund}` } };
        },
    };
    return actions;
}

function tripVarsOf(destination: Place, distanceKm: number | undefined): Record<string, string> {
    return {
        trip_dest: destination.label,
        trip_dest_lat: String(destination.lat),
        trip_dest_lng: String(destination.lng),
        trip_dest_id: destination.id ?? '',
        trip_km: distanceKm === undefined ? '' : km(distanceKm),
    };
}

/** Unknown places in a row before the customer is handed to a person. */
export const MAX_PLACE_MISSES = 3;

/**
 * A destination step accepts any text, so the engine's miss counter never
 * fires there. This counts "unknown place" answers in `place_misses` (reset by
 * any other outcome) so the flow can hand off instead of looping forever.
 */
export function withPlaceMisses(fn: FlowActionFn): FlowActionFn {
    return async (req) => {
        const res = await fn(req);
        if (!res.ok) return res;
        const prev = Number(req.vars?.place_misses ?? 0) || 0;
        const missed = res.vars?.quote_code === 'unknown_place';
        return { ...res, vars: { ...res.vars, place_misses: missed ? prev + 1 : 0 } };
    };
}

const COUNTS_PLACE_MISSES = new Set(['turbo.quote_ride', 'turbo.payg_quote']);

/** Safe to call more than once (the first registration wins). */
export function registerRideFlowActions(prisma: RidesClient): void {
    const actions = createRideFlowActions(prisma);
    for (const name of TURBO_ACTIONS) {
        const fn = COUNTS_PLACE_MISSES.has(name) ? withPlaceMisses(actions[name]) : actions[name];
        if (!isRegisteredFlowAction(name)) registerFlowAction(name, fn);
    }
}
