import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import organisationRoutes, { buildChecklist } from './organisation.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });

const ANCHOR = new Date('2026-10-01T00:00:00Z');
const tenantRow = (over: Record<string, unknown> = {}) => ({
    id: 't1', name: 'Swift Rides', vertical: 'RIDES', businessType: 'SERVICE', timezone: 'Africa/Accra', isActive: true,
    createdAt: ANCHOR, planId: 'free', subscriptionStatus: null, trialEndsAt: null, currentPeriodEnd: null,
    quotaCycleStart: ANCHOR, monthlyMessageQuotaOverride: null, paymentCurrency: 'GHS',
    conversationMode: 'flow', activeFlowKey: 'turbo-rides',
    whatsappPhoneNumberId: 'pn1', whatsappAccessToken: 'SECRET-WA-TOKEN-CIPHERTEXT', whatsappHosted: false, whatsappNumberStatus: null, whatsappDisplayNumber: '+233200000000',
    paystackSecretKey: 'SECRET-PAYSTACK-CIPHERTEXT', arkeselApiKey: null, gmailUser: null, gmailAppPassword: null,
    outboundPausedAt: null, payoutsPausedAt: null, pauseReason: null, deletionRequestedAt: null,
    ...over,
});

function scripted(t: Record<string, unknown> = {}) {
    const p = makePrisma();
    p.tenant.findUnique.mockResolvedValue(tenantRow(t));
    p.messageTemplate.groupBy.mockResolvedValue([{ isApproved: true, _count: { _all: 2 } }, { isApproved: false, _count: { _all: 1 } }]);
    p.externalApp.findUnique.mockResolvedValue(null);
    p.flowDefinition.count.mockResolvedValue(1);
    p.payoutRecipient.count.mockResolvedValue(1);
    p.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Kofi', email: 'k@x.com', role: 'OWNER', isActive: true, createdAt: ANCHOR }]);
    p.tenantUsage.findMany.mockResolvedValue([{ month: '2026-10-01', messageCount: 12, platformSmsCount: 3 }]);
    p.tenantUsage.findUnique.mockResolvedValue({ messageCount: 12 });
    p.wallet.findUnique.mockResolvedValue({ currency: 'GHS', cachedAvailableMinor: 10000, cachedPendingMinor: 2500 });
    p.payoutRequest.groupBy.mockResolvedValue([{ status: 'PAID', _count: { _all: 4 }, _sum: { amountMinor: 40000 } }]);
    p.payoutRequest.findMany.mockResolvedValue([]);
    p.booking.count.mockResolvedValue(0);
    p.conversation.findMany.mockResolvedValue([
        { id: 'c1', channel: 'WHATSAPP', customerName: 'Ama', customerPhone: '+233241234567', state: 'BOT_ACTIVE', lastInboundAt: ANCHOR },
    ]);
    p.auditLog.findMany.mockResolvedValue([{ id: 'l1', action: 'tenant.updated', actorType: 'ADMIN', actorId: 'admin-1', createdAt: ANCHOR, metadata: { planId: 'pro' } }]);
    p.supportSession.findMany.mockResolvedValue([]);
    return p;
}

async function build(t: Record<string, unknown> = {}) {
    prisma = scripted(t);
    app = await buildAdminTestApp(async (s) => { await s.register(organisationRoutes); }, { prisma });
}
const get = (headers: any, id = 't1') => app.inject({ method: 'GET', url: `/admin/tenants/${id}/overview`, headers });

