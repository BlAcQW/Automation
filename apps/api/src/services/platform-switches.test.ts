import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isPayoutsPaused,
    isOutboundPaused,
    setTenantSwitch,
    setPlatformSwitch,
    getPlatformSetting,
    getPlatformSwitches,
    clearSwitchCache,
    combineSwitch,
    resolveOutboundPause,
    SwitchError,
    SWITCH_CACHE_MS,
} from './platform-switches.js';

function stub(tenant: any, settings: Record<string, unknown> = {}) {
    const state = { tenant: tenant ? { ...tenant } : null, settings: { ...settings } };
    return {
        state,
        tenant: {
            findUnique: vi.fn(async () => state.tenant),
            update: vi.fn(async ({ data }: any) => { state.tenant = { ...state.tenant, ...data }; return state.tenant; }),
        },
        platformSetting: {
            findUnique: vi.fn(async ({ where }: any) => (where.key in state.settings ? { value: state.settings[where.key] } : null)),
            upsert: vi.fn(async ({ where, create, update }: any) => {
                state.settings[where.key] = (where.key in state.settings ? update : create).value;
                return {};
            }),
        },
    } as any;
}

beforeEach(() => clearSwitchCache());

describe('isPayoutsPaused / isOutboundPaused', () => {
    it('not paused by default', async () => {
        const p = stub({ outboundPausedAt: null, payoutsPausedAt: null, pauseReason: null });
        expect(await isPayoutsPaused(p, 't1')).toEqual({ paused: false });
        expect(await isOutboundPaused(p, 't1')).toEqual({ paused: false });
    });

    it('a tenant timestamp pauses only its own switch, with the reason', async () => {
        const p = stub({ outboundPausedAt: null, payoutsPausedAt: new Date(), pauseReason: 'chargeback review' });
        expect(await isPayoutsPaused(p, 't1')).toEqual({ paused: true, reason: 'chargeback review' });
        expect(await isOutboundPaused(p, 't1')).toEqual({ paused: false });
    });

    it('the platform-wide key pauses every tenant', async () => {
        const p = stub(
            { outboundPausedAt: null, payoutsPausedAt: null },
            { 'payouts.paused': { paused: true, reason: 'Paystack incident' }, 'outbound.paused': { paused: true } },
        );
        expect(await isPayoutsPaused(p, 't1')).toEqual({ paused: true, reason: 'Paystack incident' });
        expect(await isOutboundPaused(p, 't1')).toEqual({ paused: true, reason: 'Paused platform-wide' });
    });

    it('a platform setting with paused:false is not a pause', async () => {
        const p = stub({}, { 'payouts.paused': { paused: false, reason: 'old' } });
        expect(await isPayoutsPaused(p, 't1')).toEqual({ paused: false });
    });

    it('an unknown tenant is not paused (the caller fails on its own)', async () => {
        expect(await isPayoutsPaused(stub(null), 'nope')).toEqual({ paused: false });
    });

    it('payouts: a failed settings read propagates (never pay out unsure)', async () => {
        const p = stub({});
        p.platformSetting.findUnique.mockRejectedValue(new Error('db down'));
        await expect(isPayoutsPaused(p, 't1')).rejects.toThrow('db down');
    });

    it('outbound: a failed settings read does not stop messaging', async () => {
        const p = stub({});
        p.platformSetting.findUnique.mockRejectedValue(new Error('db down'));
        expect(await isOutboundPaused(p, 't1')).toEqual({ paused: false });
    });
});

