import { describe, it, expect } from 'vitest';
import {
    DEFAULT_RIDE_SETTINGS, parseFares, toSettingsView, settingsPatchSchema, patchToData, resolveSettings, checkFareSchedules, packageSchedule, paygSchedule,
} from './settings.js';

describe('parseFares', () => {
    it('reads valid tiers sorted ascending', () => {
        expect(parseFares([{ upToKm: 10, fareMinor: 3500 }, { upToKm: 6, fareMinor: 2500 }])).toEqual([
            { upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 },
        ]);
    });
    it('falls back to the defaults on junk (never trusts the JSON)', () => {
        expect(parseFares('nope')).toEqual(DEFAULT_RIDE_SETTINGS.paygFares);
        expect(parseFares([{ upToKm: -1, fareMinor: 1 }])).toEqual(DEFAULT_RIDE_SETTINGS.paygFares);
        expect(parseFares(null)).toEqual(DEFAULT_RIDE_SETTINGS.paygFares);
    });
    it('falls back to the given defaults (package fares)', () => {
        expect(parseFares('nope', DEFAULT_RIDE_SETTINGS.packageFares)).toEqual([{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }]);
    });
});

describe('resolveSettings', () => {
    it('uses the defaults when the tenant has no row', () => {
        const s = resolveSettings(null);
        expect(s).toMatchObject({ packagePriceMinor: 96000, packageRides: 60, validityDays: 60, maxKm: 6, foundingCap: 50, holdMinutes: 30, paygDailyLimit: 10, roadFactor: 1.3, timezone: 'Africa/Accra', currency: 'GHS' });
        expect(s).toMatchObject({
            fareRef: null,
            paygFares: [{ upToKm: 6, fareMinor: 2500 }, { upToKm: 10, fareMinor: 3500 }], paygOverFareMinor: 5000,
            packageFares: [{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }], packageOverFareMinor: 4000,
        });
    });
    it('reads the fare reference point only when all three columns are valid', () => {
        const row = { ...DEFAULT_RIDE_SETTINGS, fareRefLabel: 'Student Plaza', fareRefLat: 5.62, fareRefLng: -0.17, packageFares: DEFAULT_RIDE_SETTINGS.packageFares, paygFares: DEFAULT_RIDE_SETTINGS.paygFares } as any;
        expect(resolveSettings(row).fareRef).toEqual({ label: 'Student Plaza', lat: 5.62, lng: -0.17 });
        expect(resolveSettings({ ...row, fareRefLat: null }).fareRef).toBeNull();
        expect(resolveSettings({ ...row, fareRefLat: 123 }).fareRef).toBeNull();
    });
    it('builds the two fare schedules', () => {
        const s = resolveSettings(null);
        expect(packageSchedule(s)).toEqual({ tiers: s.packageFares, overFareMinor: 4000 });
        expect(paygSchedule(s)).toEqual({ tiers: s.paygFares, overFareMinor: 5000 });
    });
    it('falls back to UTC for an unknown timezone', () => {
        expect(resolveSettings({ ...DEFAULT_RIDE_SETTINGS, timezone: 'Mars/Base' } as any).timezone).toBe('UTC');
    });
});

describe('toSettingsView (console contract shape)', () => {
    it('renders money as major-unit strings and the documented keys', () => {
        const v = toSettingsView(resolveSettings(null));
        expect(v).toEqual({
            currency: 'GHS',
            fareRef: null,
            package: {
                price: '960.00', days: 60, cap: 50, holdMinutes: 30,
                fares: [{ upToKm: 6, amount: '16.00' }, { upToKm: 10, amount: '25.00' }], overFare: '40.00',
                // Legacy (ride-count packages), kept for the console still deployed during the rollout.
                rides: 60, maxKm: 6,
                thanksUrl: null,
            },
            payg: { open: true, dailyLimit: 10, fares: [{ upToKm: 6, amount: '25.00' }, { upToKm: 10, amount: '35.00' }], overFare: '50.00', thanksUrl: null },
            roadFactor: 1.3,
            driverSms: false,
            timezone: 'Africa/Accra',
        });
    });
    it('shows the reference point and a null (not offered) over fare', () => {
        const v = toSettingsView({ ...resolveSettings(null), fareRef: { label: 'Plaza', lat: 5.6, lng: -0.1 }, paygOverFareMinor: null });
        expect(v.fareRef).toEqual({ label: 'Plaza', lat: 5.6, lng: -0.1 });
        expect(v.payg.overFare).toBeNull();
    });
});

