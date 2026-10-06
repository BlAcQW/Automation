import { describe, it, expect, vi } from 'vitest';
import { DelayedError } from 'bullmq';
import { deferForPause, PAUSE_RETRY_DELAY_MS, PAUSE_MAX_TOTAL_MS } from './pause-defer.js';

const NOW = 1_800_000_000_000;
function job(data: Record<string, unknown> = {}) {
    const j = {
        id: 'j1', data,
        updateData: vi.fn(async (d: any) => { j.data = d; }),
        moveToDelayed: vi.fn(async () => undefined),
    };
    return j;
}

describe('deferForPause', () => {
    it('first pause: stamps pausedSince, delays the job by the retry delay without failing it, throws DelayedError', async () => {
        const j = job({ tenantId: 't1' });
        await expect(deferForPause(j as any, 'tok', NOW)).rejects.toBeInstanceOf(DelayedError);
        expect(j.updateData).toHaveBeenCalledWith({ tenantId: 't1', pausedSince: NOW });
        expect(j.moveToDelayed).toHaveBeenCalledWith(NOW + PAUSE_RETRY_DELAY_MS, 'tok');
    });

    it('keeps the original pausedSince on later deferrals', async () => {
        const j = job({ pausedSince: NOW - 3_600_000 });
        await expect(deferForPause(j as any, 'tok', NOW)).rejects.toBeInstanceOf(DelayedError);
        expect(j.updateData).not.toHaveBeenCalled();
        expect(j.moveToDelayed).toHaveBeenCalledWith(NOW + PAUSE_RETRY_DELAY_MS, 'tok');
    });

    it('gives up (returns expired, does not delay) once the total delay cap is reached', async () => {
        const j = job({ pausedSince: NOW - PAUSE_MAX_TOTAL_MS });
        expect(await deferForPause(j as any, 'tok', NOW)).toBe('expired');
        expect(j.moveToDelayed).not.toHaveBeenCalled();
    });

    it('never schedules a retry past the cap', async () => {
        const j = job({ pausedSince: NOW - PAUSE_MAX_TOTAL_MS + 60_000 });
        await expect(deferForPause(j as any, 'tok', NOW)).rejects.toBeInstanceOf(DelayedError);
        // 1 minute of budget left: wake up then (to drop it), not 15 minutes later.
        expect(j.moveToDelayed).toHaveBeenCalledWith(NOW + 60_000, 'tok');
    });

    it('treats a corrupt pausedSince as a first pause', async () => {
        const j = job({ pausedSince: 'yesterday' });
        await expect(deferForPause(j as any, 'tok', NOW)).rejects.toBeInstanceOf(DelayedError);
        expect(j.updateData).toHaveBeenCalledWith({ pausedSince: NOW });
    });
});
