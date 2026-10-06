/**
 * Bookly-hosted numbers on real Postgres, through the REAL guarded client:
 *  - M1: two /whatsapp/hosted/start requests racing for one organisation
 *    create exactly one number (the tenant is claimed before Meta is called);
 *  - H3: the abandoned-number sweeper releases only stale pending numbers,
 *    once, even with two sweepers racing; the OTP send cap holds under races.
 * Meta is mocked; nothing leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

const meta = vi.hoisted(() => ({
    startHostedNumber: vi.fn(),
    deleteHostedNumber: vi.fn(),
    countHostedNumbers: vi.fn(),
    subscribePlatformWaba: vi.fn(),
}));
vi.mock('../../src/services/meta-number-onboarding.js', async (orig) => ({
    ...(await orig<typeof import('../../src/services/meta-number-onboarding.js')>()),
    isPlatformWabaConfigured: () => true,
    startHostedNumber: meta.startHostedNumber,
    deleteHostedNumber: meta.deleteHostedNumber,
    countHostedNumbers: meta.countHostedNumbers,
    subscribePlatformWaba: meta.subscribePlatformWaba,
}));
vi.mock('../../src/config/index.js', async (orig) => {
    const actual = await orig<typeof import('../../src/config/index.js')>();
    return { ...actual, config: { ...actual.config, platformWhatsapp: { wabaId: 'platform-waba', accessToken: 'platform-token', allowedCountryCodes: ['233'] } } };
});

import prismaPlugin from '../../src/plugins/prisma.js';
import errorHandler from '../../src/plugins/error-handler.js';
import connectionRoutes from '../../src/routes/whatsapp/connection.js';
import { releaseStaleHostedNumbers } from '../../src/services/hosted-number-sweeper.js';
import { reserveOtpSend, HOSTED_DESTINATION_LIMIT_24H } from '../../src/services/whatsapp-connection.js';
import { rawPrisma, getApp } from './helpers/db.js';
import { seedTenant, seedUser } from './helpers/seed.js';

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

beforeEach(() => {
    vi.clearAllMocks();
    meta.countHostedNumbers.mockResolvedValue(0);
    meta.subscribePlatformWaba.mockResolvedValue(undefined);
    meta.deleteHostedNumber.mockResolvedValue(undefined);
    let n = 0;
    meta.startHostedNumber.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50)); // Meta takes a while: widen the race window
        n += 1;
        return { phoneNumberId: `pn-race-${n}-${Date.now()}`, displayNumber: '+233241234567', codeMethod: 'SMS' };
    });
});

async function buildApp(tenantId: string, userId: string) {
    const f = Fastify({ logger: false });
    await f.register(sensible);
    await f.register(errorHandler);
    await f.register(prismaPlugin);
    f.decorate('authenticate', async (req: any) => { req.user = { userId, tenantId, role: 'OWNER' }; });
    await f.register(connectionRoutes, { prefix: '/whatsapp' });
    await f.ready();
    app = f;
    return f;
}

describe('hosted/start race (M1)', () => {
    it('two concurrent starts for one organisation create exactly one number', async () => {
        const t = await seedTenant();
        const u = await seedUser(t.id, { emailVerifiedAt: new Date() });
        const f = await buildApp(t.id, u.id);
        const start = () => f.inject({ method: 'POST', url: '/whatsapp/hosted/start', payload: { countryCode: '233', localNumber: '0241234567' } });

        const [a, b] = await Promise.all([start(), start()]);
        const codes = [a.statusCode, b.statusCode].sort();
        expect(codes).toEqual([200, 409]);
        expect([a, b].find((r) => r.statusCode === 409)!.json().code).toBe('START_IN_PROGRESS');
        expect(meta.startHostedNumber).toHaveBeenCalledTimes(1);

        const row = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: t.id } });
        expect(row).toMatchObject({ whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappConnectionMode: 'BOOKLY_HOSTED' });
        expect(row.whatsappPhoneNumberId).toMatch(/^pn-race-1-/);
    });
});

describe('abandoned hosted numbers (H3)', () => {
    it('releases stale pending numbers once, leaves fresh and registered ones, even with two sweepers', async () => {
        const db = rawPrisma();
        const now = new Date();
        const old = new Date(now.getTime() - 40 * 60_000);
        const stale = await seedTenant({ whatsappPhoneNumberId: `pn-stale-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappCodeSentAt: old, whatsappDisplayNumber: '+233200000001' });
        const staleVerified = await seedTenant({ whatsappPhoneNumberId: `pn-ver-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'VERIFIED', whatsappCodeSentAt: old });
        const fresh = await seedTenant({ whatsappPhoneNumberId: `pn-fresh-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappCodeSentAt: new Date(now.getTime() - 5 * 60_000) });
        const live = await seedTenant({ whatsappPhoneNumberId: `pn-live-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'REGISTERED', whatsappCodeSentAt: old });
        const crashed = await seedTenant({ whatsappNumberStatus: 'STARTING', whatsappCodeSentAt: old });

        const prisma = (await getApp()).prisma;
        const [r1, r2] = await Promise.all([releaseStaleHostedNumbers(prisma, undefined, now), releaseStaleHostedNumbers(prisma, undefined, now)]);
        expect(r1.released + r2.released).toBe(2);
        expect(meta.deleteHostedNumber).toHaveBeenCalledTimes(2);
        expect(meta.deleteHostedNumber.mock.calls.map((c) => c[0]).sort()).toEqual([stale.whatsappPhoneNumberId, staleVerified.whatsappPhoneNumberId].sort());

        const read = (id: string) => db.tenant.findUniqueOrThrow({ where: { id } });
        expect(await read(stale.id)).toMatchObject({ whatsappPhoneNumberId: null, whatsappHosted: false, whatsappNumberStatus: null });
        expect(await read(staleVerified.id)).toMatchObject({ whatsappPhoneNumberId: null });
        expect((await read(fresh.id)).whatsappPhoneNumberId).toBe(fresh.whatsappPhoneNumberId);
        expect((await read(live.id)).whatsappNumberStatus).toBe('REGISTERED');
        expect((await read(crashed.id)).whatsappNumberStatus).toBeNull();

        const audits = await db.auditLog.findMany({ where: { action: 'whatsapp.hosted_expired' } });
        expect(audits).toHaveLength(2);
        expect(audits.every((a) => a.actorType === 'SYSTEM')).toBe(true);
    });

    it('a failed delete raises an alert so the slot is cleaned by hand', async () => {
        meta.deleteHostedNumber.mockRejectedValue(new Error('graph down'));
        const t = await seedTenant({ whatsappPhoneNumberId: `pn-stuck-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappCodeSentAt: new Date(Date.now() - 3_600_000) });
        const r = await releaseStaleHostedNumbers((await getApp()).prisma);
        expect(r).toEqual({ released: 1, failedDeletes: 1 });
        const alert = await rawPrisma().platformAlert.findFirst({ where: { tenantId: t.id, kind: 'whatsapp.hosted_release_failed' } });
        expect(alert?.severity).toBe('warning');
    });
});

describe('OTP send cap under concurrency (H3)', () => {
    it('ten racing sends to one destination admit at most the per-destination limit', async () => {
        const prisma = (await getApp()).prisma;
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveOtpSend(prisma, '+233241234567', 'start')));
        const admitted = results.filter((r) => r.status === 'fulfilled').length;
        expect(admitted).toBeLessThanOrEqual(HOSTED_DESTINATION_LIMIT_24H);
        expect(await rawPrisma().whatsappOtpSend.count()).toBe(admitted);
    });
});
