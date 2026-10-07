import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const svc = vi.hoisted(() => ({
    createNotification: vi.fn(),
    disconnectWhatsapp: vi.fn(),
    disconnectFacebookPage: vi.fn(),
    unlinkInstagram: vi.fn(),
}));
vi.mock('../../services/notifications.js', () => ({ createNotification: svc.createNotification }));
vi.mock('../../services/whatsapp-connection.js', async (orig) => ({
    ...(await orig<typeof import('../../services/whatsapp-connection.js')>()),
    disconnectWhatsapp: svc.disconnectWhatsapp,
}));
vi.mock('../../services/facebook-connection.js', () => ({
    disconnectFacebookPage: svc.disconnectFacebookPage,
    unlinkInstagram: svc.unlinkInstagram,
}));

import tenantLifecycleRoutes from './tenant-lifecycle.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';

let app: FastifyInstance;
let prisma: PrismaStub;
afterEach(async () => { await app?.close(); });
beforeEach(() => {
    vi.clearAllMocks();
    svc.createNotification.mockResolvedValue(undefined);
    svc.disconnectWhatsapp.mockResolvedValue({ hadNumber: true, mode: 'OWN_ACCOUNT', phoneNumberId: 'pn1', displayNumber: '+233', metaCleanup: 'unsubscribed_app' });
    svc.disconnectFacebookPage.mockResolvedValue({ hadPage: true, pageId: 'pg1', pageName: 'P', instagramUsername: 'ig', metaCleanup: 'unsubscribed_page' });
    svc.unlinkInstagram.mockResolvedValue({ hadInstagram: true, instagramUsername: 'ig' });
});

const tenantRow = (over: Record<string, unknown> = {}) => ({
    id: 't1', name: 'TURBO Rides', isActive: false,
    whatsappPhoneNumberId: null, facebookPageId: null, instagramUserId: null,
    subscriptionRef: null,
    ...over,
});

async function build(row: Record<string, unknown> | null = tenantRow()) {
    prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(row);
    prisma.tenant.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.count.mockResolvedValue(2);
    prisma.conversation.count.mockResolvedValue(5);
    prisma.message.count.mockResolvedValue(40);
    prisma.calendarIntegration.findMany.mockResolvedValue([]);
    prisma.booking.deleteMany.mockResolvedValue({ count: 0 });
    prisma.order.deleteMany.mockResolvedValue({ count: 0 });
    prisma.calendarEvent.deleteMany.mockResolvedValue({ count: 0 });
    prisma.payoutRecipient.deleteMany.mockResolvedValue({ count: 0 });
    prisma.flowDefinition.deleteMany.mockResolvedValue({ count: 1 });
    prisma.deviceToken.deleteMany.mockResolvedValue({ count: 0 });
    prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 0 });
    prisma.platformAlert.updateMany.mockResolvedValue({ count: 0 });
    prisma.tenant.delete.mockResolvedValue({ id: 't1' });
    app = await buildAdminTestApp(async (s) => { await s.register(tenantLifecycleRoutes); }, { prisma });
}

const post = (headers: any, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: payload as any });
const del = (headers: any, payload: unknown = { confirmName: 'TURBO Rides', reason: 'Closed the business' }) =>
    post(headers, '/admin/tenants/t1/delete', payload);

