import { describe, it, expect } from 'vitest';
import {
    DEFAULT_RIDE_SETTINGS, parseFares, toSettingsView, settingsPatchSchema, patchToData, resolveSettings,
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
});

describe('resolveSettings', () => {
    it('uses the defaults when the tenant has no row', () => {
        const s = resolveSettings(null);
        expect(s).toMatchObject({ packagePriceMinor: 96000, packageRides: 60, validityDays: 60, maxKm: 6, foundingCap: 50, holdMinutes: 30, paygDailyLimit: 10, roadFactor: 1.3, timezone: 'Africa/Accra', currency: 'GHS' });
    });
    it('falls back to UTC for an unknown timezone', () => {
        expect(resolveSettings({ ...DEFAULT_RIDE_SETTINGS, timezone: 'Mars/Base' } as any).timezone).toBe('UTC');
    });
});

describe('toSettingsView (console contract shape)', () => {
    it('renders money as major-unit strings and the documented keys', () => {
        const v = toSettingsView(resolveSettings(null));
        expect(v).toEqual({
            package: { price: '960.00', rides: 60, days: 60, maxKm: 6, cap: 50, holdMinutes: 30 },
            payg: { open: true, dailyLimit: 10, fares: [{ upToKm: 6, amount: '25.00' }, { upToKm: 10, amount: '35.00' }] },
            roadFactor: 1.3,
            driverSms: false,
            timezone: 'Africa/Accra',
            currency: 'GHS',
        });
    });
});

describe('settingsPatchSchema / patchToData', () => {
    it('accepts a partial nested patch and maps it to columns (money in minor units)', () => {
        const patch = settingsPatchSchema.parse({ package: { price: '1000', cap: 40 }, payg: { open: false, fares: [{ upToKm: 6, amount: 30 }] }, driverSms: true });
        expect(patchToData(patch)).toEqual({ packagePriceMinor: 100000, foundingCap: 40, paygOpen: false, paygFares: [{ upToKm: 6, fareMinor: 3000 }], driverSms: true });
    });
    it('refuses nonsense', () => {
        expect(() => settingsPatchSchema.parse({ package: { price: '-5' } })).toThrow();
        expect(() => settingsPatchSchema.parse({ package: { rides: 0 } })).toThrow();
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
