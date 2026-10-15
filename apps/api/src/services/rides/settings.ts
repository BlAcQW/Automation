/**
 * Per-tenant ride settings (one RideSettings row; absent = the defaults).
 * Everything the defaults table in docs/TURBO-BUILD.md calls "a setting".
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { RidesClient, RidesDb } from './db.js';
import { formatMinor, isValidCoordinate, toMinor, type FareTier } from './geo.js';
import type { FareSchedule } from './pricing.js';
import { safeZone } from '../timezone.js';

/** A long hold lets a few phone numbers sit on every slot without paying. */
export const MAX_HOLD_MINUTES = 60;

export interface FareRef {
    label: string;
    lat: number;
    lng: number;
}

export interface RideSettingsValues {
    currency: string;
    /** Where fares are measured from (decision 1). Null: from the pickup. */
    fareRef: FareRef | null;
    /** The Founding Package price = the GHS credit it buys. */
    packagePriceMinor: number;
    /** Legacy (ride-count packages): stored, unused. */
    packageRides: number;
    validityDays: number;
    /** Legacy: package rides of any distance are allowed now. */
    maxKm: number;
    packageFares: FareTier[];
    /** Beyond the last package tier; null = not offered there. */
    packageOverFareMinor: number | null;
    foundingCap: number;
    holdMinutes: number;
    paygOpen: boolean;
    paygDailyLimit: number;
    paygFares: FareTier[];
    /** Beyond the last PAYG tier; null = not offered there. */
    paygOverFareMinor: number | null;
    roadFactor: number;
    driverSms: boolean;
    timezone: string;
}

export const DEFAULT_RIDE_SETTINGS: Readonly<RideSettingsValues> = Object.freeze({
    currency: 'GHS',
    fareRef: null,
    packagePriceMinor: 96000,
    packageRides: 60,
    validityDays: 60,
    maxKm: 6,
    packageFares: [{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }],
    packageOverFareMinor: 4000,
    foundingCap: 50,
    holdMinutes: 30,
    paygOpen: true,
    paygDailyLimit: 10,
    paygFares: [{ upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 }],
    paygOverFareMinor: 5000,
    roadFactor: 1.3,
    driverSms: false,
    timezone: 'Africa/Accra',
});

const fareTierSchema = z.object({
    upToKm: z.number().positive().max(500),
    fareMinor: z.number().int().positive().max(100_000_000),
});

/** The stored JSON is never trusted: anything malformed falls back to the defaults. */
export function parseFares(raw: unknown, fallback: readonly FareTier[] = DEFAULT_RIDE_SETTINGS.paygFares): FareTier[] {
    const parsed = z.array(fareTierSchema).min(1).max(10).safeParse(raw);
    if (!parsed.success) return fallback.map((t) => ({ ...t }));
    return [...parsed.data].sort((a, b) => a.upToKm - b.upToKm);
}

/** A stored over fare: a positive whole number of pesewas, else not offered. */
function overFare(raw: number | null | undefined): number | null {
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null;
}

function fareRefOf(label: string | null | undefined, lat: number | null | undefined, lng: number | null | undefined): FareRef | null {
    if (!label || typeof lat !== 'number' || typeof lng !== 'number' || !isValidCoordinate(lat, lng)) return null;
    return { label, lat, lng };
}

type SettingsRow = Omit<RideSettingsValues, 'paygFares' | 'packageFares' | 'fareRef' | 'packageOverFareMinor' | 'paygOverFareMinor'> & {
    paygFares: unknown;
    packageFares?: unknown;
    packageOverFareMinor?: number | null;
    paygOverFareMinor?: number | null;
    fareRefLabel?: string | null;
    fareRefLat?: number | null;
    fareRefLng?: number | null;
};