describe('settingsPatchSchema / patchToData', () => {
    it('accepts a partial nested patch and maps it to columns (money in minor units)', () => {
        const patch = settingsPatchSchema.parse({ package: { price: '1000', cap: 40 }, payg: { open: false, fares: [{ upToKm: 6, amount: 30 }] }, driverSms: true });
        expect(patchToData(patch)).toEqual({ packagePriceMinor: 100000, foundingCap: 40, paygOpen: false, paygFares: [{ upToKm: 6, fareMinor: 3000 }], driverSms: true });
    });
    it('maps the fare reference point, package fares and over fares', () => {
        const patch = settingsPatchSchema.parse({
            fareRef: { label: ' Student Plaza ', lat: 5.62, lng: -0.17 },
            package: { fares: [{ upToKm: 10, amount: '25' }, { upToKm: 6, amount: 16 }], overFare: '40' },
            payg: { overFare: null },
        });
        expect(patchToData(patch)).toEqual({
            fareRefLabel: 'Student Plaza', fareRefLat: 5.62, fareRefLng: -0.17,
            packageFares: [{ upToKm: 6, fareMinor: 1600 }, { upToKm: 10, fareMinor: 2500 }], packageOverFareMinor: 4000,
            paygOverFareMinor: null,
        });
        expect(patchToData(settingsPatchSchema.parse({ fareRef: null }))).toEqual({ fareRefLabel: null, fareRefLat: null, fareRefLng: null });
    });
    it('thank-you URLs: https only, max 500 chars, null clears', () => {
        const patch = settingsPatchSchema.parse({ package: { thanksUrl: 'https://turbo.example/thanks' }, payg: { thanksUrl: ' https://turbo.example/ride?x=1 ' } });
        expect(patchToData(patch)).toEqual({ packageThanksUrl: 'https://turbo.example/thanks', rideThanksUrl: 'https://turbo.example/ride?x=1' });
        expect(patchToData(settingsPatchSchema.parse({ package: { thanksUrl: null }, payg: { thanksUrl: null } }))).toEqual({ packageThanksUrl: null, rideThanksUrl: null });
        expect(() => settingsPatchSchema.parse({ package: { thanksUrl: 'http://turbo.example/thanks' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ package: { thanksUrl: 'javascript:alert(1)' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ payg: { thanksUrl: 'not a url' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ payg: { thanksUrl: `https://turbo.example/${'a'.repeat(500)}` } })).toThrow();
        expect(() => settingsPatchSchema.parse({ payg: { thanksUrl: '' } })).toThrow();
    });
    it('thank-you URLs are read back only when still a valid https URL, and shown in the view', () => {
        const row = { ...DEFAULT_RIDE_SETTINGS, packageFares: DEFAULT_RIDE_SETTINGS.packageFares, paygFares: DEFAULT_RIDE_SETTINGS.paygFares } as any;
        const s = resolveSettings({ ...row, packageThanksUrl: 'https://turbo.example/p', rideThanksUrl: 'http://bad.example' });
        expect(s.packageThanksUrl).toBe('https://turbo.example/p');
        expect(s.rideThanksUrl).toBeNull();
        expect(toSettingsView(s).package.thanksUrl).toBe('https://turbo.example/p');
        expect(toSettingsView(s).payg.thanksUrl).toBeNull();
    });
    it('accepts and ignores the legacy package.rides / package.maxKm for one release', () => {
        const patch = settingsPatchSchema.parse({ package: { rides: 60, maxKm: 6, cap: 40 } });
        expect(patchToData(patch)).toEqual({ foundingCap: 40 });
    });
    it('checkFareSchedules: an over fare below the last tier is refused', () => {
        const s = resolveSettings(null);
        expect(checkFareSchedules(s)).toBeNull();
        expect(checkFareSchedules({ ...s, packageOverFareMinor: 2400 })).toMatch(/package/i);
        expect(checkFareSchedules({ ...s, paygOverFareMinor: 3000 })).toMatch(/payg/i);
        expect(checkFareSchedules({ ...s, paygOverFareMinor: 3500, packageOverFareMinor: null })).toBeNull();
    });
    it('refuses nonsense', () => {
        expect(() => settingsPatchSchema.parse({ fareRef: { label: '', lat: 5, lng: 0 } })).toThrow();
        expect(() => settingsPatchSchema.parse({ fareRef: { label: 'x', lat: 91, lng: 0 } })).toThrow();
        expect(() => settingsPatchSchema.parse({ package: { overFare: '-1' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ package: { fares: [] } })).toThrow();
        expect(() => settingsPatchSchema.parse({ package: { price: '-5' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ payg: { fares: [] } })).toThrow();
        expect(() => settingsPatchSchema.parse({ payg: { fares: [{ upToKm: 6, amount: 25 }, { upToKm: 6, amount: 30 }] } })).toThrow();
        expect(() => settingsPatchSchema.parse({ roadFactor: 9 })).toThrow();
        // A long hold lets a few phone numbers sit on every slot without paying.
        expect(() => settingsPatchSchema.parse({ package: { holdMinutes: 61 } })).toThrow();
        expect(settingsPatchSchema.parse({ package: { holdMinutes: 60 } })).toBeTruthy();
        expect(() => settingsPatchSchema.parse({ timezone: 'Not/AZone' })).toThrow();
        expect(() => settingsPatchSchema.parse({ unknown: 1 })).toThrow();
        expect(() => settingsPatchSchema.parse({})).toThrow();
    });
});
