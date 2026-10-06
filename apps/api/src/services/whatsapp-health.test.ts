import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/index.js', async (orig) => {
    const actual = await orig<typeof import('../config/index.js')>();
    return {
        ...actual,
        config: {
            ...actual.config,
            whatsapp: { ...actual.config.whatsapp, appId: 'app-123', appSecret: 'app-secret' },
            platformWhatsapp: { wabaId: 'platform-waba', accessToken: 'platform-token' },
        },
    };
});
const raiseAlert = vi.fn(async () => undefined);
vi.mock('./alerts.js', () => ({ raiseAlert: (...a: unknown[]) => (raiseAlert as any)(...a) }));

import { assessHealth, checkTenantWhatsappHealth, sweepWhatsappHealth, TOKEN_EXPIRY_WARN_MS } from './whatsapp-health.js';
import { GraphError, type PhoneHealth } from './meta-waba.js';
import { encrypt } from './crypto.js';

const NOW = new Date('2026-10-06T12:00:00Z');
const phone = (over: Partial<PhoneHealth> = {}): PhoneHealth => ({
    displayPhoneNumber: '+233 30 000 0000', verifiedName: 'TURBO', nameStatus: 'APPROVED', qualityRating: 'GREEN',
    messagingLimitTier: 'TIER_1K', status: 'CONNECTED', codeVerificationStatus: 'VERIFIED', ...over,
});
const base = { phone: phone(), phoneError: null, token: null, appSubscribed: true, platformTokenMissing: false, now: NOW };

describe('assessHealth', () => {
    it('healthy number: no problem, no alerts', () => {
        expect(assessHealth(base)).toEqual({ transient: false, problem: null, qualitySeverity: null, tokenExpiringAt: null });
    });
    it('auth failure on the phone read -> TOKEN_INVALID', () => {
        expect(assessHealth({ ...base, phone: null, phoneError: new GraphError(400, 190, null, 'OAuthException', 'x') }).problem).toBe('TOKEN_INVALID');
    });
    it('network / 5xx is transient, not a problem', () => {
        expect(assessHealth({ ...base, phone: null, phoneError: new GraphError(503, null, null, null, 'x') })).toMatchObject({ transient: true, problem: null });
        expect(assessHealth({ ...base, phone: null, phoneError: new GraphError(0, null, null, null, 'x') }).transient).toBe(true);
    });
    it('other 4xx -> NUMBER_NOT_FOUND', () => {
        expect(assessHealth({ ...base, phone: null, phoneError: new GraphError(400, 100, 33, 'GraphMethodException', 'x') }).problem).toBe('NUMBER_NOT_FOUND');
    });
    it.each([['BANNED', 'NUMBER_BANNED'], ['FLAGGED', 'NUMBER_FLAGGED'], ['RESTRICTED', 'NUMBER_RESTRICTED'], ['DISCONNECTED', 'NUMBER_DISCONNECTED'], ['DELETED', 'NUMBER_DELETED']])(
        'status %s -> %s', (status, problem) => {
            expect(assessHealth({ ...base, phone: phone({ status }) }).problem).toBe(problem);
        });
    it('app unsubscribed, invalid token, expired token', () => {
        expect(assessHealth({ ...base, appSubscribed: false }).problem).toBe('APP_UNSUBSCRIBED');
        expect(assessHealth({ ...base, token: { isValid: false, expiresAt: null, appId: 'app-123', wabaIds: [] } }).problem).toBe('TOKEN_INVALID');
        expect(assessHealth({ ...base, token: { isValid: true, expiresAt: new Date(NOW.getTime() - 1), appId: 'app-123', wabaIds: [] } }).problem).toBe('TOKEN_EXPIRED');
    });
    it('quality RED -> warning, YELLOW -> info', () => {
        expect(assessHealth({ ...base, phone: phone({ qualityRating: 'RED' }) }).qualitySeverity).toBe('warning');
        expect(assessHealth({ ...base, phone: phone({ qualityRating: 'YELLOW' }) }).qualitySeverity).toBe('info');
    });
    it('token expiring inside 7 days is flagged; further out is not', () => {
        const soon = new Date(NOW.getTime() + TOKEN_EXPIRY_WARN_MS - 1000);
        expect(assessHealth({ ...base, token: { isValid: true, expiresAt: soon, appId: 'app-123', wabaIds: [] } }).tokenExpiringAt).toEqual(soon);
        expect(assessHealth({ ...base, token: { isValid: true, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000), appId: 'app-123', wabaIds: [] } }).tokenExpiringAt).toBeNull();
    });
    it('hosted with no platform token -> PLATFORM_TOKEN_MISSING', () => {
        expect(assessHealth({ ...base, platformTokenMissing: true }).problem).toBe('PLATFORM_TOKEN_MISSING');
    });
});