export function resolveSettings(row: SettingsRow | null): RideSettingsValues {
    if (!row) {
        return {
            ...DEFAULT_RIDE_SETTINGS,
            paygFares: parseFares(DEFAULT_RIDE_SETTINGS.paygFares),
            packageFares: parseFares(DEFAULT_RIDE_SETTINGS.packageFares, DEFAULT_RIDE_SETTINGS.packageFares),
        };
    }
    return {
        currency: row.currency,
        fareRef: fareRefOf(row.fareRefLabel, row.fareRefLat, row.fareRefLng),
        packagePriceMinor: row.packagePriceMinor,
        packageRides: row.packageRides,
        validityDays: row.validityDays,
        maxKm: row.maxKm,
        packageFares: parseFares(row.packageFares, DEFAULT_RIDE_SETTINGS.packageFares),
        packageOverFareMinor: row.packageOverFareMinor === undefined ? DEFAULT_RIDE_SETTINGS.packageOverFareMinor : overFare(row.packageOverFareMinor),
        foundingCap: row.foundingCap,
        holdMinutes: Math.min(row.holdMinutes, MAX_HOLD_MINUTES),
        paygOpen: row.paygOpen,
        paygDailyLimit: row.paygDailyLimit,
        paygFares: parseFares(row.paygFares),
        paygOverFareMinor: row.paygOverFareMinor === undefined ? DEFAULT_RIDE_SETTINGS.paygOverFareMinor : overFare(row.paygOverFareMinor),
        roadFactor: row.roadFactor,
        driverSms: row.driverSms,
        timezone: safeZone(row.timezone),
    };
}

export async function getRideSettings(db: RidesDb, tenantId: string): Promise<RideSettingsValues> {
    const row = await db.rideSettings.findFirst({ where: { tenantId } });
    return resolveSettings(row);
}

export function packageSchedule(s: RideSettingsValues): FareSchedule {
    return { tiers: s.packageFares, overFareMinor: s.packageOverFareMinor };
}

export function paygSchedule(s: RideSettingsValues): FareSchedule {
    return { tiers: s.paygFares, overFareMinor: s.paygOverFareMinor };
}

/** An over fare below the last tier's fare is a typo (the furthest trips would be cheapest). Null = fine. */
export function checkFareSchedules(s: RideSettingsValues): string | null {
    const check = (name: string, sch: FareSchedule) => {
        const last = [...sch.tiers].sort((a, b) => a.upToKm - b.upToKm).at(-1);
        return sch.overFareMinor !== null && last && sch.overFareMinor < last.fareMinor
            ? `${name} overFare must be at least the last tier's fare (${formatMinor(last.fareMinor)})`
            : null;
    };
    return check('package', packageSchedule(s)) ?? check('payg', paygSchedule(s));
}

const fareList = (tiers: readonly FareTier[]) => tiers.map((t) => ({ upToKm: t.upToKm, amount: formatMinor(t.fareMinor) }));
const overView = (minor: number | null) => (minor === null ? null : formatMinor(minor));

/** GET /rides/settings shape (docs/TURBO-BUILD.md, console contract). */
export function toSettingsView(s: RideSettingsValues) {
    return {
        currency: s.currency,
        fareRef: s.fareRef ? { label: s.fareRef.label, lat: s.fareRef.lat, lng: s.fareRef.lng } : null,
        package: {
            price: formatMinor(s.packagePriceMinor),
            days: s.validityDays,
            cap: s.foundingCap,
            holdMinutes: s.holdMinutes,
            fares: fareList(s.packageFares),
            overFare: overView(s.packageOverFareMinor),
            /** Legacy (ride-count packages), unused; kept for one release for the console still deployed. */
            rides: s.packageRides,
            maxKm: s.maxKm,
        },
        payg: {
            open: s.paygOpen,
            dailyLimit: s.paygDailyLimit,
            fares: fareList(s.paygFares),
            overFare: overView(s.paygOverFareMinor),
        },
        roadFactor: s.roadFactor,
        driverSms: s.driverSms,
        timezone: s.timezone,
    };
}

const money = z.union([z.number(), z.string()]).transform((v, ctx) => {
    const m = toMinor(v);
    if (m === null || m <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a positive amount with at most 2 decimals' });
        return z.NEVER;
    }
    return m;
});

const zone = z.string().min(1).max(64).refine((tz) => safeZone(tz) === tz, 'Unknown timezone');

const fares = z
    .array(z.object({ upToKm: z.number().positive().max(500), amount: money }).strict())
    .min(1)
    .max(10)
    .refine((t) => new Set(t.map((x) => x.upToKm)).size === t.length, 'Each tier needs its own upToKm');

