import { describe, it, expect, vi } from 'vitest';
import { startTasks, BACKGROUND_TASKS, type BackgroundContext, type BackgroundTask } from './tasks.js';

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const ctx = { log: log() } as unknown as BackgroundContext;

describe('startTasks', () => {
    it('starts every task and stops them in reverse order', async () => {
        const order: string[] = [];
        const mk = (name: string): BackgroundTask => ({
            name,
            start: () => { order.push(`start:${name}`); return async () => { order.push(`stop:${name}`); }; },
        });
        const run = await startTasks(ctx, [mk('a'), mk('b')]);
        await run.stop();
        expect(order).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a']);
    });

    it('accepts a task that has nothing to stop (null)', async () => {
        const run = await startTasks(ctx, [{ name: 'noop', start: () => null }]);
        await expect(run.stop()).resolves.toBeUndefined();
    });

    it('stops already-started tasks and rethrows when a later task fails to start', async () => {
        const stopA = vi.fn();
        await expect(
            startTasks(ctx, [
                { name: 'a', start: () => stopA },
                { name: 'b', start: () => { throw new Error('nope'); } },
            ]),
        ).rejects.toThrow(/b.*nope/);
        expect(stopA).toHaveBeenCalledOnce();
    });

    it('one task failing to stop does not prevent the others', async () => {
        const stopA = vi.fn();
        const run = await startTasks(ctx, [
            { name: 'a', start: () => stopA },
            { name: 'b', start: () => async () => { throw new Error('x'); } },
        ]);
        await run.stop();
        expect(stopA).toHaveBeenCalled();
    });

    it('refuses duplicate task names', async () => {
        await expect(
            startTasks(ctx, [{ name: 'a', start: () => null }, { name: 'a', start: () => null }]),
        ).rejects.toThrow(/duplicate/i);
    });
});

describe('BACKGROUND_TASKS registry', () => {
    it('has unique names and covers today\'s background work', () => {
        const names = BACKGROUND_TASKS.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual(expect.arrayContaining([
            'notification-workers', 'hold-expiry-sweeper', 'order-expiry-sweeper', 'inbound-worker', 'inbound-sweeper', 'webhook-worker', 'webhook-sweeper', 'ride-sweeper',
        ]));
    });
});
