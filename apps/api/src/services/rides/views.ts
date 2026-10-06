/**
 * Response shapes for the TURBO console (/rides/*) — what /root/home/turbo's
 * src/lib/api.ts declares. Allow-lists: nothing is returned by spreading a row.
 * Internal enums are mapped here (HELD -> PENDING_PAYMENT, PURCHASE ->
 * ACTIVATION...). Customer contacts are masked when the viewer must not see
 * them (resolveMaskPolicy); driver phones are staff data and are not.
 */
import type { Driver, Ride, RideDestination, RidePass, RidePassEntry } from '@prisma/client';
import { maskPhone } from '../contact-privacy.js';
import { formatMinor } from './geo.js';
import { PASS_DISPLAY_NAME, type PassBalance } from './passes.js';
import type { RideWithRelations } from './rides.js';

export type ConsolePassStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';
export type ConsolePaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface PersonRef { id: string; name: string | null; phone: string | null }

export function personRef(c: { id: string; name: string | null; phone: string | null }, mask: boolean): PersonRef {
    return { id: c.id, name: c.name ?? null, phone: c.phone ? (mask ? maskPhone(c.phone) : c.phone) : null };
}

export function rideView(r: RideWithRelations, mask: boolean) {
    return {
        id: r.id,
        ref: r.ref,
        kind: r.kind,
        status: r.status,
        customer: personRef(r.customer, mask),
        pickup: { label: r.pickupLabel, lat: r.pickupLat, lng: r.pickupLng },
        destination: { label: r.destinationLabel, lat: r.destinationLat, lng: r.destinationLng },
        distanceKm: r.distanceKm,
        fare: r.kind === 'PAYG' ? formatMinor(r.fareMinor) : null,
        driver: r.driver ? { id: r.driver.id, name: r.driver.name, vehicle: r.driver.vehicle, plate: r.driver.plate } : null,
        requestedAt: r.requestedAt,
        assignedAt: r.assignedAt,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        cancelReason: r.cancelReason,
    };
}

export function passStatusOf(p: Pick<RidePass, 'status'>, remaining: number): ConsolePassStatus {
    if (p.status === 'HELD') return 'PENDING_PAYMENT';
    if (p.status === 'ACTIVE') return remaining <= 0 ? 'EXHAUSTED' : 'ACTIVE';
    return p.status;
}

export function passView(p: RidePass, b: PassBalance | undefined, customer?: PersonRef) {
    const bal = b ?? { purchased: 0, used: 0, remaining: 0 };
    return {
        id: p.id,
        name: PASS_DISPLAY_NAME,
        status: passStatusOf(p, bal.remaining),
        ...(customer ? { customer } : {}),
        price: formatMinor(p.priceMinor),
        ridesTotal: p.ridesTotal,
        ridesUsed: bal.used,
        ridesRemaining: p.activatedAt ? Math.max(0, bal.remaining) : 0,
        activatedAt: p.activatedAt,
        expiresAt: p.expiresAt,
        createdAt: p.createdAt,
    };
}

function attr(attributes: unknown, key: string): string | null {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return null;
    const v = (attributes as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export interface CustomerRow { id: string; name: string | null; phone: string; attributes: unknown; createdAt: Date }

/** The customer's current package: the ACTIVE one, else the most recent. */
export function currentPass(passes: RidePass[]): RidePass | null {
    return passes.find((p) => p.status === 'ACTIVE') ?? [...passes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

export function customerSummary(c: CustomerRow, passes: RidePass[], balances: Map<string, PassBalance>, mask: boolean) {
    const pass = currentPass(passes);
    const b = pass ? balances.get(pass.id) : undefined;
    return {
        id: c.id,
        name: c.name ?? null,
        phone: mask ? maskPhone(c.phone) : c.phone,
        studentId: attr(c.attributes, 'studentId'),
        university: attr(c.attributes, 'university'),
        package: pass ? { id: pass.id, name: PASS_DISPLAY_NAME, status: passStatusOf(pass, b?.remaining ?? 0) } : null,
        balance: pass?.activatedAt ? Math.max(0, b?.remaining ?? 0) : null,
        expiresAt: pass?.expiresAt ?? null,
    };
}

const REASON: Record<RidePassEntry['type'], string> = { PURCHASE: 'ACTIVATION', RIDE: 'RIDE', EXPIRY: 'EXPIRY', ADJUSTMENT: 'ADJUSTMENT' };

/** Newest first, each with the pass balance right after it. */
export function balanceLogView(entries: RidePassEntry[], rideRefs: Map<string, string>) {
    const running = new Map<string, number>();
    const chronological = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const out = chronological.map((e) => {
        const after = (running.get(e.passId) ?? 0) + e.delta;
        running.set(e.passId, after);
        return {
            id: e.id,
            passId: e.passId,
            delta: e.delta,
            reason: REASON[e.type],
            rideId: e.rideId,
            rideRef: e.rideId ? rideRefs.get(e.rideId) ?? null : null,
            balanceAfter: after,
            createdAt: e.createdAt,
        };
    });
    return out.reverse();
}

export function packagePaymentStatus(p: Pick<RidePass, 'paidAt' | 'status' | 'holdExpiresAt'>, now: Date): ConsolePaymentStatus {
    if (p.paidAt) return 'SUCCEEDED';
    if (p.status === 'HELD' && p.holdExpiresAt && p.holdExpiresAt > now) return 'PENDING';
    return 'FAILED';
}

export function paygPaymentStatus(r: Pick<Ride, 'paidAt' | 'status' | 'paymentExpiresAt'>, now: Date): ConsolePaymentStatus {
    if (r.paidAt) return 'SUCCEEDED';
    if (r.status === 'PENDING_PAYMENT' && r.paymentExpiresAt && r.paymentExpiresAt > now) return 'PENDING';
    return 'FAILED';
}

type PassWithCustomer = RidePass & { customer: { id: string; name: string | null; phone: string } };
type RideWithCustomer = Ride & { customer: { id: string; name: string | null; phone: string } };

export function packagePaymentView(p: PassWithCustomer, mask: boolean, now: Date) {
    return {
        id: p.id,
        kind: 'PACKAGE' as const,
        status: packagePaymentStatus(p, now),
        amount: formatMinor(p.paidAmountMinor ?? p.priceMinor),
        currency: p.currency,
        reference: p.paymentReference ?? '',
        providerReference: p.providerTransactionId ?? null,
        channel: p.paymentChannel ?? null,
        customer: personRef(p.customer, mask),
        rideRef: null,
        passId: p.id,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
    };
}

export function paygPaymentView(r: RideWithCustomer, mask: boolean, now: Date) {
    return {
        id: r.id,
        kind: 'PAYG' as const,
        status: paygPaymentStatus(r, now),
        amount: formatMinor(r.paidAmountMinor ?? r.fareMinor),
        currency: r.currency,
        reference: r.paymentReference ?? '',
        providerReference: r.providerTransactionId ?? null,
        channel: r.paymentChannel ?? null,
        customer: personRef(r.customer, mask),
        rideRef: r.ref,
        passId: null,
        createdAt: r.createdAt,
        paidAt: r.paidAt,
    };
}

export function driverView(d: Driver) {
    return { id: d.id, name: d.name, phone: d.phone, vehicle: d.vehicle, plate: d.plate, active: d.active };
}

export function destinationView(d: RideDestination) {
    return { id: d.id, label: d.label, latitude: d.latitude, longitude: d.longitude, active: d.active, sort: d.sort };
}
