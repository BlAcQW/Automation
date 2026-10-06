import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../services/notifications.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
const svc = vi.hoisted(() => ({
    disconnectWhatsapp: vi.fn(),
    resendHostedCode: vi.fn(),
    checkTenantWhatsappHealth: vi.fn(),
    disconnectFacebookPage: vi.fn(),
    unlinkInstagram: vi.fn(),
}));
vi.mock('../../services/whatsapp-connection.js', async (orig) => ({
    ...(await orig<typeof import('../../services/whatsapp-connection.js')>()),
    disconnectWhatsapp: svc.disconnectWhatsapp,
    resendHostedCode: svc.resendHostedCode,
}));
vi.mock('../../services/whatsapp-health.js', async (orig) => ({
    ...(await orig<typeof import('../../services/whatsapp-health.js')>()),
    checkTenantWhatsappHealth: svc.checkTenantWhatsappHealth,
}));
vi.mock('../../services/facebook-connection.js', () => ({
    disconnectFacebookPage: svc.disconnectFacebookPage,
    unlinkInstagram: svc.unlinkInstagram,
}));

import adminChannelRoutes from './channels.js';
import { channelSummary, whatsappFilterWhere } from './index.js';
import { createNotification } from '../../services/notifications.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });
beforeEach(() => { vi.clearAllMocks(); });

const T0 = new Date('2026-10-01T09:00:00Z');
const tenantRow = (over: Record<string, unknown> = {}) => ({
    id: 't1', name: 'TURBO Rides',
    whatsappPhoneNumberId: '222', whatsappDisplayNumber: '+233 30 000 0000', whatsappHosted: false, whatsappNumberStatus: null,
    whatsappConnectionMode: 'OWN_ACCOUNT', whatsappConnectedAt: T0, whatsappConnectedByUserId: 'u1', whatsappVerifiedName: 'TURBO Rides',
    whatsappNameStatus: 'APPROVED', whatsappCodeMethod: null, whatsappCodeSentAt: null, whatsappQualityRating: 'YELLOW',
    whatsappMessagingLimit: 'TIER_1K', whatsappMetaStatus: 'CONNECTED', whatsappHealthProblem: null, whatsappHealthCheckedAt: T0,
    whatsappTokenExpiresAt: null,
    facebookPageId: 'pg1', facebookPageName: 'TURBO Page', facebookConnectedAt: T0, facebookConnectedByUserId: 'u1',
    instagramUserId: 'ig1', instagramUsername: 'turbo.rides', instagramConnectedAt: T0,
    ...over,
});