// ---- I/O --------------------------------------------------------------------

let tenant: Record<string, any>;
let alertsExisting: Map<string, { lastSeenAt: Date; severity: string }>;
const fetchMock = vi.fn();

function prisma() {
    return {
        tenant: {
            findUnique: vi.fn(async () => (tenant ? { ...tenant } : null)),
            update: vi.fn(async ({ data }: any) => { tenant = { ...tenant, ...data }; return tenant; }),
            findMany: vi.fn(async () => [{ id: 't1' }]),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.whatsappPhoneNumberId !== undefined && where.whatsappPhoneNumberId !== tenant.whatsappPhoneNumberId) return { count: 0 };
                tenant = { ...tenant, ...data };
                return { count: 1 };
            }),
        },
        platformAlert: { findUnique: vi.fn(async ({ where }: any) => (alertsExisting.has(where.dedupeKey) ? { id: 'a', ...alertsExisting.get(where.dedupeKey) } : null)) },
    } as any;
}

const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

function graphRoutes(over: { phone?: unknown; phoneStatus?: number; debug?: unknown; subscribed?: unknown } = {}) {
    fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/debug_token')) return json(200, over.debug ?? { data: { is_valid: true, app_id: 'app-123', expires_at: 0 } });
        if (url.includes('/subscribed_apps')) return json(200, over.subscribed ?? { data: [{ whatsapp_business_api_data: { id: 'app-123' } }] });
        return json(over.phoneStatus ?? 200, over.phone ?? {
            display_phone_number: '+233 30 000 0000', verified_name: 'TURBO', name_status: 'APPROVED',
            quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K', status: 'CONNECTED',
        });
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    alertsExisting = new Map();
    tenant = {
        id: 't1', name: 'TURBO Rides', whatsappPhoneNumberId: '222', whatsappAccountId: '111',
        whatsappAccessToken: encrypt('tenant-token-xyz'), whatsappHosted: false, whatsappNumberStatus: null,
        whatsappConnectionMode: 'OWN_ACCOUNT', whatsappDisplayNumber: '+233 30 000 0000', whatsappQualityRating: null,
        whatsappMessagingLimit: null, whatsappMetaStatus: null, whatsappNameStatus: null, whatsappHealthProblem: null,
        whatsappTokenExpiresAt: null,
    };
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('checkTenantWhatsappHealth', () => {
    it('stores the readings with the tenant token and raises nothing when healthy', async () => {
        graphRoutes();
        const r = await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect(r).toMatchObject({ checked: true, problem: null, qualityRating: 'GREEN', messagingLimit: 'TIER_1K', metaStatus: 'CONNECTED', nameStatus: 'APPROVED', alerts: [] });
        expect(tenant).toMatchObject({ whatsappQualityRating: 'GREEN', whatsappMessagingLimit: 'TIER_1K', whatsappHealthCheckedAt: NOW, whatsappHealthProblem: null });
        const phoneCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/222?fields='))!;
        expect(phoneCall[0]).toContain('graph.facebook.com/v25.0/222?fields=');
        expect(phoneCall[1].headers.Authorization).toBe('Bearer tenant-token-xyz');
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('hosted numbers are read with the platform token and skip the debug/subscription checks', async () => {
        tenant = { ...tenant, whatsappHosted: true, whatsappNumberStatus: 'REGISTERED', whatsappAccessToken: null };
        graphRoutes();
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer platform-token');
    });

    it('skips a hosted number still waiting for its code', async () => {
        tenant = { ...tenant, whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' };
        const r = await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect(r).toMatchObject({ checked: false, skipped: 'not_connected' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('invalid token -> critical whatsapp.disconnected, once per change; the token never reaches the log or alert', async () => {
        graphRoutes({ phoneStatus: 400, phone: { error: { message: 'Error validating access token', code: 190, type: 'OAuthException' } } });
        const log = { warn: vi.fn(), error: vi.fn() };
        const p = prisma();
        const r = await checkTenantWhatsappHealth(p, 't1', { now: NOW, log });
        expect(r.problem).toBe('TOKEN_INVALID');
        expect(tenant.whatsappHealthProblem).toBe('TOKEN_INVALID');
        expect(raiseAlert).toHaveBeenCalledTimes(1);
        const [, alert] = (raiseAlert.mock.calls as any[])[0];
        expect(alert).toMatchObject({ kind: 'whatsapp.disconnected', severity: 'critical', tenantId: 't1', dedupeKey: 'whatsapp.disconnected:t1' });
        expect(JSON.stringify([alert, log.warn.mock.calls, log.error.mock.calls])).not.toContain('tenant-token-xyz');

        // Same problem again, alert row present (even if resolved): no reopen.
        alertsExisting.set('whatsapp.disconnected:t1', { lastSeenAt: NOW, severity: 'critical' });
        await checkTenantWhatsappHealth(p, 't1', { now: NOW, log });
        expect(raiseAlert).toHaveBeenCalledTimes(1);
    });

    it('quality RED -> warning whatsapp.quality_low; YELLOW -> info', async () => {
        graphRoutes({ phone: { quality_rating: 'RED', status: 'CONNECTED' } });
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect((raiseAlert.mock.calls as any[])[0][1]).toMatchObject({ kind: 'whatsapp.quality_low', severity: 'warning' });

        graphRoutes({ phone: { quality_rating: 'YELLOW', status: 'CONNECTED' } });
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect((raiseAlert.mock.calls as any[])[1][1]).toMatchObject({ kind: 'whatsapp.quality_low', severity: 'info' });
    });

    it('quality flapping alerts at most daily, but RED after YELLOW alerts at once', async () => {
        tenant.whatsappQualityRating = 'GREEN';
        alertsExisting.set('whatsapp.quality_low:t1', { lastSeenAt: new Date(NOW.getTime() - 3_600_000), severity: 'info' });
        graphRoutes({ phone: { quality_rating: 'YELLOW', status: 'CONNECTED' } });
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect(raiseAlert).not.toHaveBeenCalled(); // changed, but an alert went out an hour ago

        graphRoutes({ phone: { quality_rating: 'RED', status: 'CONNECTED' } });
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect((raiseAlert.mock.calls as any[])[0][1]).toMatchObject({ kind: 'whatsapp.quality_low', severity: 'warning' });
    });

    it('does not write readings or alert when the number changed while Meta was answering', async () => {
        graphRoutes({ phone: { quality_rating: 'RED', status: 'BANNED' } });
        const p = prisma();
        p.tenant.findUnique.mockImplementationOnce(async () => {
            const snapshot = { ...tenant };
            tenant = { ...tenant, whatsappPhoneNumberId: 'new-number' }; // reconnected mid-check
            return snapshot;
        });
        const r = await checkTenantWhatsappHealth(p, 't1', { now: NOW });
        expect(r).toMatchObject({ checked: false, skipped: 'changed' });
        expect(tenant.whatsappHealthProblem).toBeNull();
        expect(raiseAlert).not.toHaveBeenCalled();
    });

    it('token expiring in 3 days -> warning whatsapp.token_expiring, deduped per expiry day', async () => {
        const exp = Math.floor((NOW.getTime() + 3 * 86_400_000) / 1000);
        graphRoutes({ debug: { data: { is_valid: true, app_id: 'app-123', expires_at: exp } } });
        await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect((raiseAlert.mock.calls as any[])[0][1]).toMatchObject({ kind: 'whatsapp.token_expiring', severity: 'warning', dedupeKey: 'whatsapp.token_expiring:t1:2026-10-09' });
        expect(tenant.whatsappTokenExpiresAt).toEqual(new Date(exp * 1000));
    });

    it('app no longer subscribed -> APP_UNSUBSCRIBED', async () => {
        graphRoutes({ subscribed: { data: [] } });
        expect((await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW })).problem).toBe('APP_UNSUBSCRIBED');
    });

    it('Meta unreachable keeps the last readings and raises nothing', async () => {
        tenant.whatsappQualityRating = 'GREEN';
        fetchMock.mockRejectedValue(new Error('ECONNRESET'));
        const r = await checkTenantWhatsappHealth(prisma(), 't1', { now: NOW });
        expect(r).toMatchObject({ checked: true, transient: true, qualityRating: 'GREEN' });
        expect(raiseAlert).not.toHaveBeenCalled();
    });
});

describe('sweepWhatsappHealth', () => {
    it('only checks tenants whose claim it won (multi-process safe)', async () => {
        graphRoutes();
        const p = prisma();
        p.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
        p.tenant.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.id === 't1' ? 1 : 0 }));
        const r = await sweepWhatsappHealth(p, undefined, NOW);
        expect(r).toEqual({ checked: 1, problems: 0 });
        const claim = p.tenant.updateMany.mock.calls[0][0];
        expect(claim.data).toEqual({ whatsappHealthCheckedAt: NOW });
        expect(claim.where.OR).toEqual([{ whatsappHealthCheckedAt: null }, { whatsappHealthCheckedAt: { lt: new Date(NOW.getTime() - 6 * 3_600_000) } }]);
        const q = p.tenant.findMany.mock.calls[0][0];
        expect(q.where).toMatchObject({ isActive: true, whatsappPhoneNumberId: { not: null } });
        expect(q.take).toBeLessThanOrEqual(50);
    });
});
