/** Admin waitlist: list, counts, status/notes, delete, invite, CSV export. Guarded and audited. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mail = vi.hoisted(() => ({
    creds: { user: 'hello@bookly.test', appPassword: 'x', source: 'platform' } as unknown,
    sendEmail: vi.fn(async (_a: { to: string; subject: string; text: string; html?: string }) => ({ ok: true }) as { ok: boolean; error?: string }),
}));
vi.mock('../../services/gmail-smtp.js', () => ({ resolveGmailCreds: () => mail.creds, sendEmail: mail.sendEmail }));

import adminWaitlistRoutes from './waitlist.js';
import { buildAdminTestApp, makePrisma, signedInAs, type PrismaStub } from './test-kit.js';
import { hashInviteToken, INVITE_TTL_DAYS } from '../../services/waitlist.js';
import { makeWaitlistStore, waitlistRow, type WaitlistRow, type WaitlistStore } from '../../test-utils/waitlist-store.js';

let app: FastifyInstance;
let prisma: PrismaStub;
let store: WaitlistStore;

async function build(rows: WaitlistRow[] = [waitlistRow()]) {
    prisma = makePrisma();
    store = makeWaitlistStore(rows);
    Object.assign(prisma.waitlistEntry, store);
    app = await buildAdminTestApp(async (s) => { await s.register(adminWaitlistRoutes); }, { prisma });
}

beforeEach(() => {
    mail.sendEmail.mockReset();
    mail.sendEmail.mockImplementation(async () => ({ ok: true }));
    mail.creds = { user: 'hello@bookly.test', appPassword: 'x', source: 'platform' };
});
afterEach(async () => { await app?.close(); });

const as = (role: string) => signedInAs(app, prisma, role).headers;

describe('GET /admin/waitlist', () => {
    it('lists entries newest first with pagination, filters and search passed to the query', async () => {
        await build([waitlistRow({ id: 'w1' }), waitlistRow({ id: 'w2', email: 'b@x.co' })]);
        const res = await app.inject({ url: '/admin/waitlist?status=NEW&businessType=skin_clinic&search=Glow&page=2&limit=10', headers: as('READONLY') });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.pagination).toEqual({ page: 2, limit: 10, total: 2, totalPages: 1 });
        expect(body.data).toHaveLength(2);
        const args = store.findMany.mock.calls[0][0] as any;
        expect(args).toMatchObject({ orderBy: { createdAt: 'desc' }, skip: 10, take: 10 });
        expect(JSON.stringify(args.where)).toContain('"status":"NEW"');
        expect(JSON.stringify(args.where)).toContain('"businessType":"skin_clinic"');
        expect(JSON.stringify(args.where)).toContain('Glow');
        expect(store.count).toHaveBeenCalledWith({ where: args.where });
    });

    it('rows carry every field the drawer needs and an invite state, but never the token hash', async () => {
        await build([waitlistRow({ status: 'INVITED', inviteTokenHash: 'secret-hash', inviteExpiresAt: new Date(Date.now() + 86_400_000) })]);
        const row = (await app.inject({ url: '/admin/waitlist', headers: as('OWNER') })).json().data[0];
        expect(row).toMatchObject({ id: 'w1', name: 'Ama Mensah', email: 'ama@glow.com', phone: '+233244123456', inviteState: 'valid' });
        expect(row).not.toHaveProperty('inviteTokenHash');
        expect(JSON.stringify(row)).not.toContain('secret-hash');
    });

    it('400 on an unknown status filter', async () => {
        await build();
        expect((await app.inject({ url: '/admin/waitlist?status=NOPE', headers: as('OWNER') })).statusCode).toBe(400);
    });

    it('FINANCE has no waitlist access; 401 without a token', async () => {
        await build();
        expect((await app.inject({ url: '/admin/waitlist', headers: as('FINANCE') })).statusCode).toBe(403);
        expect((await app.inject({ url: '/admin/waitlist' })).statusCode).toBe(401);
    });
});

describe('GET /admin/waitlist/summary', () => {
    it('total, new this week, and counts by status (zero-filled) and by business type', async () => {
        await build();
        store.count.mockImplementation((async (args?: any) => (args?.where?.createdAt ? 3 : 9)) as any);
        store.groupBy.mockImplementation((async (args: any) => (args.by[0] === 'status'
            ? [{ status: 'NEW', _count: { _all: 6 } }, { status: 'INVITED', _count: { _all: 3 } }]
            : [{ businessType: 'spa', _count: { _all: 5 } }, { businessType: 'dental', _count: { _all: 4 } }])) as any);
        const res = await app.inject({ url: '/admin/waitlist/summary', headers: as('READONLY') });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toEqual({
            total: 9,
            newThisWeek: 3,
            byStatus: { NEW: 6, CONTACTED: 0, INVITED: 3, JOINED: 0, DECLINED: 0 },
            byBusinessType: { spa: 5, dental: 4 },
        });
        const weekArg = store.count.mock.calls.find((c: any[]) => c[0]?.where?.createdAt)![0] as any;
        const since = weekArg.where.createdAt.gte as Date;
        expect(Date.now() - since.getTime()).toBeGreaterThan(6.9 * 86_400_000);
        expect(Date.now() - since.getTime()).toBeLessThan(7.1 * 86_400_000);
    });
});

describe('PATCH /admin/waitlist/:id', () => {
    it('changes the status and audits it (from -> to)', async () => {
        await build();
        const { headers, row: admin } = signedInAs(app, prisma, 'SUPPORT');
        const res = await app.inject({ method: 'PATCH', url: '/admin/waitlist/w1', headers, payload: { status: 'CONTACTED' } });
        expect(res.statusCode).toBe(200);
        expect(res.json().data).toMatchObject({ id: 'w1', status: 'CONTACTED' });
        expect(store.rows.get('w1')!.status).toBe('CONTACTED');
        expect(prisma.audits.at(-1)).toMatchObject({
            action: 'waitlist.status_changed', actorType: 'ADMIN', actorId: admin.id,
            targetType: 'WaitlistEntry', targetId: 'w1', metadata: { from: 'NEW', to: 'CONTACTED' },
        });
    });

    it('saves admin notes (no audit row for notes alone: they are free text)', async () => {
        await build();
        const res = await app.inject({ method: 'PATCH', url: '/admin/waitlist/w1', headers: as('OWNER'), payload: { adminNotes: 'Called, wants a demo Tuesday' } });
        expect(res.statusCode).toBe(200);
        expect(store.rows.get('w1')!.adminNotes).toBe('Called, wants a demo Tuesday');
        expect(prisma.audits).toHaveLength(0);
    });

    it('validates: unknown status, over-long notes, empty body', async () => {
        await build();
        const h = as('OWNER');
        for (const payload of [{ status: 'MAYBE' }, { adminNotes: 'x'.repeat(2001) }, {}]) {
            expect((await app.inject({ method: 'PATCH', url: '/admin/waitlist/w1', headers: h, payload })).statusCode).toBe(400);
        }
    });

    it('404 for an unknown entry; READONLY cannot change anything', async () => {
        await build();
        expect((await app.inject({ method: 'PATCH', url: '/admin/waitlist/nope', headers: as('OWNER'), payload: { status: 'CONTACTED' } })).statusCode).toBe(404);
        expect((await app.inject({ method: 'PATCH', url: '/admin/waitlist/w1', headers: as('READONLY'), payload: { status: 'CONTACTED' } })).statusCode).toBe(403);
        expect(store.rows.get('w1')!.status).toBe('NEW');
    });
});

describe('DELETE /admin/waitlist/:id', () => {
    it('deletes and audits, with only a masked email in the audit row', async () => {
        await build();
        const res = await app.inject({ method: 'DELETE', url: '/admin/waitlist/w1', headers: as('OWNER') });
        expect(res.statusCode).toBe(200);
        expect(store.rows.size).toBe(0);
        const row = prisma.audits.at(-1);
        expect(row).toMatchObject({ action: 'waitlist.deleted', targetType: 'WaitlistEntry', targetId: 'w1' });
        expect(JSON.stringify(row)).not.toContain('ama@glow.com');
        expect(JSON.stringify(row)).not.toContain('244123456');
        expect(row.metadata.email).toMatch(/^a•+@glow\.com$/);
    });

    it('404 for an unknown entry; READONLY refused', async () => {
        await build();
        expect((await app.inject({ method: 'DELETE', url: '/admin/waitlist/nope', headers: as('OWNER') })).statusCode).toBe(404);
        expect((await app.inject({ method: 'DELETE', url: '/admin/waitlist/w1', headers: as('READONLY') })).statusCode).toBe(403);
    });
});

describe('POST /admin/waitlist/:id/invite', () => {
    const invite = (payload: object = {}, role = 'OWNER', id = 'w1') =>
        app.inject({ method: 'POST', url: `/admin/waitlist/${id}/invite`, headers: as(role), payload });

    it('returns a one-time /register?invite= link valid for 14 days and stores ONLY its hash', async () => {
        await build();
        const res = await invite();
        expect(res.statusCode).toBe(200);
        const { link, expiresAt, emailed } = res.json().data;
        const url = new URL(link);
        expect(url.pathname).toBe('/register');
        const token = url.searchParams.get('invite')!;
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(emailed).toBe(false);
        expect(mail.sendEmail).not.toHaveBeenCalled();

        const row = store.rows.get('w1')!;
        expect(row.inviteTokenHash).toBe(hashInviteToken(token));
        expect(JSON.stringify(row)).not.toContain(token);
        expect(row.status).toBe('INVITED');
        expect(row.invitedByAdminId).toBe('admin-owner');
        expect(row.inviteUsedAt).toBeNull();
        const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(INVITE_TTL_DAYS - 0.01);
        expect(days).toBeLessThan(INVITE_TTL_DAYS + 0.01);
    });

    it('audits the invite without the link or token', async () => {
        await build();
        const res = await invite();
        const token = new URL(res.json().data.link).searchParams.get('invite')!;
        const row = prisma.audits.at(-1);
        expect(row).toMatchObject({ action: 'waitlist.invited', targetType: 'WaitlistEntry', targetId: 'w1', metadata: expect.objectContaining({ emailed: false }) });
        expect(JSON.stringify(row)).not.toContain(token);
        expect(JSON.stringify(row)).not.toContain(hashInviteToken(token));
    });

    it('optionally emails the branded "You\'re invited" message to the entry\'s address', async () => {
        await build();
        const res = await invite({ sendEmail: true });
        expect(res.json().data.emailed).toBe(true);
        expect(mail.sendEmail).toHaveBeenCalledTimes(1);
        const sent = mail.sendEmail.mock.calls[0][0];
        expect(sent.to).toBe('ama@glow.com');
        expect(sent.subject).toBe("You're invited to Bookly");
        expect(sent.text).toContain(res.json().data.link);
    });

    it('a failed or impossible email still returns the link to pass on by hand', async () => {
        await build();
        mail.sendEmail.mockImplementation(async () => ({ ok: false, error: 'smtp down' }));
        let data = (await invite({ sendEmail: true })).json().data;
        expect(data).toMatchObject({ emailed: false, emailError: 'send_failed' });
        expect(data.link).toContain('/register?invite=');
        mail.creds = null;
        data = (await invite({ sendEmail: true })).json().data;
        expect(data).toMatchObject({ emailed: false, emailError: 'email_not_configured' });
    });

    it('a new invite replaces the old one (the old link stops working)', async () => {
        await build();
        const first = new URL((await invite()).json().data.link).searchParams.get('invite')!;
        const second = new URL((await invite()).json().data.link).searchParams.get('invite')!;
        expect(second).not.toBe(first);
        expect(store.rows.get('w1')!.inviteTokenHash).toBe(hashInviteToken(second));
    });

    it('an invite racing a sign-up changes nothing once they have joined (guarded write)', async () => {
        await build();
        // They sign up between the read and the write.
        store.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
        const res = await invite();
        expect(res.statusCode).toBe(409);
        expect(store.rows.get('w1')!.inviteTokenHash).toBeNull();
        expect(prisma.audits).toHaveLength(0);
    });

    it('409 for someone who already joined; 404 for an unknown entry', async () => {
        await build([waitlistRow({ status: 'JOINED', joinedTenantId: 't1', inviteUsedAt: new Date() })]);
        expect((await invite()).statusCode).toBe(409);
        expect((await invite({}, 'OWNER', 'nope')).statusCode).toBe(404);
    });

    it('SUPPORT may invite; READONLY and FINANCE may not', async () => {
        await build();
        expect((await invite({}, 'SUPPORT')).statusCode).toBe(200);
        expect((await invite({}, 'READONLY')).statusCode).toBe(403);
        expect((await invite({}, 'FINANCE')).statusCode).toBe(403);
    });
});

describe('GET /admin/waitlist/export.csv', () => {
    it('UTF-8 CSV with a BOM, every column, formula-looking cells defused; audited with the row count', async () => {
        await build([
            waitlistRow({ id: 'w1', name: '=HYPERLINK("http://evil","click")', businessName: 'Adwoa’s Spa, Osu', city: '@Kumasi', message: '-1+1' }),
            waitlistRow({ id: 'w2', email: 'b@x.co', name: 'Kofi' }),
        ]);
        const res = await app.inject({ url: '/admin/waitlist/export.csv?status=NEW', headers: as('SUPPORT') });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
        expect(res.headers['content-disposition']).toMatch(/^attachment; filename="bookly-waitlist-\d{4}-\d{2}-\d{2}\.csv"$/);
        const body = res.body;
        expect(body.startsWith('\uFEFF')).toBe(true);
        const [header] = body.slice(1).split('\r\n');
        expect(header).toBe('created_at,name,business_name,business_type,phone,email,city,heard_from,message,status,admin_notes,invited_at,invite_expires_at,joined_tenant_id,consent_at');
        expect(body).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
        expect(body).toContain("'+233244123456");
        expect(body).toContain("'@Kumasi");
        expect(body).toContain("'-1+1");
        expect(body).toContain('"Adwoa’s Spa, Osu"');
        expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
        expect(prisma.audits.at(-1)).toMatchObject({ action: 'waitlist.exported', metadata: expect.objectContaining({ rows: 2 }) });
    });

    it('READONLY and FINANCE cannot export the list', async () => {
        await build();
        expect((await app.inject({ url: '/admin/waitlist/export.csv', headers: as('READONLY') })).statusCode).toBe(403);
        expect((await app.inject({ url: '/admin/waitlist/export.csv', headers: as('FINANCE') })).statusCode).toBe(403);
    });
});
