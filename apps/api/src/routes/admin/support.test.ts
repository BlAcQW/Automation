import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import supportRoutes from './support.js';
import { clearSwitchCache } from '../../services/platform-switches.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

vi.mock('../../services/events/emit.js', () => ({
    emitConversationHandoff: vi.fn(async () => undefined),
    emitConversationResumed: vi.fn(async () => undefined),
}));

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

async function build() {
    clearSwitchCache();
    prisma = makePrisma();
    app = await buildAdminTestApp(async (s) => { await s.register(supportRoutes); }, { prisma });
    prisma.tenant.findUnique.mockImplementation(async () => ({ id: 't1', isActive: true, outboundPausedAt: null, payoutsPausedAt: null, pauseReason: null }));
    prisma.supportSession.create.mockImplementation(async ({ data }: any) => ({ id: 'sess-1', createdAt: new Date(), endedAt: null, ...data }));
}
const call = (method: string, url: string, headers: any, payload?: unknown) =>
    app.inject({ method: method as any, url, headers, payload: payload as any });

describe('POST /admin/tenants/:id/support-sessions', () => {
    it('SUPPORT starts a READ_ONLY session and gets a short-lived tenant-scoped token; audited', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        const res = await call('POST', '/admin/tenants/t1/support-sessions', headers, { reason: 'Customer cannot see bookings', minutes: 30 });
        expect(res.statusCode).toBe(201);
        const j = res.json();
        expect(j.session).toMatchObject({ id: 'sess-1', tenantId: 't1', mode: 'READ_ONLY' });
        expect(j.token).toBeTruthy();
        expect(j.tokenExpiresInSeconds).toBeLessThanOrEqual(900);

        // the token is a SUPPORT token for that tenant and session, nothing more
        const payload = (app as any).jwt.verify(j.token);
        expect(payload).toMatchObject({ type: 'support', tenantId: 't1', role: 'STAFF', support: { sessionId: 'sess-1', adminId: row.id } });

        expect(prisma.audits.at(-1)).toMatchObject({
            action: 'support.session.started', actorType: 'ADMIN', actorId: row.id, tenantId: 't1', targetId: 'sess-1',
        });
        expect(prisma.audits.at(-1).metadata).toMatchObject({ reason: 'Customer cannot see bookings' });
    });

    it('requires a reason; 400 without one', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        for (const payload of [{}, { reason: '' }, { reason: 'no' }]) {
            expect((await call('POST', '/admin/tenants/t1/support-sessions', headers, payload)).statusCode).toBe(400);
        }
        expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });

    it('caps the duration at 60 minutes', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const res = await call('POST', '/admin/tenants/t1/support-sessions', headers, { reason: 'long investigation', minutes: 600 });
        expect(res.statusCode).toBe(201);
        const { createdAt: _c, ...data } = prisma.supportSession.create.mock.calls[0][0].data;
        expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 2000);
    });

    it('no way to ask for WRITE mode', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await call('POST', '/admin/tenants/t1/support-sessions', headers, { reason: 'long investigation', mode: 'WRITE' });
        expect(res.statusCode).toBe(400);
    });

    it('404 for an unknown tenant', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await call('POST', '/admin/tenants/nope/support-sessions', headers, { reason: 'long investigation' })).statusCode).toBe(404);
    });

    it.each(['FINANCE', 'READONLY'])('%s may not start support access', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await call('POST', '/admin/tenants/t1/support-sessions', headers, { reason: 'long investigation' })).statusCode).toBe(403);
        expect(prisma.supportSession.create).not.toHaveBeenCalled();
    });
});