describe('POST /admin/tenants/:id/deactivate and /reactivate', () => {
    it('OWNER deactivates with a reason: flag cleared, audited, the organisation notified', async () => {
        await build(tenantRow({ isActive: true }));
        const { headers, row } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, '/admin/tenants/t1/deactivate', { reason: 'Unpaid invoices' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ isActive: false, changed: true });
        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't1' }, data: { isActive: false } }));
        expect(prisma.audits).toEqual([expect.objectContaining({
            action: 'tenant.deactivated', actorType: 'ADMIN', actorId: row.id, tenantId: 't1', targetType: 'Tenant', targetId: 't1',
            metadata: expect.objectContaining({ reason: 'Unpaid invoices', wasActive: true }),
        })]);
        expect(svc.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: 't1', type: 'SYSTEM', message: expect.stringContaining('Unpaid invoices') }), expect.anything());
    });

    it('deactivating an inactive organisation changes nothing and notifies nobody', async () => {
        await build(tenantRow({ isActive: false }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, '/admin/tenants/t1/deactivate', { reason: 'Unpaid invoices' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ isActive: false, changed: false });
        expect(prisma.tenant.update).not.toHaveBeenCalled();
        expect(svc.createNotification).not.toHaveBeenCalled();
    });

    it('reactivates with a reason, audited and notified', async () => {
        await build(tenantRow({ isActive: false }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await post(headers, '/admin/tenants/t1/reactivate', { reason: 'Invoices settled' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ isActive: true, changed: true });
        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: true } }));
        expect(prisma.audits[0]).toMatchObject({ action: 'tenant.reactivated', metadata: expect.objectContaining({ reason: 'Invoices settled' }) });
        expect(svc.createNotification).toHaveBeenCalledTimes(1);
    });

    it('a reason is required (3-300 characters)', async () => {
        await build(tenantRow({ isActive: true }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, '/admin/tenants/t1/deactivate', {})).statusCode).toBe(400);
        expect((await post(headers, '/admin/tenants/t1/deactivate', { reason: ' x ' })).statusCode).toBe(400);
        expect((await post(headers, '/admin/tenants/t1/deactivate', { reason: 'x'.repeat(301) })).statusCode).toBe(400);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('404 for an unknown organisation', async () => {
        await build(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await post(headers, '/admin/tenants/t1/deactivate', { reason: 'Unpaid invoices' })).statusCode).toBe(404);
    });

    it.each(['SUPPORT', 'FINANCE', 'READONLY'])('%s cannot deactivate or reactivate', async (role) => {
        await build(tenantRow({ isActive: true }));
        const { headers } = signedInAs(app, prisma, role);
        expect((await post(headers, '/admin/tenants/t1/deactivate', { reason: 'Unpaid invoices' })).statusCode).toBe(403);
        expect((await post(headers, '/admin/tenants/t1/reactivate', { reason: 'Unpaid invoices' })).statusCode).toBe(403);
        expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('the legacy DELETE /admin/tenants/:id still deactivates (back-compat alias)', async () => {
        await build(tenantRow({ isActive: true }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await app.inject({ method: 'DELETE', url: '/admin/tenants/t1', headers });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: true });
        expect(prisma.tenant.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
        expect(prisma.audits[0]).toMatchObject({ action: 'tenant.deactivated' });
    });
});

describe('GET /admin/tenants/:id/delete-check', () => {
    it('READONLY may read it: counts and no blockers for an inactive organisation without money', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const res = await app.inject({ method: 'GET', url: '/admin/tenants/t1/delete-check', headers });
        expect(res.statusCode).toBe(200);
        const { data } = res.json();
        expect(data.canDelete).toBe(true);
        expect(data.blockers).toEqual([]);
        expect(data.counts).toMatchObject({ users: 2, conversations: 5, messages: 40 });
    });

    it('lists NOT_DEACTIVATED and MONEY_HISTORY', async () => {
        await build(tenantRow({ isActive: true }));
        prisma.ledgerMovement.count.mockResolvedValue(3);
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const { data } = (await app.inject({ method: 'GET', url: '/admin/tenants/t1/delete-check', headers })).json();
        expect(data.canDelete).toBe(false);
        expect(data.blockers.map((b: any) => b.code)).toEqual(['NOT_DEACTIVATED', 'MONEY_HISTORY']);
        expect(data.blockers[1].count).toBe(3);
    });

    it('a paid booking, paid pass or a non-zero wallet is money history', async () => {
        await build();
        prisma.booking.count.mockResolvedValue(1);
        prisma.wallet.findUnique.mockResolvedValue({ cachedAvailableMinor: 0, cachedPendingMinor: 500 });
        const { headers } = signedInAs(app, prisma, 'READONLY');
        const { data } = (await app.inject({ method: 'GET', url: '/admin/tenants/t1/delete-check', headers })).json();
        expect(data.canDelete).toBe(false);
        expect(data.blockers[0]).toMatchObject({ code: 'MONEY_HISTORY', count: 2 });
    });
});

