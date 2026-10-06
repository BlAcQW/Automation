/**
 * Per-tenant ride settings (one RideSettings row; absent = the defaults).
 * Everything the defaults table in docs/TURBO-BUILD.md calls "a setting".
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { RidesDb } from './db.js';
import { formatMinor, toMinor, type FareTier } from './geo.js';
import { safeZone } from '../timezone.js';

/** A long hold lets a few phone numbers sit on every slot without paying. */
export const MAX_HOLD_MINUTES = 60;

export interface RideSettingsValues {
    currency: string;
    packagePriceMinor: number;
    packageRides: number;
    validityDays: number;
    maxKm: number;
    foundingCap: number;
    holdMinutes: number;
    paygOpen: boolean;
    paygDailyLimit: number;
    paygFares: FareTier[];
    roadFactor: number;
    driverSms: boolean;
    timezone: string;
}

export const DEFAULT_RIDE_SETTINGS: Readonly<RideSettingsValues> = Object.freeze({
    currency: 'GHS',
    packagePriceMinor: 96000,
    packageRides: 60,
    validityDays: 60,
    maxKm: 6,
    foundingCap: 50,
    holdMinutes: 30,
    paygOpen: true,
    paygDailyLimit: 10,
    paygFares: [{ upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 }],
    roadFactor: 1.3,
    driverSms: false,
    timezone: 'Africa/Accra',
});

const fareTierSchema = z.object({
    upToKm: z.number().positive().max(500),
    fareMinor: z.number().int().positive().max(100_000_000),
});

/** The stored JSON is never trusted: anything malformed falls back to the defaults. */
export function parseFares(raw: unknown): FareTier[] {
    const parsed = z.array(fareTierSchema).min(1).max(10).safeParse(raw);
    if (!parsed.success) return DEFAULT_RIDE_SETTINGS.paygFares.map((t) => ({ ...t }));
    return [...parsed.data].sort((a, b) => a.upToKm - b.upToKm);
}

type SettingsRow = Omit<RideSettingsValues, 'paygFares'> & { paygFares: unknown };

export function resolveSettings(row: SettingsRow | null): RideSettingsValues {
    if (!row) return { ...DEFAULT_RIDE_SETTINGS, paygFares: parseFares(DEFAULT_RIDE_SETTINGS.paygFares) };
    return {
        currency: row.currency,
        packagePriceMinor: row.packagePriceMinor,
        packageRides: row.packageRides,
        validityDays: row.validityDays,
        maxKm: row.maxKm,
        foundingCap: row.foundingCap,
        holdMinutes: Math.min(row.holdMinutes, MAX_HOLD_MINUTES),
        paygOpen: row.paygOpen,
        paygDailyLimit: row.paygDailyLimit,
        paygFares: parseFares(row.paygFares),
        roadFactor: row.roadFactor,
        driverSms: row.driverSms,
        timezone: safeZone(row.timezone),
    };
}

export async function getRideSettings(db: RidesDb, tenantId: string): Promise<RideSettingsValues> {
    const row = await db.rideSettings.findFirst({ where: { tenantId } });
    return resolveSettings(row);
}

/** GET /rides/settings shape. */
export function toSettingsView(s: RideSettingsValues) {
    return {
        package: {
            price: formatMinor(s.packagePriceMinor),
            rides: s.packageRides,
            days: s.validityDays,
            maxKm: s.maxKm,
            cap: s.foundingCap,
            holdMinutes: s.holdMinutes,
        },
        payg: {
            open: s.paygOpen,
            dailyLimit: s.paygDailyLimit,
            fares: s.paygFares.map((t) => ({ upToKm: t.upToKm, amount: formatMinor(t.fareMinor) })),
        },
        roadFactor: s.roadFactor,
        driverSms: s.driverSms,
        timezone: s.timezone,
        currency: s.currency,
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

export const settingsPatchSchema = z
    .object({
        package: z
            .object({
                price: money,
                rides: z.number().int().min(1).max(1000),
                days: z.number().int().min(1).max(366),
                maxKm: z.number().positive().max(200),
                cap: z.number().int().min(1).max(100_000),
                holdMinutes: z.number().int().min(5).max(MAX_HOLD_MINUTES),
            })
            .partial()
            .strict(),
        payg: z
            .object({
                open: z.boolean(),
                dailyLimit: z.number().int().min(0).max(10_000),
                fares: z
                    .array(z.object({ upToKm: z.number().positive().max(500), amount: money }).strict())
                    .min(1)
                    .max(10)
                    .refine((t) => new Set(t.map((x) => x.upToKm)).size === t.length, 'Each tier needs its own upToKm'),
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

export function patchToData(p: SettingsPatch): Prisma.RideSettingsUncheckedUpdateInput {
    const d: Prisma.RideSettingsUncheckedUpdateInput = {};
    if (p.package?.price !== undefined) d.packagePriceMinor = p.package.price;
    if (p.package?.rides !== undefined) d.packageRides = p.package.rides;
    if (p.package?.days !== undefined) d.validityDays = p.package.days;
    if (p.package?.maxKm !== undefined) d.maxKm = p.package.maxKm;
    if (p.package?.cap !== undefined) d.foundingCap = p.package.cap;
    if (p.package?.holdMinutes !== undefined) d.holdMinutes = p.package.holdMinutes;
    if (p.payg?.open !== undefined) d.paygOpen = p.payg.open;
    if (p.payg?.dailyLimit !== undefined) d.paygDailyLimit = p.payg.dailyLimit;
    if (p.payg?.fares !== undefined) {
        d.paygFares = [...p.payg.fares].sort((a, b) => a.upToKm - b.upToKm).map((t) => ({ upToKm: t.upToKm, fareMinor: t.amount }));
    }
    if (p.roadFactor !== undefined) d.roadFactor = p.roadFactor;
    if (p.driverSms !== undefined) d.driverSms = p.driverSms;
    if (p.timezone !== undefined) d.timezone = p.timezone;
    return d;
}

export async function updateRideSettings(db: RidesDb, tenantId: string, patch: SettingsPatch): Promise<RideSettingsValues> {
    const data = patchToData(patch);
    const row = await db.rideSettings.upsert({
        where: { tenantId },
        create: { ...(data as Prisma.RideSettingsUncheckedCreateInput), tenantId },
        update: data,
    });
    return resolveSettings(row);
}