describe('buildChecklist', () => {
    const base = tenantRow() as any;
    const inputs = { templates: { total: 3, approved: 2 }, hasExternalApp: false, externalAppActive: false, activeFlowDefinitionCount: 1, payoutRecipients: 1 };
    const byKey = (items: any[], key: string) => items.find((i) => i.key === key);

    it('WhatsApp: own token = done; hosted not REGISTERED = todo; nothing = todo', () => {
        expect(byKey(buildChecklist(base, inputs), 'whatsapp').status).toBe('done');
        const hosted = { ...base, whatsappHosted: true, whatsappAccessToken: null, whatsappNumberStatus: 'PENDING_CODE' };
        expect(byKey(buildChecklist(hosted, inputs), 'whatsapp').status).toBe('todo');
        expect(byKey(buildChecklist({ ...hosted, whatsappNumberStatus: 'REGISTERED' }, inputs), 'whatsapp').status).toBe('done');
        expect(byKey(buildChecklist({ ...base, whatsappPhoneNumberId: null, whatsappAccessToken: null }, inputs), 'whatsapp').status).toBe('todo');
    });

    it('payments: own Paystack key or a payout destination counts', () => {
        expect(byKey(buildChecklist(base, inputs), 'paystack').status).toBe('done');
        expect(byKey(buildChecklist({ ...base, paystackSecretKey: null }, inputs), 'paystack').status).toBe('done'); // has a recipient
        expect(byKey(buildChecklist({ ...base, paystackSecretKey: null }, { ...inputs, payoutRecipients: 0 }), 'paystack').status).toBe('todo');
    });

    it('templates: done only when at least one is approved; detail says how many', () => {
        expect(byKey(buildChecklist(base, inputs), 'templates')).toMatchObject({ status: 'done', detail: '2 of 3 approved' });
        expect(byKey(buildChecklist(base, { ...inputs, templates: { total: 3, approved: 0 } }), 'templates').status).toBe('todo');
        expect(byKey(buildChecklist(base, { ...inputs, templates: { total: 0, approved: 0 } }), 'templates').status).toBe('todo');
    });

    it('external app and flow are "na" unless that conversation mode is in use', () => {
        const llm = { ...base, conversationMode: 'llm' };
        expect(byKey(buildChecklist(llm, inputs), 'external_app').status).toBe('na');
        expect(byKey(buildChecklist(llm, inputs), 'flow').status).toBe('na');
        const ext = { ...base, conversationMode: 'external' };
        expect(byKey(buildChecklist(ext, inputs), 'external_app').status).toBe('todo');
        expect(byKey(buildChecklist(ext, { ...inputs, hasExternalApp: true, externalAppActive: true }), 'external_app').status).toBe('done');
        expect(byKey(buildChecklist(ext, { ...inputs, hasExternalApp: true, externalAppActive: false }), 'external_app').status).toBe('todo');
        expect(byKey(buildChecklist(base, inputs), 'flow').status).toBe('done');
        expect(byKey(buildChecklist(base, { ...inputs, activeFlowDefinitionCount: 0 }), 'flow').status).toBe('todo');
        expect(byKey(buildChecklist({ ...base, activeFlowKey: null }, inputs), 'flow').status).toBe('todo');
    });
});

describe('GET /admin/tenants/:id/overview', () => {
    it('returns the full picture for an OWNER', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await get(headers);
        expect(res.statusCode).toBe(200);
        const j = res.json();
        expect(j.tenant).toMatchObject({ id: 't1', name: 'Swift Rides', vertical: 'RIDES', conversationMode: 'flow', activeFlowKey: 'turbo-rides', planId: 'free' });
        expect(j.checklist.map((c: any) => c.key)).toEqual(['whatsapp', 'paystack', 'sms', 'email', 'templates', 'external_app', 'flow']);
        expect(j.plan).toMatchObject({ planId: 'free', used: 12, limit: 50, percent: 24 });
        expect(j.staff).toHaveLength(1);
        expect(j.usage).toEqual([{ cycle: '2026-10-01', messages: 12, platformSms: 3 }]);
        expect(j.money.wallet).toMatchObject({ currency: 'GHS', availableMinor: 10000, pendingMinor: 2500 });
        expect(j.money.payoutsByStatus).toEqual([{ status: 'PAID', count: 4, totalMinor: 40000 }]);
        expect(j.recentConversations[0]).toMatchObject({ id: 'c1', customerName: 'Ama' });
        expect(j.audit[0]).toMatchObject({ action: 'tenant.updated' });
        expect(j.switches).toEqual({ outbound: { pausedAt: null }, payouts: { pausedAt: null }, reason: null });
    });

    it('never returns secrets or full phone numbers', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const text = (await get(headers)).body;
        expect(text).not.toContain('SECRET-WA-TOKEN-CIPHERTEXT');
        expect(text).not.toContain('SECRET-PAYSTACK-CIPHERTEXT');
        expect(text).not.toContain('+233241234567');
        expect(text).not.toContain('passwordHash');
    });

    it('SUPPORT sees everything except the money summary', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'SUPPORT');
        const j = (await get(headers)).json();
        expect(j.money).toBeNull();
        expect(j.checklist).toHaveLength(7);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
        expect(prisma.payoutRequest.groupBy).not.toHaveBeenCalled();
    });

    it('404 for an unknown tenant; 401 without a token', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        prisma.tenant.findUnique.mockResolvedValue(null);
        expect((await get(headers, 'nope')).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/admin/tenants/t1/overview' })).statusCode).toBe(401);
    });

    it('every list is bounded and scoped to this tenant', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        await get(headers);
        for (const [model, op] of [['user', 'findMany'], ['tenantUsage', 'findMany'], ['conversation', 'findMany'], ['auditLog', 'findMany'], ['supportSession', 'findMany'], ['payoutRequest', 'findMany']] as const) {
            const args = (prisma as any)[model][op].mock.calls[0][0];
            expect(args.take, `${model}.${op} take`).toBeGreaterThan(0);
            expect(args.take).toBeLessThanOrEqual(100);
            expect(args.where.tenantId, `${model}.${op} tenant filter`).toBe('t1');
        }
    });

    it('shows pause state when a switch is on', async () => {
        const at = new Date('2026-10-05T10:00:00Z');
        await build({ outboundPausedAt: at, pauseReason: 'spam' });
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const j = (await get(headers)).json();
        expect(j.switches).toEqual({ outbound: { pausedAt: at.toISOString() }, payouts: { pausedAt: null }, reason: 'spam' });
    });
});
