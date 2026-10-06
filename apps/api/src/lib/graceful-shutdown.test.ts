import { describe, it, expect, vi } from 'vitest';
import { createShutdown } from './graceful-shutdown.js';

const log = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() });

describe('createShutdown', () => {
    it('runs steps in order, then exits 0', async () => {
        const order: string[] = [];
        const exit = vi.fn();
        const shutdown = createShutdown({
            log: log(),
            exit,
            steps: [
                { name: 'a', run: async () => { order.push('a'); } },
                { name: 'b', run: () => { order.push('b'); } },
            ],
        });
        await shutdown('SIGTERM');
        expect(order).toEqual(['a', 'b']);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('keeps going when a step throws, and exits 1', async () => {
        const order: string[] = [];
        const exit = vi.fn();
        const l = log();
        const shutdown = createShutdown({
            log: l,
            exit,
            steps: [
                { name: 'a', run: async () => { throw new Error('boom'); } },
                { name: 'b', run: () => { order.push('b'); } },
            ],
        });
        await shutdown('SIGINT');
        expect(order).toEqual(['b']);
        expect(l.error).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('ignores a second signal while shutting down', async () => {
        const exit = vi.fn();
        const run = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); });
        const shutdown = createShutdown({ log: log(), exit, steps: [{ name: 'a', run }] });
        await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
        expect(run).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it('forces exit 1 when a step hangs past the timeout', async () => {
        vi.useFakeTimers();
        try {
            const exit = vi.fn();
            const shutdown = createShutdown({
                log: log(),
                exit,
                timeoutMs: 1000,
                steps: [{ name: 'hang', run: () => new Promise<void>(() => undefined) }],
            });
            void shutdown('SIGTERM');
            await vi.advanceTimersByTimeAsync(1001);
            expect(exit).toHaveBeenCalledWith(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
