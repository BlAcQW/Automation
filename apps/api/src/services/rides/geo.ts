/**
 * Pure helpers for the rides pack: distance, eligibility, fares and money.
 *
 * Distance is the straight line (haversine) times the tenant's road factor
 * (default 1.3). No maps API: it costs nothing and is good enough to decide
 * "is this a 0-6 km trip" for a campus ride service.
 */

export interface LatLng {
    lat: number;
    lng: number;
}

export interface FareTier {
    upToKm: number;
    fareMinor: number;
}

const EARTH_RADIUS_KM = 6371.0088;
/** A factor outside this range is a typo; the distance falls back to the straight line. */
const MAX_ROAD_FACTOR = 5;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function isValidCoordinate(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function haversineKm(a: LatLng, b: LatLng): number {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance in km, rounded to 2 decimals. */
export function roadDistanceKm(a: LatLng, b: LatLng, roadFactor: number): number {
    const factor = Number.isFinite(roadFactor) && roadFactor > 0 && roadFactor <= MAX_ROAD_FACTOR ? roadFactor : 1;
    return Math.round(haversineKm(a, b) * factor * 100) / 100;
}

export function packageEligible(distanceKm: number, maxKm: number): boolean {
    return distanceKm <= maxKm;
}

/** Fare for a PAYG trip, or null when no tier covers it (not offered). */
export function paygFareMinor(distanceKm: number, tiers: readonly FareTier[]): number | null {
    const sorted = [...tiers].sort((x, y) => x.upToKm - y.upToKm);
    const tier = sorted.find((t) => distanceKm <= t.upToKm);
    return tier ? tier.fareMinor : null;
}

/** 96000 -> "960.00" */
export function formatMinor(minor: number): string {
    return (minor / 100).toFixed(2);
}

/** Major units (960, "25.5") -> minor units; null for junk, negatives or more than 2 decimals. */
export function toMinor(major: number | string): number | null {
    const text = typeof major === 'number' ? (Number.isFinite(major) ? String(major) : '') : major.trim();
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
    const [whole, frac = ''] = text.split('.');
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