describe('platform setting cache', () => {
    it('serves repeated reads from memory within the window and refreshes after it', async () => {
        const p = stub({}, { 'outbound.paused': { paused: false } });
        await getPlatformSetting(p, 'outbound.paused', 1000);
        await getPlatformSetting(p, 'outbound.paused', 1000 + SWITCH_CACHE_MS - 1);
        expect(p.platformSetting.findUnique).toHaveBeenCalledTimes(1);
        await getPlatformSetting(p, 'outbound.paused', 1000 + SWITCH_CACHE_MS);
        expect(p.platformSetting.findUnique).toHaveBeenCalledTimes(2);
    });

    it('the window is at most 30 seconds', () => {
        expect(SWITCH_CACHE_MS).toBeLessThanOrEqual(30_000);
    });

    it('a local platform pause takes effect immediately, not after the cache expires', async () => {
        const p = stub({ outboundPausedAt: null }, {});
        expect((await isOutboundPaused(p, 't1')).paused).toBe(false);
        await setPlatformSwitch(p, 'outbound', true, 'carrier outage', 'admin-1');
        expect(await isOutboundPaused(p, 't1')).toEqual({ paused: true, reason: 'carrier outage' });
        await setPlatformSwitch(p, 'outbound', false, undefined, 'admin-1');
        expect((await isOutboundPaused(p, 't1')).paused).toBe(false);
    });

    it('caches per client, so one test/process client never sees another', async () => {
        const a = stub({}, { 'outbound.paused': { paused: true } });
        const b = stub({}, {});
        expect((await isOutboundPaused(a, 't')).paused).toBe(true);
        expect((await isOutboundPaused(b, 't')).paused).toBe(false);
    });
});

describe('setTenantSwitch', () => {
    const now = new Date('2026-10-06T10:00:00Z');

    it('requires a reason to pause, but not to resume', async () => {
        const p = stub({ outboundPausedAt: null, payoutsPausedAt: null });
        await expect(setTenantSwitch(p, 't1', 'outbound', true, '  ')).rejects.toBeInstanceOf(SwitchError);
        await expect(setTenantSwitch(p, 't1', 'outbound', true, undefined)).rejects.toBeInstanceOf(SwitchError);
        expect(p.tenant.update).not.toHaveBeenCalled();
        await expect(setTenantSwitch(p, 't1', 'outbound', false)).resolves.toBe(true);
    });

    it('pauses with timestamp + reason, and keeps the original timestamp when paused twice', async () => {
        const p = stub({ outboundPausedAt: null, payoutsPausedAt: null });
        await setTenantSwitch(p, 't1', 'outbound', true, 'spam complaints', now);
        expect(p.state.tenant).toMatchObject({ outboundPausedAt: now, pauseReason: 'spam complaints' });
        await setTenantSwitch(p, 't1', 'outbound', true, 'still spam', new Date('2026-10-06T12:00:00Z'));
        expect(p.state.tenant.outboundPausedAt).toEqual(now);
        expect(p.state.tenant.pauseReason).toBe('still spam');
    });

    it('resuming one switch keeps the reason while the other is still paused, clears it when none is', async () => {
        const p = stub({ outboundPausedAt: now, payoutsPausedAt: now, pauseReason: 'both' });
        await setTenantSwitch(p, 't1', 'outbound', false);
        expect(p.state.tenant).toMatchObject({ outboundPausedAt: null, pauseReason: 'both' });
        await setTenantSwitch(p, 't1', 'payouts', false);
        expect(p.state.tenant).toMatchObject({ payoutsPausedAt: null, pauseReason: null });
    });

    it('returns false for an unknown tenant and writes nothing', async () => {
        const p = stub(null);
        expect(await setTenantSwitch(p, 'nope', 'payouts', true, 'because')).toBe(false);
        expect(p.tenant.update).not.toHaveBeenCalled();
    });

    it('truncates an absurd reason', async () => {
        const p = stub({});
        await setTenantSwitch(p, 't1', 'outbound', true, 'x'.repeat(5000), now);
        expect(p.state.tenant.pauseReason).toHaveLength(300);
    });
});

describe('platform switches listing + pure helpers', () => {
    it('getPlatformSwitches reports both', async () => {
        const p = stub({}, { 'payouts.paused': { paused: true, reason: 'r' } });
        expect(await getPlatformSwitches(p)).toEqual({
            outbound: { paused: false },
            payouts: { paused: true, reason: 'r' },
        });
    });
    it('combineSwitch: platform wins over tenant for the reason', () => {
        expect(combineSwitch('payouts', { payoutsPausedAt: new Date(), pauseReason: 'tenant' }, { paused: true, reason: 'platform' }))
            .toEqual({ paused: true, reason: 'platform' });
    });
    it('resolveOutboundPause skips the settings read when the tenant itself is paused', async () => {
        const p = stub({});
        const out = await resolveOutboundPause(p, { outboundPausedAt: new Date(), pauseReason: 'x' });
        expect(out).toEqual({ paused: true, reason: 'x' });
        expect(p.platformSetting.findUnique).not.toHaveBeenCalled();
    });
});
