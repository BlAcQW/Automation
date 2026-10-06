import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerClient, publish, setRealtimeForwarder } from '../services/realtime.js';
import { REALTIME_CHANNEL, installRealtimeForwarder, startRealtimeSubscriber } from './realtime-bridge.js';

afterEach(() => setRealtimeForwarder(null));

describe('realtime forwarder hook', () => {
    it('still delivers locally and also forwards when a forwarder is set', () => {
        const send = vi.fn();
        const forward = vi.fn();
        const off = registerClient('t1', { send });
        setRealtimeForwarder(forward);
        publish('t1', { type: 'booking' });
        expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'booking' }));
        expect(forward).toHaveBeenCalledWith('t1', { type: 'booking' });
        off();
    });

    it('forwards even with no local clients (the worker case)', () => {
        const forward = vi.fn();
        setRealtimeForwarder(forward);
        publish('nobody-here', { type: 'notification' });
        expect(forward).toHaveBeenCalledOnce();
    });

    it('a throwing forwarder never breaks publish', () => {
        const send = vi.fn();
        const off = registerClient('t2', { send });
        setRealtimeForwarder(() => { throw new Error('redis down'); });
        expect(() => publish('t2', { type: 'conversation' })).not.toThrow();
        expect(send).toHaveBeenCalled();
        off();
    });
});

describe('installRealtimeForwarder', () => {
    it('publishes {tenantId,event} JSON on the shared channel and can be removed', () => {
        const redis = { publish: vi.fn(async () => 1) };
        const uninstall = installRealtimeForwarder(redis as any);
        publish('t3', { type: 'message', conversationId: 'c1' });
        expect(redis.publish).toHaveBeenCalledWith(
            REALTIME_CHANNEL,
            JSON.stringify({ tenantId: 't3', event: { type: 'message', conversationId: 'c1' } }),
        );
        uninstall();
        publish('t3', { type: 'booking' });
        expect(redis.publish).toHaveBeenCalledTimes(1);
    });

    it('swallows a rejected redis publish', async () => {
        const redis = { publish: vi.fn(async () => { throw new Error('down'); }) };
        installRealtimeForwarder(redis as any);
        expect(() => publish('t4', { type: 'booking' })).not.toThrow();
        await new Promise((r) => setImmediate(r));
    });
});

function fakeSub() {
    const handlers: Record<string, (...a: any[]) => void> = {};
    return {
        subscribe: vi.fn(async () => 1),
        on: vi.fn((ev: string, fn: any) => { handlers[ev] = fn; }),
        unsubscribe: vi.fn(async () => 1),
        quit: vi.fn(async () => 'OK'),
        emit: (ev: string, ...a: any[]) => handlers[ev]?.(...a),
    };
}

describe('startRealtimeSubscriber', () => {
    it('relays messages from the channel to local clients', async () => {
        const sub = fakeSub();
        const send = vi.fn();
        const off = registerClient('t5', { send });
        const stop = startRealtimeSubscriber(sub as any);
        expect(sub.subscribe).toHaveBeenCalledWith(REALTIME_CHANNEL);
        sub.emit('message', REALTIME_CHANNEL, JSON.stringify({ tenantId: 't5', event: { type: 'booking' } }));
        expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'booking' }));
        await stop();
        expect(sub.quit).toHaveBeenCalled();
        off();
    });

    it.each([
        'not json',
        JSON.stringify({ event: { type: 'booking' } }),
        JSON.stringify({ tenantId: 't6' }),
        JSON.stringify({ tenantId: 't6', event: { type: 'evil' } }),
        JSON.stringify(null),
    ])('ignores a malformed message: %s', (raw) => {
        const sub = fakeSub();
        const send = vi.fn();
        const off = registerClient('t6', { send });
        startRealtimeSubscriber(sub as any);
        expect(() => sub.emit('message', REALTIME_CHANNEL, raw)).not.toThrow();
        expect(send).not.toHaveBeenCalled();
        off();
    });

    it('ignores other channels', () => {
        const sub = fakeSub();
        const send = vi.fn();
        const off = registerClient('t7', { send });
        startRealtimeSubscriber(sub as any);
        sub.emit('message', 'other', JSON.stringify({ tenantId: 't7', event: { type: 'booking' } }));
        expect(send).not.toHaveBeenCalled();
        off();
    });
});