/** null = not offered beyond the last tier. */
const overFareInput = z.union([money, z.null()]);

const fareRefInput = z
    .object({
        label: z.string().trim().min(1).max(120),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
    })
    .strict()
    .nullable();

export const settingsPatchSchema = z
    .object({
        fareRef: fareRefInput,
        package: z
            .object({
                price: money,
                days: z.number().int().min(1).max(366),
                cap: z.number().int().min(1).max(100_000),
                holdMinutes: z.number().int().min(5).max(MAX_HOLD_MINUTES),
                fares,
                overFare: overFareInput,
                /** Legacy (ride-count packages): accepted and ignored for one release. */
                rides: z.unknown(),
                maxKm: z.unknown(),
            })
            .partial()
            .strict(),
        payg: z
            .object({
                open: z.boolean(),
                dailyLimit: z.number().int().min(0).max(10_000),
                fares,
                overFare: overFareInput,
            })
            .partial()
            .strict(),
        roadFactor: z.number().min(1).max(3),
        driverSms: z.boolean(),
        timezone: zone,
    })
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

const tiersToJson = (tiers: Array<{ upToKm: number; amount: number }>) =>
    [...tiers].sort((a, b) => a.upToKm - b.upToKm).map((t) => ({ upToKm: t.upToKm, fareMinor: t.amount }));

export function patchToData(p: SettingsPatch): Prisma.RideSettingsUncheckedUpdateInput {
    const d: Prisma.RideSettingsUncheckedUpdateInput = {};
    if (p.fareRef !== undefined) {
        d.fareRefLabel = p.fareRef?.label ?? null;
        d.fareRefLat = p.fareRef?.lat ?? null;
        d.fareRefLng = p.fareRef?.lng ?? null;
    }
    if (p.package?.price !== undefined) d.packagePriceMinor = p.package.price;
    if (p.package?.days !== undefined) d.validityDays = p.package.days;
    if (p.package?.cap !== undefined) d.foundingCap = p.package.cap;
    if (p.package?.holdMinutes !== undefined) d.holdMinutes = p.package.holdMinutes;
    if (p.package?.fares !== undefined) d.packageFares = tiersToJson(p.package.fares);
    if (p.package?.overFare !== undefined) d.packageOverFareMinor = p.package.overFare;
    if (p.payg?.open !== undefined) d.paygOpen = p.payg.open;
    if (p.payg?.dailyLimit !== undefined) d.paygDailyLimit = p.payg.dailyLimit;
    if (p.payg?.fares !== undefined) d.paygFares = tiersToJson(p.payg.fares);
    if (p.payg?.overFare !== undefined) d.paygOverFareMinor = p.payg.overFare;
    if (p.roadFactor !== undefined) d.roadFactor = p.roadFactor;
    if (p.driverSms !== undefined) d.driverSms = p.driverSms;
    if (p.timezone !== undefined) d.timezone = p.timezone;
    return d;
}

export type SettingsUpdate = { ok: true; settings: RideSettingsValues } | { ok: false; message: string };

/** Rolls the settings transaction back; never leaves updateRideSettings. */
class SettingsRejected extends Error {}

/**
 * Apply a PATCH. The fare rules are checked on the RESULT (an overFare-only
 * patch is compared with the stored tiers) inside the transaction that writes,
 * so a refused patch changes nothing.
 */
export async function updateRideSettings(db: RidesClient, tenantId: string, patch: SettingsPatch): Promise<SettingsUpdate> {
    const data = patchToData(patch);
    try {
        return await db.$transaction(async (tx): Promise<SettingsUpdate> => {
            const row = await tx.rideSettings.upsert({
                where: { tenantId },
                create: { ...(data as Prisma.RideSettingsUncheckedCreateInput), tenantId },
                update: data,
            });
            const settings = resolveSettings(row);
            const problem = checkFareSchedules(settings);
            if (problem) throw new SettingsRejected(problem);
            return { ok: true, settings };
        });
    } catch (err) {
        if (err instanceof SettingsRejected) return { ok: false, message: err.message };
        throw err;
    }
}
