import { describe, it, expect } from 'vitest';
import { haversineKm, roadDistanceKm, paygFareMinor, packageEligible, formatMinor, toMinor, isValidCoordinate } from './geo.js';

describe('haversineKm', () => {
    it('is zero for the same point and symmetric', () => {
        const a = { lat: 5.5502, lng: -0.2174 };
        const b = { lat: 5.6037, lng: -0.187 };
        expect(haversineKm(a, a)).toBe(0);
        expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
    });

    it('matches a known distance (Accra Central to Kotoka airport, about 8.2 km straight line)', () => {
        const d = haversineKm({ lat: 5.5502, lng: -0.2174 }, { lat: 5.6052, lng: -0.1668 });
        expect(d).toBeGreaterThan(8);
        expect(d).toBeLessThan(8.4);
    });

    it('one degree of latitude is about 111 km', () => {
        expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
    });
});

describe('roadDistanceKm', () => {
    it('applies the road factor and rounds to 2 decimals', () => {
        const straight = haversineKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 });
        expect(roadDistanceKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, 1.3)).toBe(Math.round(straight * 1.3 * 100) / 100);
    });

    it('treats a non-positive or absurd factor as 1', () => {
        expect(roadDistanceKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, 0)).toBe(roadDistanceKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, 1));
        expect(roadDistanceKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, Number.NaN)).toBe(roadDistanceKm({ lat: 0, lng: 0 }, { lat: 0.01, lng: 0 }, 1));
    });
});

describe('packageEligible', () => {
    it('allows up to and including maxKm', () => {
        expect(packageEligible(5.99, 6)).toBe(true);
        expect(packageEligible(6, 6)).toBe(true);
        expect(packageEligible(6.01, 6)).toBe(false);
    });
});

describe('paygFareMinor', () => {
    const tiers = [{ upToKm: 10, fareMinor: 3500 }, { upToKm: 6, fareMinor: 2500 }];
    it('picks the first tier that covers the distance (tiers sorted)', () => {
        expect(paygFareMinor(0.5, tiers)).toBe(2500);
        expect(paygFareMinor(6, tiers)).toBe(2500);
        expect(paygFareMinor(6.2, tiers)).toBe(3500);
        expect(paygFareMinor(10, tiers)).toBe(3500);
    });
    it('returns null beyond the last tier (not offered)', () => {
        expect(paygFareMinor(10.01, tiers)).toBeNull();
        expect(paygFareMinor(3, [])).toBeNull();
    });
});

describe('money', () => {
    it('formats minor units as a major-unit string with 2 decimals', () => {
        expect(formatMinor(96000)).toBe('960.00');
        expect(formatMinor(2550)).toBe('25.50');
        expect(formatMinor(0)).toBe('0.00');
    });
    it('parses major units (number or string) to minor units, refusing junk', () => {
        expect(toMinor(960)).toBe(96000);
        expect(toMinor('25.5')).toBe(2550);
        expect(toMinor('25.50')).toBe(2550);
        expect(toMinor('0.1')).toBe(10);
        expect(toMinor('abc')).toBeNull();
        expect(toMinor(-1)).toBeNull();
        expect(toMinor('1.234')).toBeNull();
    });
});

describe('isValidCoordinate', () => {
    it('accepts real coordinates and refuses out-of-range or non-finite values', () => {
        expect(isValidCoordinate(5.6, -0.18)).toBe(true);
        expect(isValidCoordinate(91, 0)).toBe(false);
        expect(isValidCoordinate(0, 181)).toBe(false);
        expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
    });
});
