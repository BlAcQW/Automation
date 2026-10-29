/**
 * Waitlist on real Postgres, through the REAL guarded client and the REAL
 * /auth/register route:
 *  - joining twice with one email (any case, even concurrently) leaves ONE row;
 *  - search / filters / counts produce the right rows (the where-builder and
 *    groupBy against the real engine, not a stub);
 *  - an invite is stored only as a hash; signing up with it creates the
 *    organisation and marks the entry JOINED with that organisation's id;
 *  - an invite can be consumed once, even by concurrent transactions;
 *  - while registration is closed a sign-up without an invite creates nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import authRoutes from '../../src/routes/auth/index.js';
import {
    createInvite,
    hashInviteToken,
    joinWaitlist,
    listWaitlist,
    waitlistListQuerySchema,
    waitlistSummary,
} from '../../src/services/waitlist.js';
import { consumeInvite } from '../../src/services/registration-gate.js';
import { rawPrisma, guardedPrisma } from './helpers/db.js';
import { race } from './helpers/concurrency.js';
import { seedTenant } from './helpers/seed.js';

vi.mock('../../src/services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));

const form = (over: Record<string, unknown> = {}) => ({
    name: 'Ama Mensah', businessName: 'Glow Skin Clinic', businessType: 'skin_clinic' as const,
    phone: '+233244123456', email: 'ama@glow.com', city: 'East Legon', consent: true as const, ...over,
});

let app: FastifyInstance;
const ORIGINAL_OPEN = process.env.REGISTRATION_OPEN;

beforeEach(async () => {
    delete process.env.REGISTRATION_OPEN;
    app = Fastify({ logger: false });
    app.decorate('jwt', { sign: () => 'signed.jwt.token', verify: () => ({}) } as never);
    app.decorate('authenticate', async () => undefined);
    await app.register(cookie);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(prismaPlugin);
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
});
afterEach(async () => {
    await app.close();
    if (ORIGINAL_OPEN === undefined) delete process.env.REGISTRATION_OPEN;
    else process.env.REGISTRATION_OPEN = ORIGINAL_OPEN;
});

const signUp = (payload: Record<string, unknown>) => app.inject({
    method: 'POST', url: '/auth/register',
    payload: { password: 'password123', name: 'Ama', businessName: 'Glow', acceptTerms: true, ...payload },
});

describe('joining', () => {
    it('one email is one row: a second join (other case) updates it, the status is kept', async () => {
        const prisma = await guardedPrisma();
        const first = await joinWaitlist(prisma, form());
        await rawPrisma().waitlistEntry.update({ where: { id: first.entry.id }, data: { status: 'CONTACTED' } });
        const second = await joinWaitlist(prisma, form({ email: 'AMA@Glow.com', city: 'Osu', phone: '+233201112222' }));
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        const rows = await rawPrisma().waitlistEntry.findMany();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ email: 'ama@glow.com', city: 'Osu', phone: '+233201112222', status: 'CONTACTED' });
    });

    it('concurrent joins with the same email never fail and never duplicate', async () => {
        const prisma = await guardedPrisma();
        const { ok, failed } = await race(6, (i) => joinWaitlist(prisma, form({ city: `Area ${i}` })));
        expect(failed).toEqual([]);
        expect(ok).toHaveLength(6);
        expect(await rawPrisma().waitlistEntry.count()).toBe(1);
    });
});

describe('listing, search and counts', () => {
    beforeEach(async () => {
        const prisma = await guardedPrisma();
        await joinWaitlist(prisma, form());
        await joinWaitlist(prisma, form({ name: 'Kofi Boateng', businessName: 'Kofi Cuts', businessType: 'salon_barber', email: 'kofi@cuts.gh', phone: '+233201234567' }));
        await joinWaitlist(prisma, form({ name: 'Efua Sam', businessName: 'Smile Dental', businessType: 'dental', email: 'efua@smile.gh', phone: '+233551112222' }));
        await rawPrisma().waitlistEntry.update({ where: { email: 'efua@smile.gh' }, data: { status: 'DECLINED' } });
    });

    const list = async (q: Record<string, string>) =>
        (await listWaitlist(await guardedPrisma(), waitlistListQuerySchema.parse(q))).rows.map((r) => r.email).sort();

    it('searches name, business, email and a phone typed in local format', async () => {
        expect(await list({ search: 'kofi' })).toEqual(['kofi@cuts.gh']);
        expect(await list({ search: 'SMILE' })).toEqual(['efua@smile.gh']);
        expect(await list({ search: 'glow.com' })).toEqual(['ama@glow.com']);
        expect(await list({ search: '020 123 4567' })).toEqual(['kofi@cuts.gh']);
    });

    it('filters by status and business type, and pages', async () => {
        expect(await list({ status: 'DECLINED' })).toEqual(['efua@smile.gh']);
        expect(await list({ businessType: 'salon_barber' })).toEqual(['kofi@cuts.gh']);
        expect(await list({ status: 'NEW', businessType: 'dental' })).toEqual([]);
        const page = await listWaitlist(await guardedPrisma(), waitlistListQuerySchema.parse({ limit: '2', page: '2' }));
        expect(page.total).toBe(3);
        expect(page.rows).toHaveLength(1);
    });

    it('counts by status and type on the real engine', async () => {
        const s = await waitlistSummary(await guardedPrisma(), new Date());
        expect(s).toMatchObject({
            total: 3,
            newThisWeek: 3,
            byStatus: { NEW: 2, CONTACTED: 0, INVITED: 0, JOINED: 0, DECLINED: 1 },
            byBusinessType: { skin_clinic: 1, salon_barber: 1, dental: 1 },
        });
    });
});

describe('invites and the registration gate', () => {
    it('stores only the hash; the invite signs them up, creates the organisation and marks them JOINED', async () => {
        const prisma = await guardedPrisma();
        const { entry } = await joinWaitlist(prisma, form());
        const invite = await createInvite(prisma, { id: entry.id, adminId: 'admin-1' });
        const stored = await rawPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
        expect(stored.inviteTokenHash).toBe(hashInviteToken(invite.token));
        expect(JSON.stringify(stored)).not.toContain(invite.token);
        expect(stored.status).toBe('INVITED');

        const res = await signUp({ email: 'ama@glow.com', inviteToken: invite.token });
        expect(res.statusCode).toBe(200);
        const tenantId = res.json().tenant.id;
        const after = await rawPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
        expect(after).toMatchObject({ status: 'JOINED', joinedTenantId: tenantId });
        expect(after.inviteUsedAt).toBeInstanceOf(Date);
        expect(await rawPrisma().tenant.count({ where: { id: tenantId } })).toBe(1);

        const again = await signUp({ email: 'ama@glow.com', inviteToken: invite.token });
        expect(again.statusCode).toBe(403);
        expect(again.json().code).toBe('INVITE_USED');
    });

    it('closed and no invite: 403 WAITLIST_ONLY and nothing is created', async () => {
        const res = await signUp({ email: 'nobody@x.co' });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('WAITLIST_ONLY');
        expect(await rawPrisma().tenant.count()).toBe(0);
        expect(await rawPrisma().user.count()).toBe(0);
    });

    it('open: signs up without an invite', async () => {
        process.env.REGISTRATION_OPEN = 'true';
        const res = await signUp({ email: 'open@x.co' });
        expect(res.statusCode).toBe(200);
        expect(await rawPrisma().tenant.count()).toBe(1);
    });

    it('an invite is consumed once, even by concurrent transactions', async () => {
        const prisma = await guardedPrisma();
        const { entry } = await joinWaitlist(prisma, form());
        const invite = await createInvite(prisma, { id: entry.id, adminId: 'admin-1' });
        const tenants = await Promise.all([seedTenant(), seedTenant(), seedTenant(), seedTenant()]);
        const { ok, failed } = await race(4, (i) => rawPrisma().$transaction((tx) =>
            consumeInvite(tx, { entryId: entry.id, tokenHash: hashInviteToken(invite.token) }, tenants[i].id, new Date())));
        expect(ok).toHaveLength(1);
        expect(failed).toHaveLength(3);
        for (const f of failed) expect(f.publicCode).toBe('INVITE_USED');
        const after = await rawPrisma().waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
        expect(tenants.map((t) => t.id)).toContain(after.joinedTenantId);
    });
});
