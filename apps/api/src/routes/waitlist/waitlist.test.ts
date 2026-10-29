/**
 * Public waitlist: POST /waitlist (join) and GET /waitlist/invite (check a
 * link). Real Fastify + error handler + rate limiter over an in-memory table.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { Writable } from 'node:stream';
import errorHandler from '../../plugins/error-handler.js';
import { hashInviteToken } from '../../services/waitlist.js';
import { makeWaitlistStore, waitlistRow, type WaitlistStore } from '../../test-utils/waitlist-store.js';

const mail = vi.hoisted(() => ({
    creds: { user: 'hello@bookly.test', appPassword: 'x', source: 'platform' } as unknown,
    sendEmail: vi.fn(async (_args: { to: string; subject: string; text: string; html?: string }) => ({ ok: true })),
}));
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => mail.creds,
    sendEmail: mail.sendEmail,
}));

import waitlistRoutes from './index.js';

let app: FastifyInstance;
let store: WaitlistStore;
const makeAlerts = () => ({ upsert: vi.fn(async (_args: unknown) => ({})), update: vi.fn(async (_args: unknown) => ({})) });
let platformAlert: ReturnType<typeof makeAlerts>;
let logs: string[];

async function build(initial = [] as ReturnType<typeof waitlistRow>[]) {
    store = makeWaitlistStore(initial);
    platformAlert = makeAlerts();
    logs = [];
    const stream = new Writable({ write(chunk, _enc, cb) { logs.push(String(chunk)); cb(); } });
    app = Fastify({ logger: { level: 'trace', stream } });
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
    await app.register(fp(async (a) => { a.decorate('prisma', { waitlistEntry: store, platformAlert } as never); }, { name: 'prisma' }));
    await app.register(waitlistRoutes, { prefix: '/waitlist' });
    await app.ready();
}

beforeEach(() => {
    mail.sendEmail.mockClear();
    mail.sendEmail.mockImplementation(async () => ({ ok: true }));
    mail.creds = { user: 'hello@bookly.test', appPassword: 'x', source: 'platform' };
});
afterEach(async () => { await app?.close(); });

const form = {
    name: 'Ama Mensah',
    businessName: 'Glow Skin Clinic',
    businessType: 'skin_clinic',
    phone: '024 412 3456',
    email: 'Ama@Glow.com',
    city: 'East Legon, Accra',
    heardFrom: 'Instagram',
    message: 'Facials and peels.',
    consent: true,
};

const join = (payload: unknown, ip = '10.0.0.1') =>
    app.inject({ method: 'POST', url: '/waitlist', payload: payload as object, remoteAddress: ip });

describe('POST /waitlist', () => {
    it('stores a valid entry (email lower-cased, phone in +233 E.164, status NEW, consent time)', async () => {
        await build();
        const res = await join(form);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const [row] = [...store.rows.values()];
        expect(row).toMatchObject({
            name: 'Ama Mensah', businessName: 'Glow Skin Clinic', businessType: 'skin_clinic',
            phone: '+233244123456', email: 'ama@glow.com', city: 'East Legon, Accra',
            heardFrom: 'Instagram', message: 'Facials and peels.', status: 'NEW',
        });
        expect(row.consentAt).toBeInstanceOf(Date);
    });

    it('sends the branded "You\'re on the Bookly waitlist" email to them', async () => {
        await build();
        await join(form);
        await vi.waitFor(() => expect(mail.sendEmail).toHaveBeenCalledTimes(1));
        const sent = mail.sendEmail.mock.calls[0][0];
        expect(sent.to).toBe('ama@glow.com');
        expect(sent.subject).toBe("You're on the Bookly waitlist");
        expect(sent.html).toContain('Your shop, always open.');
    });

    it('raises one rolling info alert for the admins, with no email or phone in it', async () => {
        await build();
        await join(form);
        expect(platformAlert.upsert).toHaveBeenCalledTimes(1);
        const arg = platformAlert.upsert.mock.calls[0][0] as any;
        expect(arg.where).toEqual({ dedupeKey: 'waitlist:joined' });
        expect(arg.create).toMatchObject({ kind: 'waitlist.joined', severity: 'info' });
        expect(arg.create.message).toContain('Glow Skin Clinic');
        const text = JSON.stringify(arg);
        expect(text).not.toContain('ama@glow.com');
        expect(text).not.toContain('244123456');
    });

    it('400 with field messages for an invalid form; nothing stored, nothing sent', async () => {
        await build();
        const res = await join({ ...form, email: 'nope', businessType: 'casino', consent: false });
        expect(res.statusCode).toBe(400);
        const fields = res.json().fields.map((f: { field: string }) => f.field);
        expect(fields).toEqual(expect.arrayContaining(['email', 'businessType', 'consent']));
        expect(store.rows.size).toBe(0);
        expect(mail.sendEmail).not.toHaveBeenCalled();
    });

    it('honeypot filled in: answers exactly like a success, but stores and sends nothing', async () => {
        await build();
        const res = await join({ ...form, website: 'http://cheap-pills.example' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        expect(store.rows.size).toBe(0);
        expect(platformAlert.upsert).not.toHaveBeenCalled();
        await new Promise((r) => setTimeout(r, 20));
        expect(mail.sendEmail).not.toHaveBeenCalled();
    });

    it('the same email again (any case) updates the entry instead of adding one; the answer is identical', async () => {
        await build();
        const first = await join(form);
        const second = await join({ ...form, email: 'AMA@glow.COM', phone: '0201112222', city: 'Osu', message: 'Now two branches.' });
        expect(second.statusCode).toBe(first.statusCode);
        expect(second.body).toBe(first.body);
        expect(store.rows.size).toBe(1);
        expect([...store.rows.values()][0]).toMatchObject({ phone: '+233201112222', city: 'Osu', message: 'Now two branches.', status: 'NEW' });
    });

    it('joining again does not email or alert a second time', async () => {
        await build();
        await join(form);
        await join(form);
        await new Promise((r) => setTimeout(r, 20));
        expect(mail.sendEmail).toHaveBeenCalledTimes(1);
        expect(platformAlert.upsert).toHaveBeenCalledTimes(1);
    });

    it('joining again keeps the admin status (a CONTACTED entry stays CONTACTED)', async () => {
        await build([waitlistRow({ status: 'CONTACTED', adminNotes: 'Called on Monday' })]);
        await join(form);
        expect([...store.rows.values()][0]).toMatchObject({ status: 'CONTACTED', adminNotes: 'Called on Monday', city: 'East Legon, Accra' });
    });

    it('an INVITED or JOINED entry is left untouched (the invite keeps its address and number)', async () => {
        const invited = waitlistRow({ status: 'INVITED', inviteTokenHash: 'h', phone: '+233200000001', city: 'Kumasi' });
        await build([invited]);
        const res = await join({ ...form, phone: '0559998888', city: 'Takoradi' });
        expect(res.json()).toEqual({ success: true });
        expect([...store.rows.values()][0]).toMatchObject({ status: 'INVITED', inviteTokenHash: 'h', phone: '+233200000001', city: 'Kumasi' });
    });

    it('a failed confirmation email never fails the join', async () => {
        await build();
        mail.sendEmail.mockImplementation(async () => ({ ok: false, error: 'smtp down' }) as never);
        const res = await join(form);
        expect(res.statusCode).toBe(200);
        expect(store.rows.size).toBe(1);
    });

    it('no email sender configured: still joins', async () => {
        await build();
        mail.creds = null;
        expect((await join(form)).statusCode).toBe(200);
        expect(store.rows.size).toBe(1);
    });

    it('is rate-limited to 5 per hour per IP', async () => {
        await build();
        const codes: number[] = [];
        for (let i = 0; i < 6; i += 1) codes.push((await join({ ...form, email: `p${i}@glow.com` }, '10.9.9.9')).statusCode);
        expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
        expect((await join({ ...form, email: 'other@glow.com' }, '10.9.9.10')).statusCode).toBe(200);
    });

    it('never logs the full email or phone', async () => {
        await build();
        await join(form);
        await join({ ...form, email: 'bad' });
        await vi.waitFor(() => expect(mail.sendEmail).toHaveBeenCalled());
        const all = logs.join('\n');
        expect(all.length).toBeGreaterThan(0);
        expect(all).not.toMatch(/ama@glow\.com/i);
        expect(all).not.toContain('244123456');
        expect(all).not.toContain('412 3456');
    });
});

describe('GET /waitlist/invite', () => {
    const token = 'a'.repeat(43);
    const hash = hashInviteToken(token);
    const future = new Date(Date.now() + 3 * 86_400_000);
    const check = (t: string | undefined, ip = '10.0.0.1') =>
        app.inject({ method: 'GET', url: t === undefined ? '/waitlist/invite' : `/waitlist/invite?token=${encodeURIComponent(t)}`, remoteAddress: ip });

    it('valid: returns who it is for, so the sign-up form can be prefilled', async () => {
        await build([waitlistRow({ status: 'INVITED', inviteTokenHash: hash, inviteExpiresAt: future })]);
        const res = await check(token);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            status: 'valid', email: 'ama@glow.com', name: 'Ama Mensah', businessName: 'Glow Skin Clinic',
            expiresAt: future.toISOString(),
        });
        expect(store.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { inviteTokenHash: hash } }));
    });

    it('expired / used / unknown: says which, and gives away nothing else', async () => {
        await build([
            waitlistRow({ id: 'w1', email: 'a@x.co', status: 'INVITED', inviteTokenHash: hashInviteToken('e'.repeat(43)), inviteExpiresAt: new Date(Date.now() - 1000) }),
            waitlistRow({ id: 'w2', email: 'b@x.co', status: 'JOINED', inviteTokenHash: hashInviteToken('u'.repeat(43)), inviteExpiresAt: future, inviteUsedAt: new Date() }),
        ]);
        expect((await check('e'.repeat(43))).json()).toEqual({ status: 'expired' });
        expect((await check('u'.repeat(43))).json()).toEqual({ status: 'used' });
        expect((await check('z'.repeat(43))).json()).toEqual({ status: 'invalid' });
    });

    it('400 without a token; oversized tokens are refused before any lookup', async () => {
        await build();
        expect((await check(undefined)).statusCode).toBe(400);
        expect((await check('x'.repeat(500))).statusCode).toBe(400);
        expect(store.findUnique).not.toHaveBeenCalled();
    });

    it('is rate-limited per IP', async () => {
        await build();
        const codes: number[] = [];
        for (let i = 0; i < 21; i += 1) codes.push((await check(token, '10.7.7.7')).statusCode);
        expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
        expect(codes[20]).toBe(429);
    });
});
