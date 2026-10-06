/**
 * POST /whatsapp/send-test sends a real message from the tenant's number to an
 * arbitrary recipient. So: OWNER only, and it obeys the same outbound pause and
 * message quota as every other send (reserve first, give the slot back if the
 * send fails). The rate limit stays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';

const tryReserveOutbound = vi.fn();
const rollbackOutboundReservation = vi.fn(async () => undefined);
vi.mock('../../services/usage.js', () => ({
    tryReserveOutbound: (...a: unknown[]) => tryReserveOutbound(...a),
    rollbackOutboundReservation: (...a: unknown[]) => (rollbackOutboundReservation as any)(...a),
    checkOutboundQuota: vi.fn(async () => ({ ok: true })),
}));
const getWhatsappCredentials = vi.fn();
vi.mock('../../services/whatsapp-credentials.js', async (orig) => ({
    ...(await orig<typeof import('../../services/whatsapp-credentials.js')>()),
    getWhatsappCredentials: (...a: unknown[]) => getWhatsappCredentials(...a),
}));

import whatsappRoutes from './index.js';

const fetchMock = vi.fn();

async function build(role: 'OWNER' | 'STAFF' = 'OWNER') {
    const app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', {} as any);
    app.decorate('authenticate', async (req: any) => { req.user = { userId: 'u1', tenantId: 't1', role }; });
    await app.register(whatsappRoutes, { prefix: '/whatsapp' });
    return app;
}
const post = (app: any) => app.inject({ method: 'POST', url: '/whatsapp/send-test', payload: { to: '233241234567', message: 'hello' } });

beforeEach(() => {
    vi.clearAllMocks();
    tryReserveOutbound.mockResolvedValue({ ok: true, used: 1, limit: 100, planId: 'free' });
    getWhatsappCredentials.mockResolvedValue({ accessToken: 'tok', phoneNumberId: 'ph1' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /whatsapp/send-test', () => {
    it('forbids STAFF: nothing is reserved or sent', async () => {
        const res = await post(await build('STAFF'));
        expect(res.statusCode).toBe(403);
        expect(tryReserveOutbound).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lets the OWNER send, reserving one quota slot for this tenant first', async () => {
        const res = await post(await build('OWNER'));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: true, messageId: 'wamid.1' });
        expect(tryReserveOutbound).toHaveBeenCalledTimes(1);
        expect((tryReserveOutbound.mock.calls[0] as any[])[1]).toBe('t1');
        expect(tryReserveOutbound.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
    });

    it('423 when support has paused outbound messaging: no send, no quota left held', async () => {
        tryReserveOutbound.mockResolvedValue({ ok: false, used: 0, limit: 100, planId: 'free', reason: 'paused', pauseReason: 'abuse' });
        const res = await post(await build());
        expect(res.statusCode).toBe(423);
        expect(res.json().message).toMatch(/paused/i);
        expect(res.json().message).not.toMatch(/quota|upgrade|abuse/i);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(rollbackOutboundReservation).not.toHaveBeenCalled();
    });

    it('402 when the quota is used up: no send', async () => {
        tryReserveOutbound.mockResolvedValue({ ok: false, used: 100, limit: 100, planId: 'free', reason: 'quota' });
        const res = await post(await build());
        expect(res.statusCode).toBe(402);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('gives the slot back when WhatsApp rejects the message', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad' }) });
        const res = await post(await build());
        expect(res.statusCode).toBe(502);
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });

    it('gives the slot back when the request itself throws, and still errors', async () => {
        fetchMock.mockRejectedValue(new Error('network'));
        const res = await post(await build());
        expect(res.statusCode).toBeGreaterThanOrEqual(500);
        expect(rollbackOutboundReservation).toHaveBeenCalledTimes(1);
    });

    it('does not reserve when WhatsApp is not connected', async () => {
        getWhatsappCredentials.mockResolvedValue(null);
        const res = await post(await build());
        expect(res.statusCode).toBe(400);
        expect(tryReserveOutbound).not.toHaveBeenCalled();
    });

    it('keeps its per-tenant rate limit config', async () => {
        const app = Fastify();
        await app.register(sensible);
        const seen: any[] = [];
        app.addHook('onRoute', (r) => { if (r.url.endsWith('/send-test')) seen.push((r as any).config?.rateLimit); });
        app.decorate('prisma', {} as any);
        app.decorate('authenticate', async () => undefined);
        await app.register(whatsappRoutes, { prefix: '/whatsapp' });
        await app.ready();
        expect(seen[0]).toMatchObject({ max: 10, timeWindow: '1 minute' });
    });
});
