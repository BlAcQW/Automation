/**
 * Fares (pure). Decisions 1, 2 and 4 in docs/TURBO-BUILD.md:
 *
 *  - The distance a fare is priced on runs from the tenant's fare reference
 *    point (e.g. the Student Plaza) to the destination when one is set, else
 *    from the pickup to the destination. Same method either way: straight line
 *    x road factor (roadDistanceKm), 2 decimals.
 *  - Bands have INCLUSIVE upper bounds (6.00 km is band 1), and past the last
 *    tier one flat "over" fare applies with no maximum distance. An over fare
 *    of null means "not offered" there (the legacy option).
 *  - A package ride is paid from the GHS credit: all of it when the balance
 *    covers the fare; when it does not, the whole remaining balance plus a
 *    Paystack top-up for the difference, except that a difference under GHS 2
 *    is waived. No balance at all: no package ride (offer PAYG).
 */
import { isValidCoordinate, roadDistanceKm, type FareTier, type LatLng } from './geo.js';

export interface FareSchedule {
    tiers: readonly FareTier[];
    overFareMinor: number | null;
}

export type PriceBasis = 'REFERENCE' | 'PICKUP';

/** A difference below this (pesewas) is waived rather than charged: GHS 2. */
export const WAIVE_BELOW_MINOR = 200;

const sorted = (tiers: readonly FareTier[]) => [...tiers].sort((a, b) => a.upToKm - b.upToKm);
const kmText = (n: number) => String(Math.round(n * 100) / 100);

/** "0–6 km", "6–10 km", "over 10 km" (index = tiers.length is the over band). */
export function bandLabel(tiers: readonly FareTier[], index: number): string {
    const list = sorted(tiers);
    if (index >= list.length) return `Over ${kmText(list[list.length - 1]?.upToKm ?? 0)} km`;
    const from = index === 0 ? 0 : list[index - 1].upToKm;
    return `${kmText(from)}–${kmText(list[index].upToKm)} km`;
}

export function bandFare(distanceKm: number, schedule: FareSchedule): { fareMinor: number; band: string } | null {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
    const list = sorted(schedule.tiers);
    const i = list.findIndex((t) => distanceKm <= t.upToKm);
    if (i >= 0) return { fareMinor: list[i].fareMinor, band: bandLabel(list, i) };
    if (schedule.overFareMinor === null || list.length === 0) return null;
    return { fareMinor: schedule.overFareMinor, band: bandLabel(list, list.length) };
}

export type TripPrice =
    | { ok: true; distanceKm: number; basis: PriceBasis; fareMinor: number; band: string }
    | { ok: false; reason: 'needs_pickup' | 'bad_location' }
    | { ok: false; reason: 'not_offered'; distanceKm: number; basis: PriceBasis; maxKm: number };

export function priceTrip(args: {
    fareRef: LatLng | null;
    pickup?: LatLng | null;
    destination: LatLng;
    roadFactor: number;
    schedule: FareSchedule;
}): TripPrice {
    const ok = (p: LatLng | null | undefined): p is LatLng => !!p && isValidCoordinate(p.lat, p.lng);
    if (!ok(args.destination)) return { ok: false, reason: 'bad_location' };
    if (args.pickup && !ok(args.pickup)) return { ok: false, reason: 'bad_location' };
    const from = args.fareRef && ok(args.fareRef) ? args.fareRef : args.pickup ?? null;
    if (!from) return { ok: false, reason: 'needs_pickup' };
    const basis: PriceBasis = from === args.fareRef ? 'REFERENCE' : 'PICKUP';
    const distanceKm = roadDistanceKm(from, args.destination, args.roadFactor);
    const fare = bandFare(distanceKm, args.schedule);
    if (!fare) return { ok: false, reason: 'not_offered', distanceKm, basis, maxKm: sorted(args.schedule.tiers).at(-1)?.upToKm ?? 0 };
    return { ok: true, distanceKm, basis, fareMinor: fare.fareMinor, band: fare.band };
}

export type Settlement =
    | { mode: 'no_balance' }
    | { mode: 'balance' | 'waive' | 'topup'; balanceAppliedMinor: number; topupMinor: number; waivedMinor: number; balanceAfterMinor: number };

/** How a package fare is paid from an available balance (pesewas). */
export function settleWithBalance(fareMinor: number, availableMinor: number): Settlement {
    if (availableMinor <= 0) return { mode: 'no_balance' };
    if (availableMinor >= fareMinor) {
        return { mode: 'balance', balanceAppliedMinor: fareMinor, topupMinor: 0, waivedMinor: 0, balanceAfterMinor: availableMinor - fareMinor };
    }
    const difference = fareMinor - availableMinor;
    if (difference < WAIVE_BELOW_MINOR) {
        return { mode: 'waive', balanceAppliedMinor: availableMinor, topupMinor: 0, waivedMinor: difference, balanceAfterMinor: 0 };
    }
    return { mode: 'topup', balanceAppliedMinor: availableMinor, topupMinor: difference, waivedMinor: 0, balanceAfterMinor: 0 };
}
