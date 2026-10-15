import { describe, it, expect } from 'vitest';
import { bandFare, bandLabel, priceTrip, settleWithBalance, WAIVE_BELOW_MINOR, type FareSchedule } from './pricing.js';
import { roadDistanceKm } from './geo.js';

const PAYG: FareSchedule = { tiers: [{ upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 }], overFareMinor: 5000 };
const PKG: FareSchedule = { tiers: [{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }], overFareMinor: 4000 };

describe('bandFare (inclusive upper bounds, flat over fare, no maximum)', () => {
    it('6.00 km is band 1 and 10.00 km is band 2', () => {
        expect(bandFare(0, PKG)).toEqual({ fareMinor: 1600, band: '0–6 km' });
        expect(bandFare(6, PKG)).toEqual({ fareMinor: 1600, band: '0–6 km' });
        expect(bandFare(6.01, PKG)).toEqual({ fareMinor: 2500, band: '6–10 km' });
        expect(bandFare(10, PKG)).toEqual({ fareMinor: 2500, band: '6–10 km' });
        expect(bandFare(10.01, PKG)).toEqual({ fareMinor: 4000, band: 'Over 10 km' });
        expect(bandFare(250, PAYG)).toEqual({ fareMinor: 5000, band: 'Over 10 km' });
    });
    it('no over fare = not offered beyond the last tier (legacy option)', () => {
        expect(bandFare(10.5, { ...PAYG, overFareMinor: null })).toBeNull();
        expect(bandFare(9, { ...PAYG, overFareMinor: null })?.fareMinor).toBe(3500);
    });
    it('sorts unsorted tiers and refuses junk distances', () => {
        expect(bandFare(5, { tiers: [{ upToKm: 10, fareMinor: 3500 }, { upToKm: 6, fareMinor: 2500 }], overFareMinor: null })?.fareMinor).toBe(2500);
        expect(bandFare(Number.NaN, PKG)).toBeNull();
        expect(bandFare(-1, PKG)).toBeNull();
    });
    it('labels bands from the tier list', () => {
        expect(bandLabel(PKG.tiers, 0)).toBe('0–6 km');
        expect(bandLabel(PKG.tiers, 1)).toBe('6–10 km');
        expect(bandLabel(PKG.tiers, 2)).toBe('Over 10 km');
        expect(bandLabel([{ upToKm: 2.5, fareMinor: 1 }], 0)).toBe('0–2.5 km');
    });
});

describe('priceTrip (where the distance is measured from)', () => {
    const plaza = { label: 'Student Plaza', lat: 5.6205, lng: -0.1667 };
    const pickup = { lat: 5.65, lng: -0.18 };
    const dest = { lat: 5.6, lng: -0.15 };

    it('prices from the fare reference point when it is set (pickup not needed)', () => {
        const p = priceTrip({ fareRef: plaza, destination: dest, roadFactor: 1.3, schedule: PKG });
        expect(p).toMatchObject({ ok: true, basis: 'REFERENCE', distanceKm: roadDistanceKm(plaza, dest, 1.3) });
        const withPickup = priceTrip({ fareRef: plaza, pickup, destination: dest, roadFactor: 1.3, schedule: PKG });
        expect(withPickup).toMatchObject({ basis: 'REFERENCE', distanceKm: roadDistanceKm(plaza, dest, 1.3) });
    });
    it('prices pickup -> destination when no reference is set, with the same road factor method', () => {
        const p = priceTrip({ fareRef: null, pickup, destination: dest, roadFactor: 1.3, schedule: PAYG });
        expect(p).toMatchObject({ ok: true, basis: 'PICKUP', distanceKm: roadDistanceKm(pickup, dest, 1.3) });
        if (p.ok) expect(p.fareMinor).toBe(bandFare(p.distanceKm, PAYG)!.fareMinor);
    });
    it('needs a pickup when there is no reference point', () => {
        expect(priceTrip({ fareRef: null, destination: dest, roadFactor: 1.3, schedule: PAYG })).toEqual({ ok: false, reason: 'needs_pickup' });
    });
    it('refuses bad coordinates and distances beyond an unoffered band', () => {
        expect(priceTrip({ fareRef: null, pickup: { lat: 99, lng: 0 }, destination: dest, roadFactor: 1.3, schedule: PAYG })).toEqual({ ok: false, reason: 'bad_location' });
        const far = priceTrip({ fareRef: null, pickup, destination: { lat: 6.5, lng: -0.15 }, roadFactor: 1.3, schedule: { ...PAYG, overFareMinor: null } });
        expect(far).toMatchObject({ ok: false, reason: 'not_offered', maxKm: 10 });
    });
});

describe('settleWithBalance (decision 4)', () => {
    it('balance covers the fare: pay it all from the balance', () => {
        expect(settleWithBalance(1600, 96000)).toEqual({ mode: 'balance', balanceAppliedMinor: 1600, topupMinor: 0, waivedMinor: 0, balanceAfterMinor: 94400 });
        expect(settleWithBalance(1600, 1600)).toMatchObject({ mode: 'balance', balanceAfterMinor: 0 });
    });
    it('no balance: refused', () => {
        expect(settleWithBalance(1600, 0)).toEqual({ mode: 'no_balance' });
        expect(settleWithBalance(1600, -5)).toEqual({ mode: 'no_balance' });
    });
    it('a difference under GHS 2 is waived', () => {
        expect(WAIVE_BELOW_MINOR).toBe(200);
        expect(settleWithBalance(1600, 1401)).toEqual({ mode: 'waive', balanceAppliedMinor: 1401, topupMinor: 0, waivedMinor: 199, balanceAfterMinor: 0 });
    });
    it('GHS 2 or more: the remaining balance plus a top-up for the difference', () => {
        expect(settleWithBalance(1600, 1400)).toEqual({ mode: 'topup', balanceAppliedMinor: 1400, topupMinor: 200, waivedMinor: 0, balanceAfterMinor: 0 });
        expect(settleWithBalance(4000, 1000)).toMatchObject({ mode: 'topup', topupMinor: 3000 });
    });
});
