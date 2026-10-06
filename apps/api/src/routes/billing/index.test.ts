import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

const initTx = vi.fn(async () => ({ authorizationUrl: 'https://pay.test/x', reference: 'r1' }));
vi.mock('../../services/paystack-platform.js', () => ({
    ensurePaystackCustomer: vi.fn(async () => undefined),
    initializeSubscriptionTransaction: (...a: unknown[]) => (initTx as any)(...a),
    disableSubscription: vi.fn(),
    verifyPlatformWebhookSignature: vi.fn(() => true),
    PlatformPaystackError: class extends Error {},
}));
vi.mock('../../services/usage.js', () => ({
    evaluateSubscription: vi.fn(async () => ({ plan: { id: 'free' }, status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null })),
    getQuotaState: vi.fn(async () => ({ used: 0, limit: 50, ok: true, cycleStart: new Date(), cycleEnd: new Date() })),
}));
vi.mock('../../services/plans.js', async (orig) => {
    const real: any = await orig();
    return { ...real, getPaystackPlanCode: () => 'PLN_x', isPlatformPaystackConfigured: () => true };
});

import billingRoutes from './index.js';
import * as plans from '../../services/plans.js';

const state = { vertical: 'APPOINTMENTS', role: 'OWNER' };
const prisma: any = {
    tenant: { findUnique: vi.fn(async () => ({ vertical: state.vertical })) },
    user: { findFirst: vi.fn(async () => ({ email: 'o@x.test' })) },
    auditLog: { create: vi.fn(async () => ({})) },
};

let app: FastifyInstance;
beforeAll(async () => {
    app = Fastify();
    await app.register(sensible);
    app.decorate('prisma', prisma);
    app.decorate('authenticate', async (request: any) => {
        request.user = { tenantId: 't1', userId: 'u1', role: state.role };
    });
    await app.register(billingRoutes, { prefix: '/billing' });
    await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { state.vertical = 'APPOINTMENTS'; state.role = 'OWNER'; initTx.mockClear(); });

const subscribe = (payload: unknown) => app.inject({ method: 'POST', url: '/billing/subscribe', payload: payload as any });

describe('POST /billing/subscribe validation comes from the catalog', () => {
    it('starts a subscription for a paid plan', async () => {
        const res = await subscribe({ planId: 'pro' });
        expect(res.statusCode).toBe(200);
        expect(initTx).toHaveBeenCalledTimes(1);
    });
    it('rejects free, unknown and missing plan ids', async () => {
        for (const body of [{ planId: 'free' }, { planId: 'gold' }, {}]) {
            expect((await subscribe(body)).statusCode).toBeGreaterThanOrEqual(400);
        }
        expect(initTx).not.toHaveBeenCalled();
    });
    it('is owner only', async () => {
        state.role = 'STAFF';
        expect((await subscribe({ planId: 'pro' })).statusCode).toBe(403);
    });
    it('refuses a plan the tenant\'s vertical may not be on', async () => {
        const spy = vi.spyOn(plans, 'isPlanAvailableForVertical').mockReturnValueOnce(false);
        const res = await subscribe({ planId: 'pro' });
        expect(res.statusCode).toBe(400);
        expect(initTx).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('GET /billing/status availablePlans', () => {
    it('offers the plans for the tenant\'s vertical, cheapest first', async () => {
        state.vertical = 'RIDES';
        const res = await app.inject({ method: 'GET', url: '/billing/status' });
        expect(res.statusCode).toBe(200);
        expect(res.json().availablePlans.map((p: any) => p.id)).toEqual(['free', 'starter', 'pro']);
        expect(res.json().availablePlans[0].featuresEnforced).toBe(false);
    });
});
