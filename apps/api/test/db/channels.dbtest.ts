/**
 * Channel connections on real Postgres:
 *  - the migration's backfill (mode from the hosted flag, connectedAt/by from
 *    the audit trail) does what it says on rows shaped like production's;
 *  - the WhatsApp health sweep is multi-process safe: two sweeps racing over
 *    the same tenants check each tenant once, through the REAL guarded client;
 *  - alerts are deduped across sweeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawPrisma, getApp } from './helpers/db.js';
import { seedTenant, seedUser } from './helpers/seed.js';
import { encrypt } from '../../src/services/crypto.js';
import { sweepWhatsappHealth } from '../../src/services/whatsapp-health.js';

const MIGRATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '../../prisma/migrations/20261011090000_channel_connections/migration.sql');

/** The migration's UPDATE statements, re-run against seeded rows. */
function backfillStatements(): string[] {
    const sql = readFileSync(MIGRATION, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    return sql.split(';').map((s) => s.trim()).filter((s) => s.startsWith('UPDATE'));
}

describe('channel_connections migration backfill', () => {
    it('sets the mode from the hosted flag and connectedAt/by from the latest connect audit', async () => {
        const db = rawPrisma();
        const own = await seedTenant({ whatsappPhoneNumberId: `own-${Date.now()}`, whatsappAccessToken: 'enc' });
        const hosted = await seedTenant({ whatsappPhoneNumberId: `hst-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'REGISTERED' });
        const none = await seedTenant();
        const fb = await seedTenant({ facebookPageId: `pg-${Date.now()}`, instagramUserId: `ig-${Date.now()}` });
        const owner = await seedUser(own.id);
        const t1 = new Date('2026-09-01T10:00:00Z');
        const t2 = new Date('2026-09-05T10:00:00Z');
        await db.auditLog.createMany({
            data: [
                { tenantId: own.id, actorType: 'USER', actorId: 'old-user', action: 'whatsapp.connected', createdAt: t1 },
                { tenantId: own.id, actorType: 'USER', actorId: owner.id, action: 'whatsapp.connected', createdAt: t2 },
                { tenantId: hosted.id, actorType: 'USER', actorId: 'u-h', action: 'whatsapp.hosted_registered', createdAt: t1 },
                { tenantId: fb.id, actorType: 'USER', actorId: 'u-fb', action: 'channels.facebook_connected', createdAt: t2 },
            ],
        });

        for (const stmt of backfillStatements()) await db.$executeRawUnsafe(stmt);

        const read = (id: string) => db.tenant.findUniqueOrThrow({ where: { id } });
        expect(await read(own.id)).toMatchObject({ whatsappConnectionMode: 'OWN_ACCOUNT', whatsappConnectedAt: t2, whatsappConnectedByUserId: owner.id });
        expect(await read(hosted.id)).toMatchObject({ whatsappConnectionMode: 'BOOKLY_HOSTED', whatsappConnectedAt: t1, whatsappConnectedByUserId: 'u-h' });
        expect(await read(none.id)).toMatchObject({ whatsappConnectionMode: null, whatsappConnectedAt: null });
        expect(await read(fb.id)).toMatchObject({ facebookConnectedAt: t2, facebookConnectedByUserId: 'u-fb', instagramConnectedAt: t2 });
    });
});

describe('WhatsApp health sweep on the real engine', () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async (url: string) => {
            const body = url.includes('/debug_token') ? { data: { is_valid: true, expires_at: 0 } }
                : url.includes('/subscribed_apps') ? { data: [] } // not subscribed -> problem (only decided when appId is set)
                    : { quality_rating: 'RED', messaging_limit_tier: 'TIER_250', status: 'CONNECTED', name_status: 'APPROVED' };
            return { ok: true, status: 200, text: async () => JSON.stringify(body) };
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('two racing sweeps check each connected tenant exactly once and raise one alert each', async () => {
        const app = await getApp();
        const ids: string[] = [];
        for (let i = 0; i < 3; i += 1) {
            const t = await seedTenant({ whatsappPhoneNumberId: `pn-${i}-${Date.now()}`, whatsappAccountId: `waba-${i}`, whatsappAccessToken: encrypt(`tok-${i}`) });
            ids.push(t.id);
        }
        // Not swept: a hosted number still waiting for its code, an inactive tenant, a fresh check.
        await seedTenant({ whatsappPhoneNumberId: `pn-pending-${Date.now()}`, whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' });
        await seedTenant({ whatsappPhoneNumberId: `pn-off-${Date.now()}`, whatsappAccessToken: encrypt('x'), isActive: false });
        await seedTenant({ whatsappPhoneNumberId: `pn-fresh-${Date.now()}`, whatsappAccessToken: encrypt('x'), whatsappHealthCheckedAt: new Date() });

        const [a, b] = await Promise.all([sweepWhatsappHealth(app.prisma), sweepWhatsappHealth(app.prisma)]);
        expect(a.checked + b.checked).toBe(3);

        const phoneReads = fetchMock.mock.calls.filter(([u]) => /\/pn-\d-\d+\?fields=/.test(String(u)));
        expect(phoneReads).toHaveLength(3);
        expect(fetchMock.mock.calls.some(([u]) => /pn-(pending|off|fresh)/.test(String(u)))).toBe(false);

        const rows = await rawPrisma().tenant.findMany({ where: { id: { in: ids } } });
        for (const r of rows) {
            expect(r).toMatchObject({ whatsappQualityRating: 'RED', whatsappMessagingLimit: 'TIER_250', whatsappMetaStatus: 'CONNECTED' });
            expect(r.whatsappHealthCheckedAt).toBeInstanceOf(Date);
        }
        const alerts = await rawPrisma().platformAlert.findMany({ where: { tenantId: { in: ids }, kind: 'whatsapp.quality_low' } });
        expect(alerts).toHaveLength(3);
        expect(alerts.every((x) => x.severity === 'warning' && x.count === 1)).toBe(true);

        // Nothing is due now: a third sweep checks nobody and raises nothing new.
        const c = await sweepWhatsappHealth(app.prisma);
        expect(c.checked).toBe(0);
        const again = await rawPrisma().platformAlert.findMany({ where: { tenantId: { in: ids } } });
        expect(again.every((x) => x.count === 1)).toBe(true);
    });
});
