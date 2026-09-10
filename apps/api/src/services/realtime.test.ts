import { describe, expect, it, vi } from 'vitest';
import { connectionCount, publish, registerClient } from './realtime.js';

describe('realtime pub/sub', () => {
  it('delivers events only to the right tenant', () => {
    const a = { send: vi.fn() };
    const b = { send: vi.fn() };
    const unregA = registerClient('tenant-a', a);
    const unregB = registerClient('tenant-b', b);

    publish('tenant-a', { type: 'notification' });

    expect(a.send).toHaveBeenCalledWith(JSON.stringify({ type: 'notification' }));
    expect(b.send).not.toHaveBeenCalled();

    unregA();
    unregB();
  });

  it('stops delivering after unregister and cleans up the tenant', () => {
    const c = { send: vi.fn() };
    const unreg = registerClient('t1', c);
    expect(connectionCount('t1')).toBe(1);

    unreg();
    expect(connectionCount('t1')).toBe(0);

    publish('t1', { type: 'message', conversationId: 'x' });
    expect(c.send).not.toHaveBeenCalled();
  });

  it('does not throw when a client send fails', () => {
    const bad = {
      send: () => {
        throw new Error('socket closed');
      },
    };
    registerClient('t2', bad);
    expect(() => publish('t2', { type: 'conversation' })).not.toThrow();
  });
});
