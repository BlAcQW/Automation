import { describe, it, expect, vi, beforeEach } from 'vitest';
import fp from 'fastify-plugin';

const events: string[] = [];
const taskStop = vi.fn(async () => { events.push('tasks-stopped'); });
const startTasks = vi.fn(async (_ctx: any) => { events.push('tasks-started'); return { stop: taskStop }; });
const uninstallDispatcher = vi.fn(() => events.push('dispatcher-off'));
const installDeliveryDispatcher = vi.fn((_c?: unknown) => uninstallDispatcher);

vi.mock('./background/tasks.js', () => ({
    startTasks: (ctx: any) => startTasks(ctx),
    installDeliveryDispatcher: (c: any) => installDeliveryDispatcher(c),
}));

const uninstallForwarder = vi.fn(() => events.push('forwarder-off'));
const installRealtimeForwarder = vi.fn((_r?: unknown) => uninstallForwarder);
vi.mock('./background/realtime-bridge.js', () => ({
    installRealtimeForwarder: (r: any) => installRealtimeForwarder(r),
}));

const fakeRedis = { publish: vi.fn(), ping: vi.fn() };
vi.mock('./plugins/prisma.js', () => ({
    default: fp(async (f: any) => { f.decorate('prisma', { fake: true }); }, { name: 'prisma' }),
}));
vi.mock('./plugins/redis.js', () => ({
    default: fp(async (f: any) => {
        f.decorate('redis', fakeRedis);
        f.decorate('queues', { inbound: { add: vi.fn() }, webhooks: { add: vi.fn() } });
        f.decorate('hasRedis', true);
    }, { name: 'redis' }),
}));
vi.mock('./routes/whatsapp/index.js', () => ({ default: async () => undefined, processWebhook: vi.fn(async () => undefined) }));
const registerExternal = vi.fn();
const registerFlow = vi.fn();
vi.mock('./services/external-app.js', () => ({ registerExternalAppFulfiller: () => registerExternal() }));
vi.mock('./services/flow-payments.js', () => ({ registerFlowPaymentFulfiller: () => registerFlow() }));

import { startWorker } from './worker.js';

beforeEach(() => { events.length = 0; vi.clearAllMocks(); });

describe('startWorker', () => {
    it('starts background tasks with prisma + queues, and never opens a listener', async () => {
        const w = await startWorker({ redisUrl: 'redis://x' });
        expect(startTasks).toHaveBeenCalledOnce();
        const ctx = startTasks.mock.calls[0][0];
        expect(ctx.prisma).toEqual({ fake: true });
        expect(ctx.queues.inbound).toBeTruthy();
        expect(ctx.redisUrl).toBe('redis://x');
        expect(typeof ctx.processWebhook).toBe('function');
        expect(w.app.server.listening).toBe(false);
        await w.stop();
    });

    it('registers the payment fulfillers the flow engine needs, the event dispatcher, and the realtime forwarder', async () => {
        const w = await startWorker({ redisUrl: 'redis://x' });
        expect(registerExternal).toHaveBeenCalled();
        expect(registerFlow).toHaveBeenCalled();
        expect(installDeliveryDispatcher).toHaveBeenCalled();
        expect(installRealtimeForwarder).toHaveBeenCalledWith(fakeRedis);
        await w.stop();
    });

    it('stop() tears down in order: tasks first (drain), then wiring', async () => {
        const w = await startWorker({ redisUrl: 'redis://x' });
        events.length = 0;
        await w.stop();
        expect(events[0]).toBe('tasks-stopped');
        expect(events).toEqual(expect.arrayContaining(['dispatcher-off', 'forwarder-off']));
    });

    it('refuses to boot without Redis', async () => {
        await expect(startWorker({ redisUrl: undefined })).rejects.toThrow(/REDIS_URL/);
        expect(startTasks).not.toHaveBeenCalled();
    });
});