async function build(row: Record<string, unknown> | null = tenantRow()) {
    prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(row);
    prisma.conversation.groupBy.mockResolvedValue([
        { channel: 'WHATSAPP', _max: { lastInboundAt: T0 } },
        { channel: 'INSTAGRAM', _max: { lastInboundAt: null } },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
        { id: 'a1', action: 'whatsapp.connected', actorType: 'USER', actorId: 'u1', createdAt: T0, metadata: { mode: 'OWN_ACCOUNT' } },
        { id: 'a2', action: 'whatsapp.disconnected', actorType: 'ADMIN', actorId: 'adm9', createdAt: T0, metadata: { reason: 'abuse' } },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Kofi', email: 'kofi@turbo.example' }]);
    prisma.admin.findMany.mockResolvedValue([{ id: 'adm9', name: 'Ama Support', email: 'ama@bookly.example' }]);
    app = await buildAdminTestApp(async (s) => { await s.register(adminChannelRoutes); }, { prisma });
}

const get = (headers: any, url = '/admin/tenants/t1/channels') => app.inject({ method: 'GET', url, headers });
const post = (headers: any, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: payload as any });

describe('GET /admin/tenants/:id/channels', () => {
    it('returns WhatsApp, Instagram and Messenger with who connected them and recent events', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const res = await get(headers);
        expect(res.statusCode).toBe(200);
        const { data } = res.json();
        expect(data.whatsapp).toMatchObject({
            state: 'CONNECTED', connected: true, mode: 'OWN_ACCOUNT', displayNumber: '+233 30 000 0000', verifiedName: 'TURBO Rides',
            connectedAt: T0.toISOString(), connectedBy: { id: 'u1', name: 'Kofi', email: 'kofi@turbo.example' },
            health: { qualityRating: 'YELLOW', messagingLimit: 'TIER_1K', metaStatus: 'CONNECTED', problem: null, checkedAt: T0.toISOString() },
            lastInboundAt: T0.toISOString(), billedBy: 'ORGANISATION',
        });
        expect(data.instagram).toMatchObject({ connected: true, username: 'turbo.rides', connectedAt: T0.toISOString(), lastInboundAt: null });
        expect(data.messenger).toMatchObject({ connected: true, pageName: 'TURBO Page', connectedBy: { name: 'Kofi' } });
        expect(data.recentEvents[1]).toMatchObject({ action: 'whatsapp.disconnected', actorType: 'ADMIN', actor: { name: 'Ama Support' } });
        // credential columns are never selected
        const select = prisma.tenant.findUnique.mock.calls[0][0].select;
        expect(select.whatsappAccessToken).toBeUndefined();
        expect(select.facebookPageToken).toBeUndefined();
        expect(select.whatsappRegistrationPin).toBeUndefined();
        expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1' });
    });

    it('the /whatsapp alias returns the WhatsApp slice only', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const { data } = (await get(headers, '/admin/tenants/t1/whatsapp')).json();
        expect(data.whatsapp.mode).toBe('OWN_ACCOUNT');
        expect(data.instagram).toBeUndefined();
        expect(prisma.auditLog.findMany.mock.calls[0][0].where.action.in.every((a: string) => a.startsWith('whatsapp.'))).toBe(true);
    });

    it('404 for an unknown organisation', async () => {
        await build(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await get(headers)).statusCode).toBe(404);
    });
});

