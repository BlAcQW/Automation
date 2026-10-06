/**
 * What a queue worker does with a job that cannot be sent because support has
 * paused the tenant's outbound messaging.
 *
 * Not "fail and let BullMQ retry": a thrown error consumes one of the job's 5
 * attempts (exponential backoff 1, 2, 4, 8 min, about 15 min in total), so a
 * pause longer than that would exhaust the attempts and silently drop the
 * message. Instead the job is moved back to the delayed set with
 * `moveToDelayed` + `DelayedError`, which BullMQ does NOT count as an attempt.
 * It is re-checked every PAUSE_RETRY_DELAY_MS (so a reminder whose booking was
 * cancelled meanwhile is still skipped by reminderStillApplies) until the
 * total wait reaches PAUSE_MAX_TOTAL_MS, after which the job is dropped: a
 * reminder or confirmation hours late is worse than none, and an indefinitely
 * paused tenant must not accumulate immortal jobs.
 *
 * `pausedSince` is stored in the job data so the cap survives worker restarts.
 */

import { DelayedError } from 'bullmq';

export const PAUSE_RETRY_DELAY_MS = 15 * 60_000;
export const PAUSE_MAX_TOTAL_MS = 6 * 60 * 60_000;

/** The slice of a BullMQ Job this needs (structural, so it is easy to fake). */
export interface DeferrableJob {
    id?: string;
    data: object;
    updateData(data: any): Promise<void>;
    moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

/**
 * Throws DelayedError after rescheduling (the worker must let it propagate), or
 * returns 'expired' when the cap is reached and the caller should drop the job.
 */
export async function deferForPause(job: DeferrableJob, token: string | undefined, now: number = Date.now()): Promise<'expired'> {
    const raw = (job.data as { pausedSince?: unknown }).pausedSince;
    const since = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

    if (since !== null && now - since >= PAUSE_MAX_TOTAL_MS) return 'expired';

    if (since === null) await job.updateData({ ...job.data, pausedSince: now });

    const deadline = (since ?? now) + PAUSE_MAX_TOTAL_MS;
    await job.moveToDelayed(Math.min(now + PAUSE_RETRY_DELAY_MS, deadline), token);
    throw new DelayedError();
}
