/**
 * Registration gate: self sign-up is CLOSED unless REGISTRATION_OPEN=true.
 * While closed, POST /auth/register needs a valid, unexpired, unused waitlist
 * invite for the same email; the invite is consumed in the sign-up
 * transaction and the entry becomes JOINED with the new organisation's id.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import errorHandler from '../../plugins/error-handler.js';
import { hashInviteToken } from '../../services/waitlist.js';
import { makeWaitlistStore, waitlistRow, type WaitlistRow } from '../../test-utils/waitlist-store.js';

const audits = vi.hoisted(() => [] as any[]);
vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async (a: any) => { audits.push(a); }) }));
vi.mock('../../services/gmail-smtp.js', () => ({
    resolveGmailCreds: () => null,
    sendEmail: vi.fn(async () => ({ ok: true })),
}));

import authRoutes from './index.js';

const TOKEN = 'T'.repeat(43);
const HASH = hashInviteToken(TOKEN);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

async function build(rows: WaitlistRow[] = []) {
    const store = makeWaitlistStore(rows);
    const tx = {
        tenant: { create: vi.fn(async ({ data }: any) => ({ id: 'tenant-new', name: data.name, businessType: 'SERVICE', timezone: data.timezone, ...data })) },
        $executeRaw: vi.fn(async () => 1),
        user: {
            create: vi.fn(async ({ data }: any) => ({ id: 'user-new', ...data })),
            findFirst: vi.fn(async () => null),
        },
        workingHours: { createMany: vi.fn(async () => ({ count: 5 })) },
        wallet: { create: vi.fn(async ({ data }: any) => ({ id: 'w1', ...data })) },
        waitlistEntry: store,
    };
    let committed = true;
    const app = Fastify();
    app.decorate('jwt', { sign: () => 'signed.jwt.token', verify: () => ({}) } as any);
    app.decorate('authenticate', async () => undefined);
    app.decorate('prisma', {
        user: { findFirst: async () => null },
        waitlistEntry: store,
        $transaction: async (fn: any) => {
            // Roll back the waitlist table when the transaction throws, like Postgres would.
            const snapshot = new Map([...store.rows].map(([k, v]) => [k, { ...v }]));
            try { return await fn(tx); } catch (err) {
                committed = false;
                store.rows.clear();
                for (const [k, v] of snapshot) store.rows.set(k, v);
                throw err;
            }
        },
    } as any);
    await app.register(cookie);
    await app.register(sensible);
    await app.register(errorHandler);
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
    return { app, store, tx, committed: () => committed };
}

const signUp = (app: any, extra: Record<string, unknown> = {}) => app.inject({
    method: 'POST', url: '/auth/register',
    payload: { email: 'ama@glow.com', password: 'password123', name: 'Ama', businessName: 'Glow', acceptTerms: true, ...extra },
});

const invited = (over: Partial<WaitlistRow> = {}) =>
    waitlistRow({ status: 'INVITED', inviteTokenHash: HASH, invitedAt: new Date(), inviteExpiresAt: inDays(14), ...over });

const ORIGINAL = process.env.REGISTRATION_OPEN;
beforeEach(() => { delete process.env.REGISTRATION_OPEN; audits.length = 0; });
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.REGISTRATION_OPEN;
    else process.env.REGISTRATION_OPEN = ORIGINAL;
});

describe('registration closed (the default)', () => {
    it('refuses sign-up without an invite: 403 WAITLIST_ONLY, no tenant created', async () => {
        const { app, tx } = await build();
        const res = await signUp(app);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ code: 'WAITLIST_ONLY' });
        expect(res.json().message).toMatch(/waitlist/i);
        expect(tx.tenant.create).not.toHaveBeenCalled();
    });

    it('anything but exactly "true" keeps it closed (secure default)', async () => {
        for (const v of ['', 'false', '1', 'yes', 'TRUE ']) {
            process.env.REGISTRATION_OPEN = v;
            const { app } = await build();
            const res = await signUp(app);
            expect(res.statusCode, `REGISTRATION_OPEN=${JSON.stringify(v)}`).toBe(v.trim().toLowerCase() === 'true' ? 200 : 403);
        }
    });

    it('a valid invite for the same email: registers, consumes the invite, marks JOINED with the new organisation', async () => {
        const { app, store, tx } = await build([invited()]);
        const res = await signUp(app, { inviteToken: TOKEN, email: 'Ama@Glow.com' });
        expect(res.statusCode).toBe(200);
        expect(res.json().tenant.id).toBe('tenant-new');
        expect(tx.tenant.create).toHaveBeenCalledTimes(1);
        const row = store.rows.get('w1')!;
        expect(row.status).toBe('JOINED');
        expect(row.joinedTenantId).toBe('tenant-new');
        expect(row.inviteUsedAt).toBeInstanceOf(Date);
        // Consumed inside the sign-up transaction, guarded so only one sign-up can win.
        expect(store.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'w1', inviteTokenHash: HASH, inviteUsedAt: null, status: 'INVITED' }),
        }));
        expect(audits.find((a) => a.action === 'waitlist.joined')).toMatchObject({ tenantId: 'tenant-new', targetId: 'w1' });
    });

    it('the same invite cannot be used twice', async () => {
        const { app } = await build([invited()]);
        expect((await signUp(app, { inviteToken: TOKEN })).statusCode).toBe(200);
        const again = await signUp(app, { inviteToken: TOKEN });
        expect(again.statusCode).toBe(403);
        expect(again.json().code).toBe('INVITE_USED');
    });

    it('an expired invite is refused (INVITE_EXPIRED) and nothing is created', async () => {
        const { app, tx, store } = await build([invited({ inviteExpiresAt: new Date(Date.now() - 1000) })]);
        const res = await signUp(app, { inviteToken: TOKEN });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('INVITE_EXPIRED');
        expect(tx.tenant.create).not.toHaveBeenCalled();
        expect(store.rows.get('w1')!.status).toBe('INVITED');
    });

    it('an already-used invite is refused (INVITE_USED)', async () => {
        const { app } = await build([invited({ status: 'JOINED', inviteUsedAt: new Date(), joinedTenantId: 't-old' })]);
        const res = await signUp(app, { inviteToken: TOKEN });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('INVITE_USED');
    });

    it('an unknown token, or one for an entry no longer INVITED (declined), is refused (INVITE_INVALID)', async () => {
        const { app } = await build([invited({ status: 'DECLINED' })]);
        expect((await signUp(app, { inviteToken: TOKEN })).json().code).toBe('INVITE_INVALID');
        expect((await signUp(app, { inviteToken: 'x'.repeat(43) })).json().code).toBe('INVITE_INVALID');
    });

    it('the invite only works for the email it was sent to', async () => {
        const { app, tx } = await build([invited()]);
        const res = await signUp(app, { inviteToken: TOKEN, email: 'someone@else.com' });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('INVITE_EMAIL_MISMATCH');
        expect(tx.tenant.create).not.toHaveBeenCalled();
    });

    it('a sign-up that loses the race for the invite rolls back (no half-made account)', async () => {
        const { app, store, committed } = await build([invited()]);
        // Someone else consumed it between our check and our transaction.
        store.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
        const res = await signUp(app, { inviteToken: TOKEN });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('INVITE_USED');
        expect(committed()).toBe(false);
    });

    it('the gate is checked before the "email already has an account" check (no account probing while closed)', async () => {
        const { app } = await build();
        (app as any).prisma.user.findFirst = async () => ({ id: 'existing' });
        const res = await signUp(app);
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('WAITLIST_ONLY');
    });
});

describe('registration open (REGISTRATION_OPEN=true)', () => {
    beforeEach(() => { process.env.REGISTRATION_OPEN = 'true'; });

    it('works without any token, exactly as before', async () => {
        const { app, tx } = await build();
        const res = await signUp(app);
        expect(res.statusCode).toBe(200);
        expect(tx.tenant.create).toHaveBeenCalledTimes(1);
    });

    it('a valid invite is still consumed and the entry marked JOINED', async () => {
        const { app, store } = await build([invited()]);
        expect((await signUp(app, { inviteToken: TOKEN })).statusCode).toBe(200);
        expect(store.rows.get('w1')).toMatchObject({ status: 'JOINED', joinedTenantId: 'tenant-new' });
    });

    it('a stale or mismatched invite does not block an open sign-up (it is simply ignored)', async () => {
        const { app, store } = await build([invited({ inviteExpiresAt: new Date(Date.now() - 1000) })]);
        expect((await signUp(app, { inviteToken: TOKEN })).statusCode).toBe(200);
        expect((await signUp(app, { inviteToken: 'nonsense-token-nonsense-token', email: 'b@x.co' })).statusCode).toBe(200);
        expect(store.rows.get('w1')!.status).toBe('INVITED');
    });
});