describe('admin channel actions', () => {
    it('WhatsApp disconnect needs a reason, is audited as ADMIN with mode, and the organisation is told', async () => {
        await build();
        svc.disconnectWhatsapp.mockResolvedValue({ hadNumber: true, mode: 'OWN_ACCOUNT', phoneNumberId: '222', displayNumber: '+233 30 000 0000', metaCleanup: 'unsubscribed_app' });
        const { headers, row } = signedInAs(app, prisma, 'SUPPORT');
        expect((await post(headers, '/admin/tenants/t1/whatsapp/disconnect', {})).statusCode).toBe(400);
        const res = await post(headers, '/admin/tenants/t1/whatsapp/disconnect', { reason: 'number reported for spam' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({ disconnected: true, metaCleanup: 'unsubscribed_app' });
        expect(prisma.audits.find((a) => a.action === 'whatsapp.disconnected')).toMatchObject({
            actorType: 'ADMIN', actorId: row.id, tenantId: 't1', metadata: { mode: 'OWN_ACCOUNT', reason: 'number reported for spam', by: 'admin' },
        });
        expect((createNotification as any).mock.calls[0][1]).toMatchObject({ tenantId: 't1', type: 'SYSTEM', message: expect.stringContaining('number reported for spam') });
    });

    it('409 NOT_CONNECTED when there is no number', async () => {
        await build(tenantRow({ whatsappPhoneNumberId: null }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, '/admin/tenants/t1/whatsapp/disconnect', { reason: 'cleanup please' });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe('NOT_CONNECTED');
    });

    it('FINANCE and READONLY cannot act', async () => {
        await build();
        for (const role of ['FINANCE', 'READONLY']) {
            const { headers } = signedInAs(app, prisma, role);
            expect((await post(headers, '/admin/tenants/t1/whatsapp/health-check')).statusCode, role).toBe(403);
            expect((await post(headers, '/admin/tenants/t1/facebook/disconnect', { reason: 'x'.repeat(5) })).statusCode, role).toBe(403);
        }
        expect(svc.checkTenantWhatsappHealth).not.toHaveBeenCalled();
    });

    it('resend OTP and health check run the shared services and are audited', async () => {
        await build();
        const sent = { success: true, codeMethod: 'VOICE', codeSentAt: T0, resendAvailableAt: T0 };
        svc.resendHostedCode.mockResolvedValue(sent);
        svc.checkTenantWhatsappHealth.mockResolvedValue({ checked: true, problem: null, qualityRating: 'GREEN', alerts: [] });
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const r1 = await post(headers, '/admin/tenants/t1/whatsapp/hosted/resend', { codeMethod: 'VOICE' });
        expect(r1.statusCode).toBe(200);
        expect(svc.resendHostedCode.mock.calls[0].slice(1, 3)).toEqual(['t1', 'VOICE']);
        const r2 = await post(headers, '/admin/tenants/t1/whatsapp/health-check');
        expect(r2.json().data).toMatchObject({ checked: true, qualityRating: 'GREEN' });
        expect(prisma.audits.map((a) => a.action)).toEqual(expect.arrayContaining(['whatsapp.hosted_code_resent', 'whatsapp.health_checked']));
    });

    it('health check on an unconnected number -> 409 NOT_CONNECTED', async () => {
        await build();
        svc.checkTenantWhatsappHealth.mockResolvedValue({ checked: false, skipped: 'not_connected' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, '/admin/tenants/t1/whatsapp/health-check')).json().code).toBe('NOT_CONNECTED');
    });

    it('Facebook disconnect (Messenger + Instagram) and Instagram-only disconnect are audited and notified', async () => {
        await build();
        svc.disconnectFacebookPage.mockResolvedValue({ hadPage: true, pageId: 'pg1', pageName: 'TURBO Page', instagramUsername: 'turbo.rides', metaCleanup: 'unsubscribed_page' });
        svc.unlinkInstagram.mockResolvedValue({ hadInstagram: true, instagramUsername: 'turbo.rides' });
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, '/admin/tenants/t1/facebook/disconnect', { reason: 'page compromised' })).statusCode).toBe(200);
        expect((await post(headers, '/admin/tenants/t1/instagram/disconnect', { reason: 'wrong account' })).statusCode).toBe(200);
        expect(prisma.audits.map((a) => [a.action, a.actorType, a.metadata.reason])).toEqual([
            ['channels.facebook_disconnected', 'ADMIN', 'page compromised'],
            ['channels.instagram_disconnected', 'ADMIN', 'wrong account'],
        ]);
        expect((createNotification as any).mock.calls).toHaveLength(2);
    });
});

describe('organisations list channel summary', () => {
    it('summarises each channel without extra queries', () => {
        const base = { whatsappPhoneNumberId: null, whatsappHosted: false, whatsappNumberStatus: null, whatsappHealthProblem: null, whatsappConnectionMode: null, facebookPageId: null, instagramUserId: null };
        expect(channelSummary(base)).toEqual({ whatsapp: 'none', whatsappMode: null, instagram: false, messenger: false });
        expect(channelSummary({ ...base, whatsappPhoneNumberId: 'p', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' }).whatsapp).toBe('pending');
        expect(channelSummary({ ...base, whatsappPhoneNumberId: 'p', whatsappHealthProblem: 'NUMBER_BANNED' }).whatsapp).toBe('problem');
        expect(channelSummary({ ...base, whatsappPhoneNumberId: 'p', facebookPageId: 'pg', instagramUserId: 'ig' }))
            .toEqual({ whatsapp: 'connected', whatsappMode: 'OWN_ACCOUNT', instagram: true, messenger: true });
    });

    it('"WhatsApp not connected" includes hosted numbers still waiting for their code', () => {
        expect(whatsappFilterWhere('not_connected')).toEqual({
            OR: [{ whatsappPhoneNumberId: null }, { whatsappHosted: true, whatsappNumberStatus: { in: ['PENDING_CODE', 'VERIFIED'] } }],
        });
        expect(whatsappFilterWhere(undefined)).toEqual({});
    });
});