describe('support session token + end + list', () => {
    it('mints a fresh token only for the caller\'s own live session', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        prisma.supportSession.findFirst.mockResolvedValue({ id: 'sess-1', adminId: row.id, tenantId: 't1', expiresAt: new Date(Date.now() + 600_000), admin: { isActive: true } });
        const ok = await call('POST', '/admin/support-sessions/sess-1/token', headers);
        expect(ok.statusCode).toBe(200);
        expect(ok.json().token).toBeTruthy();
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'support.token.issued', targetId: 'sess-1' });

        prisma.supportSession.findFirst.mockResolvedValue({ id: 'sess-1', adminId: 'someone-else', tenantId: 't1', expiresAt: new Date(Date.now() + 600_000), admin: { isActive: true } });
        expect((await call('POST', '/admin/support-sessions/sess-1/token', headers)).statusCode).toBe(404);
    });

    it('404 for an ended/expired session', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        prisma.supportSession.findFirst.mockResolvedValue(null);
        expect((await call('POST', '/admin/support-sessions/sess-1/token', headers)).statusCode).toBe(404);
    });

    it('ends a session and audits it; 404 when nothing matched', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        prisma.supportSession.updateMany.mockResolvedValue({ count: 1 });
        prisma.supportSession.findUnique.mockResolvedValue({ id: 'sess-1', tenantId: 't1' });
        const res = await call('POST', '/admin/support-sessions/sess-1/end', headers);
        expect(res.statusCode).toBe(200);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'support.session.ended', actorId: row.id, targetId: 'sess-1', tenantId: 't1' });
        prisma.supportSession.updateMany.mockResolvedValue({ count: 0 });
        expect((await call('POST', '/admin/support-sessions/sess-1/end', headers)).statusCode).toBe(404);
    });

    it('lists sessions for any role that can read audit, bounded', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const res = await call('GET', '/admin/support-sessions?tenantId=t1&limit=9999', headers);
        expect(res.statusCode).toBe(400);
        const ok = await call('GET', '/admin/support-sessions?tenantId=t1&limit=20', headers);
        expect(ok.statusCode).toBe(200);
        expect(prisma.supportSession.findMany.mock.calls[0][0].take).toBe(20);
    });
});

describe('per-tenant switches', () => {
    it('SUPPORT pauses a tenant\'s outbound messages with a reason; audited', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        const res = await call('PUT', '/admin/tenants/t1/switches/outbound', headers, { paused: true, reason: 'spam complaints from Meta' });
        expect(res.statusCode).toBe(200);
        const upd = prisma.tenant.update.mock.calls[0][0];
        expect(upd.where).toEqual({ id: 't1' });
        expect(upd.data).toMatchObject({ outboundPausedAt: expect.any(Date), pauseReason: 'spam complaints from Meta' });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'tenant.outbound.paused', actorId: row.id, tenantId: 't1', metadata: { reason: 'spam complaints from Meta' } });
    });

    it('a pause without a reason is 400 and changes nothing', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await call('PUT', '/admin/tenants/t1/switches/payouts', headers, { paused: true });
        expect(res.statusCode).toBe(400);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('resume needs no reason and is audited as resumed', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.tenant.findUnique.mockResolvedValue({ id: 't1', outboundPausedAt: new Date(), payoutsPausedAt: null, pauseReason: 'x' });
        const res = await call('PUT', '/admin/tenants/t1/switches/outbound', headers, { paused: false });
        expect(res.statusCode).toBe(200);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'tenant.outbound.resumed' });
    });

    it('payout switch: FINANCE yes, SUPPORT no; outbound switch: SUPPORT yes, FINANCE no', async () => {
        await build();
        const fin = signedInAs(app, prisma, 'FINANCE');
        const sup = signedInAs(app, prisma, 'SUPPORT');
        const body = { paused: true, reason: 'fraud review' };
        expect((await call('PUT', '/admin/tenants/t1/switches/payouts', fin.headers, body)).statusCode).toBe(200);
        expect((await call('PUT', '/admin/tenants/t1/switches/payouts', sup.headers, body)).statusCode).toBe(403);
        expect((await call('PUT', '/admin/tenants/t1/switches/outbound', sup.headers, body)).statusCode).toBe(200);
        expect((await call('PUT', '/admin/tenants/t1/switches/outbound', fin.headers, body)).statusCode).toBe(403);
    });

    it('404 for an unknown tenant, 400 for an unknown switch name', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await call('PUT', '/admin/tenants/nope/switches/outbound', headers, { paused: true, reason: 'because' })).statusCode).toBe(404);
        expect((await call('PUT', '/admin/tenants/t1/switches/inbound', headers, { paused: true, reason: 'because' })).statusCode).toBe(400);
    });

    it('READONLY can read the state but never change it', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        expect((await call('PUT', '/admin/tenants/t1/switches/outbound', headers, { paused: true, reason: 'because' })).statusCode).toBe(403);
    });
});