describe('POST /admin/tenants/:id/delete', () => {
    it.each(['READONLY', 'SUPPORT', 'FINANCE'])('%s cannot delete', async (role) => {
        await build();
        const { headers } = signedInAs(app, prisma, role);
        expect((await del(headers)).statusCode).toBe(403);
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('OWNER deletes: Meta cleanup first, then one transaction, and an audit row that survives', async () => {
        await build(tenantRow({ whatsappPhoneNumberId: 'pn1', facebookPageId: 'pg1', instagramUserId: 'ig1' }));
        const order: string[] = [];
        svc.disconnectWhatsapp.mockImplementation(async () => { order.push('whatsapp'); return { hadNumber: true, mode: 'OWN_ACCOUNT', phoneNumberId: 'pn1', displayNumber: '+233', metaCleanup: 'unsubscribed_app' }; });
        svc.disconnectFacebookPage.mockImplementation(async () => { order.push('facebook'); return { hadPage: true, pageId: 'pg1', pageName: 'P', instagramUsername: 'ig', metaCleanup: 'unsubscribed_page' }; });
        prisma.tenant.delete.mockImplementation(async () => { order.push('delete'); return { id: 't1' }; });
        const { headers, row } = signedInAs(app, prisma, 'OWNER');

        const res = await del(headers, { confirmName: '  TURBO Rides ', reason: 'Closed the business' });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ deleted: true, id: 't1', name: 'TURBO Rides' });
        expect(order).toEqual(['whatsapp', 'facebook', 'delete']);
        expect(svc.unlinkInstagram).not.toHaveBeenCalled(); // the Page disconnect clears Instagram too
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.tenant.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
        expect(prisma.flowDefinition.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } });

        const deleted = prisma.audits.find((a) => a.action === 'tenant.deleted');
        expect(deleted).toMatchObject({
            actorType: 'ADMIN', actorId: row.id, targetType: 'Tenant', targetId: 't1',
            metadata: expect.objectContaining({
                name: 'TURBO Rides', reason: 'Closed the business',
                counts: expect.objectContaining({ users: 2, conversations: 5, messages: 40 }),
                cleanup: expect.objectContaining({ whatsapp: 'unsubscribed_app', facebook: 'unsubscribed_page' }),
            }),
        });
    });

    it('Instagram without a Page is unlinked', async () => {
        await build(tenantRow({ instagramUserId: 'ig1' }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await del(headers)).statusCode).toBe(200);
        expect(svc.unlinkInstagram).toHaveBeenCalledWith(expect.anything(), 't1');
        expect(svc.disconnectWhatsapp).not.toHaveBeenCalled();
    });

    it('a failed Meta cleanup is logged and recorded, and does not stop the delete', async () => {
        await build(tenantRow({ whatsappPhoneNumberId: 'pn1' }));
        svc.disconnectWhatsapp.mockRejectedValue(new Error('graph down'));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await del(headers)).statusCode).toBe(200);
        expect(prisma.tenant.delete).toHaveBeenCalled();
        expect(prisma.audits.find((a) => a.action === 'tenant.deleted').metadata.cleanup.whatsapp).toBe('failed');
    });

    it('400 when the typed name does not match exactly (case-sensitive)', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await del(headers, { confirmName: 'turbo rides', reason: 'Closed the business' });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/name/i);
        expect(svc.disconnectWhatsapp).not.toHaveBeenCalled();
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('400 without a valid reason', async () => {
        await build();
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await del(headers, { confirmName: 'TURBO Rides' })).statusCode).toBe(400);
        expect((await del(headers, { confirmName: 'TURBO Rides', reason: 'no' })).statusCode).toBe(400);
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('409 with blockers for an active organisation; nothing is touched', async () => {
        await build(tenantRow({ isActive: true, whatsappPhoneNumberId: 'pn1' }));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await del(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().blockers.map((b: any) => b.code)).toEqual(['NOT_DEACTIVATED']);
        expect(svc.disconnectWhatsapp).not.toHaveBeenCalled();
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('409 with MONEY_HISTORY when there is a ledger movement, even when called directly', async () => {
        await build();
        prisma.ledgerMovement.count.mockResolvedValue(1);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await del(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().blockers[0]).toMatchObject({ code: 'MONEY_HISTORY', count: 1 });
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('409 with OPEN_PAYMENT_LINKS for a held ride pass; delete-check lists it too', async () => {
        await build();
        prisma.ridePass.count.mockImplementation(async ({ where }: any) => (where.status === 'HELD' ? 1 : 0));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const check = (await app.inject({ method: 'GET', url: '/admin/tenants/t1/delete-check', headers })).json().data;
        expect(check.canDelete).toBe(false);
        expect(check.blockers).toEqual([expect.objectContaining({ code: 'OPEN_PAYMENT_LINKS', count: 1, message: expect.stringMatching(/unpaid payment links/i) })]);
        const res = await del(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().blockers[0].code).toBe('OPEN_PAYMENT_LINKS');
        expect(svc.disconnectWhatsapp).not.toHaveBeenCalled();
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('re-checks inside the transaction: an open PAYG link that appears after the first check still refuses', async () => {
        await build();
        let calls = 0;
        prisma.ride.count.mockImplementation(async ({ where }: any) => (where.kind === 'PAYG' ? (calls++ === 0 ? 0 : 1) : 0));
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await del(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().blockers[0].code).toBe('OPEN_PAYMENT_LINKS');
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
    });

    it('re-checks inside the transaction: money that appears after the first check still refuses', async () => {
        await build();
        // First check (outside) sees nothing; the in-transaction re-check sees a payout.
        prisma.payoutRequest.count.mockResolvedValueOnce(0).mockResolvedValue(1);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        const res = await del(headers);
        expect(res.statusCode).toBe(409);
        expect(res.json().blockers[0].code).toBe('MONEY_HISTORY');
        expect(prisma.tenant.delete).not.toHaveBeenCalled();
        expect(prisma.audits.some((a) => a.action === 'tenant.deleted')).toBe(false);
    });

    it('404 for an unknown organisation', async () => {
        await build(null);
        const { headers } = signedInAs(app, prisma, 'OWNER');
        expect((await del(headers)).statusCode).toBe(404);
    });
});