describe('platform-wide switches', () => {
    it('FINANCE and OWNER can pause platform payouts; SUPPORT cannot', async () => {
        await build();
        const fin = signedInAs(app, prisma, 'FINANCE');
        const sup = signedInAs(app, prisma, 'SUPPORT');
        const body = { paused: true, reason: 'Paystack incident' };
        const ok = await call('PUT', '/admin/platform/switches/payouts', fin.headers, body);
        expect(ok.statusCode).toBe(200);
        expect(prisma.platformSetting.upsert.mock.calls[0][0].create).toMatchObject({ key: 'payouts.paused', value: { paused: true, reason: 'Paystack incident' }, updatedBy: fin.row.id });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'platform.payouts.paused', tenantId: null });
        expect((await call('PUT', '/admin/platform/switches/payouts', sup.headers, body)).statusCode).toBe(403);
    });

    it('platform-wide outbound is OWNER only', async () => {
        await build();
        const fin = signedInAs(app, prisma, 'FINANCE');
        const owner = signedInAs(app, prisma, 'OWNER');
        const body = { paused: true, reason: 'carrier outage' };
        expect((await call('PUT', '/admin/platform/switches/outbound', fin.headers, body)).statusCode).toBe(403);
        expect((await call('PUT', '/admin/platform/switches/outbound', owner.headers, body)).statusCode).toBe(200);
    });

    it('GET reports both switches to anyone who can see the overview', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        prisma.platformSetting.findUnique.mockImplementation(async ({ where }: any) =>
            where.key === 'payouts.paused' ? { value: { paused: true, reason: 'r' } } : null);
        const res = await call('GET', '/admin/platform/switches', headers);
        expect(res.json()).toEqual({ outbound: { paused: false }, payouts: { paused: true, reason: 'r' } });
    });
});

describe('POST /admin/conversations/:id/handoff', () => {
    it('forces the conversation to a human with an admin reason, audited under the tenant', async () => {
        await build();
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        prisma.conversation.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', state: 'BOT_ACTIVE' });
        prisma.conversation.update.mockResolvedValue({ tenantId: 't1' });
        const res = await call('POST', '/admin/conversations/c1/handoff', headers, { reason: 'Bot is looping' });
        expect(res.statusCode).toBe(200);
        const upd = prisma.conversation.update.mock.calls[0][0];
        expect(upd.where).toEqual({ id: 'c1' });
        expect(upd.data).toMatchObject({ state: 'HUMAN_ACTIVE', takeoverReason: 'Admin handoff: Bot is looping' });
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'conversation.handoff.forced', actorId: row.id, tenantId: 't1', targetId: 'c1' });
    });

    it('requires a reason, 404 when missing, 409 when already with a human, 403 for FINANCE', async () => {
        await build();
        const sup = signedInAs(app, prisma, 'SUPPORT');
        expect((await call('POST', '/admin/conversations/c1/handoff', sup.headers, {})).statusCode).toBe(400);
        prisma.conversation.findFirst.mockResolvedValue(null);
        expect((await call('POST', '/admin/conversations/c1/handoff', sup.headers, { reason: 'Bot is looping' })).statusCode).toBe(404);
        prisma.conversation.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', state: 'HUMAN_ACTIVE' });
        expect((await call('POST', '/admin/conversations/c1/handoff', sup.headers, { reason: 'Bot is looping' })).statusCode).toBe(409);
        const fin = signedInAs(app, prisma, 'FINANCE');
        expect((await call('POST', '/admin/conversations/c1/handoff', fin.headers, { reason: 'Bot is looping' })).statusCode).toBe(403);
    });
});
