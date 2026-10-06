/**
 * The WhatsApp connection API as an external console (or the dashboard) sees
 * it: stable `{ code, message }` errors, OWNER-only changes, the hosted OTP
 * steps, Embedded Signup v4 session payloads, and connection bookkeeping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';

const platform = vi.hoisted(() => ({ configured: true }));
const meta = vi.hoisted(() => ({
    startHostedNumber: vi.fn(),
    resendVerificationCode: vi.fn(),
    verifyCode: vi.fn(),
    registerNumber: vi.fn(),
    deleteHostedNumber: vi.fn(),
    countHostedNumbers: vi.fn(),
    subscribePlatformWaba: vi.fn(),
    completeEmbeddedSignup: vi.fn(),
    unsubscribeApp: vi.fn(),
    inspectToken: vi.fn(),
    listWabaPhoneIds: vi.fn(),
    listPlatformNumberIds: vi.fn(),
}));

vi.mock('../../config/index.js', async (orig) => {
    const actual = await orig<typeof import('../../config/index.js')>();
    return {
        ...actual,
        config: {
            ...actual.config,
            whatsapp: { ...actual.config.whatsapp, appId: 'app-123', appSecret: 'super-secret-value', configId: 'cfg-456' },
            platformWhatsapp: { wabaId: 'platform-waba', accessToken: 'platform-token', allowedCountryCodes: ['233'] },
        },
    };
});
vi.mock('../../services/meta-number-onboarding.js', async (orig) => {
    const actual = await orig<typeof import('../../services/meta-number-onboarding.js')>();
    return {
        ...actual,
        isPlatformWabaConfigured: () => platform.configured,
        startHostedNumber: meta.startHostedNumber,
        resendVerificationCode: meta.resendVerificationCode,
        verifyCode: meta.verifyCode,
        registerNumber: meta.registerNumber,
        deleteHostedNumber: meta.deleteHostedNumber,
        countHostedNumbers: meta.countHostedNumbers,
        subscribePlatformWaba: meta.subscribePlatformWaba,
        listPlatformNumberIds: meta.listPlatformNumberIds,
    };
});
vi.mock('../../services/meta-embedded-signup.js', async (orig) => ({
    ...(await orig<typeof import('../../services/meta-embedded-signup.js')>()),
    completeEmbeddedSignup: meta.completeEmbeddedSignup,
}));
vi.mock('../../services/meta-waba.js', async (orig) => ({
    ...(await orig<typeof import('../../services/meta-waba.js')>()),
    unsubscribeApp: meta.unsubscribeApp,
    inspectToken: meta.inspectToken,
    listWabaPhoneIds: meta.listWabaPhoneIds,
}));

import errorHandler from '../../plugins/error-handler.js';
import { NumberOnboardingError } from '../../services/meta-number-onboarding.js';
import { EmbeddedSignupError } from '../../services/meta-embedded-signup.js';
import { encrypt } from '../../services/crypto.js';
import connectionRoutes, { sessionHint } from './connection.js';

type Row = Record<string, any>;
const blankTenant = (): Row => ({
    id: 't1', name: 'TURBO Rides', vertical: 'RIDES', businessType: 'SERVICE', timezone: 'Africa/Accra', paymentCurrency: 'GHS',
    whatsappPhoneNumberId: null, whatsappAccountId: null, whatsappAccessToken: null, whatsappDisplayNumber: null,
    whatsappHosted: false, whatsappNumberStatus: null, whatsappRegistrationPin: null, whatsappConnectionMode: null,
    whatsappConnectedAt: null, whatsappConnectedByUserId: null, whatsappVerifiedName: null, whatsappNameStatus: null,
    whatsappCodeMethod: null, whatsappCodeSentAt: null, whatsappQualityRating: null, whatsappMessagingLimit: null,
    whatsappMetaStatus: null, whatsappHealthProblem: null, whatsappHealthCheckedAt: null, whatsappTokenExpiresAt: null,
});

let tenant: Row;
let others: Row[];
let audits: Row[];
let otpSends: Row[];
let ownerVerified: boolean;
let app: FastifyInstance;

/** Tiny matcher for the `where` shapes the routes use on tenant.updateMany. */
function matches(row: Row, where: any): boolean {
    for (const [k, v] of Object.entries(where ?? {})) {
        if (k === 'id') { if (row.id !== v) return false; continue; }
        if (k === 'OR') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            const op = v as any;
            if ('not' in op && row[k] === op.not) return false;
            if ('not' in op && row[k] === null) return false; // SQL: NULL <> x is not true
            if ('in' in op && !op.in.includes(row[k])) return false;
            if ('lt' in op && !(row[k] instanceof Date && row[k] < op.lt)) return false;
            continue;
        }
        if (row[k] !== v) return false;
    }
    return true;
}

function prismaStub() {
    const stub: any = {
        tenant: {
            findUnique: vi.fn(async ({ where }: any) => (where.id === tenant.id ? { ...tenant } : null)),
            findFirst: vi.fn(async ({ where }: any) =>
                others.find((o) => o.whatsappPhoneNumberId === where.whatsappPhoneNumberId) ?? null),
            update: vi.fn(async ({ data }: any) => { tenant = { ...tenant, ...data }; return tenant; }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                if (!matches(tenant, where)) return { count: 0 };
                tenant = { ...tenant, ...data };
                return { count: 1 };
            }),
            count: vi.fn(async () => 0),
        },
        user: { findFirst: vi.fn(async () => ({ email: 'owner@turbo.example', emailVerifiedAt: ownerVerified ? new Date() : null })) },
        auditLog: { create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }) },
        whatsappOtpSend: {
            create: vi.fn(async ({ data }: any) => { const row = { id: `o${otpSends.length}`, ...data }; otpSends.push(row); return row; }),
            count: vi.fn(async ({ where }: any) => otpSends.filter((o) => (!where.destinationHash || o.destinationHash === where.destinationHash) && o.createdAt > where.createdAt.gt).length),
            delete: vi.fn(async ({ where }: any) => { otpSends = otpSends.filter((o) => o.id !== where.id); }),
        },
    };
    stub.$transaction = vi.fn(async (fn: any) => fn(stub));
    return stub;
}

async function build(role: 'OWNER' | 'STAFF' = 'OWNER', opts: { rateLimited?: boolean } = {}) {
    const f = Fastify();
    await f.register(sensible);
    await f.register(errorHandler);
    if (opts.rateLimited) await f.register(rateLimit, { global: false });
    f.decorate('prisma', prismaStub() as any);
    f.decorate('authenticate', async (req: any) => { req.user = { userId: 'u-owner', tenantId: 't1', role }; });
    await f.register(connectionRoutes, { prefix: '/whatsapp' });
    await f.ready();
    app = f;
    return f;
}

const post = (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/whatsapp${url}`, payload: payload as any });
const get = (url: string) => app.inject({ method: 'GET', url: `/whatsapp${url}` });

beforeEach(() => {
    vi.clearAllMocks();
    platform.configured = true;
    tenant = blankTenant();
    others = [];
    audits = [];
    otpSends = [];
    ownerVerified = true;
    meta.countHostedNumbers.mockResolvedValue(3);
    meta.inspectToken.mockResolvedValue({ isValid: true, appId: 'app-123', expiresAt: null, wabaIds: ['8'] });
    meta.listWabaPhoneIds.mockResolvedValue(['9']);
    meta.listPlatformNumberIds.mockResolvedValue(['pn-hosted']);
    meta.startHostedNumber.mockResolvedValue({ phoneNumberId: 'pn-hosted', displayNumber: '+233241234567', codeMethod: 'SMS' });
    meta.subscribePlatformWaba.mockResolvedValue(undefined);
    meta.verifyCode.mockResolvedValue(undefined);
    meta.registerNumber.mockResolvedValue(undefined);
    meta.resendVerificationCode.mockResolvedValue(undefined);
    meta.deleteHostedNumber.mockResolvedValue(undefined);
    meta.unsubscribeApp.mockResolvedValue(undefined);
    meta.completeEmbeddedSignup.mockResolvedValue({
        accessToken: 'tenant-token-xyz', wabaId: '111', phoneNumberId: '222', displayPhoneNumber: '+233 30 000 0000',
        verifiedName: 'TURBO Rides', tokenExpiresAt: null, registrationPin: '482913',
    });
});
afterEach(async () => { await app?.close(); });

describe('GET /whatsapp/status', () => {
    it('STAFF can read it; a fresh organisation is NOT_CONNECTED with hosted available', async () => {
        await build('STAFF');
        const res = await get('/status');
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            connected: false, state: 'NOT_CONNECTED', mode: null, awaitingCode: false, pending: null,
            hostedAvailable: true, hostedUnavailableReason: null, embeddedSignupAvailable: true, canManage: false,
        });
    });

    it('says why hosted is unavailable when the platform WABA is not configured', async () => {
        platform.configured = false;
        await build();
        expect((await get('/status')).json()).toMatchObject({ hostedAvailable: false, hostedUnavailableReason: 'NOT_CONFIGURED' });
    });

    it('never returns the stored token or PIN', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: '222', whatsappAccessToken: encrypt('tenant-token-xyz'), whatsappRegistrationPin: encrypt('123456'), whatsappConnectionMode: 'OWN_ACCOUNT' };
        await build();
        const res = await get('/status');
        expect(res.json()).toMatchObject({ connected: true, state: 'CONNECTED', mode: 'OWN_ACCOUNT', billedBy: 'ORGANISATION' });
        expect(res.body).not.toMatch(/tenant-token-xyz|accessToken|RegistrationPin|123456/);
    });
});

describe('owner-only changes', () => {
    it.each(['/hosted/start', '/hosted/resend', '/hosted/verify', '/embedded-signup', '/disconnect', '/connect'])('STAFF gets 403 OWNER_ONLY on %s', async (url) => {
        await build('STAFF');
        const res = await post(url, { countryCode: '233', localNumber: '0241234567', code: 'abc', phoneNumberId: '1', accountId: '1', accessToken: 'x' });
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('OWNER_ONLY');
    });

    it('STAFF cannot read the Embedded Signup config (it carries the owner email)', async () => {
        await build('STAFF');
        expect((await get('/embedded-signup/config')).json().code).toBe('OWNER_ONLY');
    });
});

describe('Bookly-hosted number (backup path)', () => {
    it('503 HOSTED_NOT_AVAILABLE with a readable message when the platform WABA is not set up', async () => {
        platform.configured = false;
        await build();
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ code: 'HOSTED_NOT_AVAILABLE', message: expect.stringMatching(/not available/i) });
        expect(meta.startHostedNumber).not.toHaveBeenCalled();
    });

    it('start -> CODE_SENT with the display name, method and resend time; stored as pending BOOKLY_HOSTED', async () => {
        await build();
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567', codeMethod: 'SMS', displayName: 'TURBO Shuttle' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({ success: true, status: 'PENDING_CODE', step: 'CODE_SENT', displayNumber: '+233241234567', verifiedName: 'TURBO Shuttle', codeMethod: 'SMS' });
        expect(new Date(body.resendAvailableAt).getTime() - new Date(body.codeSentAt).getTime()).toBe(60_000);
        expect(meta.startHostedNumber.mock.calls[0][0]).toMatchObject({ verifiedName: 'TURBO Shuttle' });
        expect(tenant).toMatchObject({ whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappConnectionMode: 'BOOKLY_HOSTED', whatsappAccessToken: null, whatsappAccountId: 'platform-waba' });
        const status = (await get('/status')).json();
        expect(status).toMatchObject({ connected: false, state: 'PENDING_CODE', awaitingCode: true, pending: { step: 'CODE_SENT', codeMethod: 'SMS' } });
    });

    it('refuses a country outside the allowlist, and an owner without a verified email', async () => {
        await build();
        expect((await post('/hosted/start', { countryCode: '234', localNumber: '08031234567' })).json().code).toBe('COUNTRY_NOT_SUPPORTED');
        ownerVerified = false;
        expect((await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' })).json().code).toBe('EMAIL_NOT_VERIFIED');
        expect(meta.startHostedNumber).not.toHaveBeenCalled();
    });

    it('fails closed when Meta cannot say how many hosted slots are used, and frees the claim', async () => {
        meta.countHostedNumbers.mockRejectedValue(new Error('graph down'));
        await build();
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
        expect(res.json().code).toBe('META_ERROR');
        expect(meta.startHostedNumber).not.toHaveBeenCalled();
        expect(tenant.whatsappNumberStatus).toBeNull();
    });

    it('caps codes per destination number (24h)', async () => {
        await build();
        const { destinationHash } = await import('../../services/whatsapp-connection.js');
        const h = destinationHash('+233241234567');
        for (let i = 0; i < 5; i += 1) otpSends.push({ id: `x${i}`, destinationHash: h, kind: 'start', createdAt: new Date() });
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
        expect(res.statusCode).toBe(429);
        expect(res.json().code).toBe('DESTINATION_LIMIT');
        expect(meta.startHostedNumber).not.toHaveBeenCalled();
        expect(otpSends).toHaveLength(5); // the refused send is not counted
    });

    it('a second start while one is in flight gets 409 START_IN_PROGRESS', async () => {
        tenant = { ...tenant, whatsappNumberStatus: 'STARTING', whatsappCodeSentAt: new Date() };
        await build();
        expect((await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' })).json().code).toBe('START_IN_PROGRESS');
        expect(meta.startHostedNumber).not.toHaveBeenCalled();
    });

    it('losing the tenant after the number was created deletes that number', async () => {
        meta.startHostedNumber.mockImplementation(async () => {
            tenant = { ...tenant, whatsappNumberStatus: null }; // claim taken over meanwhile
            return { phoneNumberId: 'pn-orphan', displayNumber: '+233241234567', codeMethod: 'SMS' };
        });
        await build();
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
        expect(res.json().code).toBe('START_IN_PROGRESS');
        expect(meta.deleteHostedNumber).toHaveBeenCalledWith('pn-orphan');
        expect(meta.deleteHostedNumber).toHaveBeenCalledTimes(1);
        expect(tenant.whatsappPhoneNumberId).toBeNull();
    });

    it('defaults the display name to the organisation name', async () => {
        await build();
        await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
        expect(meta.startHostedNumber.mock.calls[0][0].verifiedName).toBe('TURBO Rides');
    });

    it('409 ALREADY_CONNECTED when a live number exists; a pending one is replaced and its slot released', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: '222', whatsappAccessToken: 'enc' };
        await build();
        expect((await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' })).json().code).toBe('ALREADY_CONNECTED');

        tenant = { ...blankTenant(), whatsappPhoneNumberId: 'pn-old', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' };
        const res = await post('/hosted/start', { countryCode: '233', localNumber: '0207654321' });
        expect(res.statusCode).toBe(200);
        expect(meta.deleteHostedNumber).toHaveBeenCalledWith('pn-old');
        expect(tenant.whatsappPhoneNumberId).toBe('pn-hosted');
    });

    it('503 HOSTED_CAPACITY_FULL at the 20-number portfolio cap', async () => {
        meta.countHostedNumbers.mockResolvedValue(20);
        await build();
        expect((await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' })).json().code).toBe('HOSTED_CAPACITY_FULL');
    });

    it('maps Meta failures to stable codes', async () => {
        await build();
        const cases: Array<[NumberOnboardingError, string]> = [
            [new NumberOnboardingError('create_number', 'http_400: Phone number is already registered on WhatsApp'), 'NUMBER_ALREADY_ON_WHATSAPP'],
            [new NumberOnboardingError('request_code', 'http_400: Too many attempts (133016)'), 'TOO_MANY_ATTEMPTS'],
            [new NumberOnboardingError('validate', 'number_onboarding_validate: phone number looks too short (3 digits)'), 'INVALID_NUMBER'],
            [new NumberOnboardingError('request_code', 'http_400: could not deliver'), 'CODE_SEND_FAILED'],
            [new NumberOnboardingError('create_number', 'http_500: boom'), 'META_ERROR'],
        ];
        for (const [err, code] of cases) {
            meta.startHostedNumber.mockRejectedValueOnce(err);
            const res = await post('/hosted/start', { countryCode: '233', localNumber: '0241234567' });
            expect(res.json().code, err.details).toBe(code);
        }
    });

    it('verify: wrong code -> 400 INVALID_OTP and still pending', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappRegistrationPin: encrypt('654321') };
        meta.verifyCode.mockRejectedValue(new NumberOnboardingError('verify_code', 'http_400: Code mismatch'));
        await build();
        const res = await post('/hosted/verify', { code: '111111' });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_OTP');
        expect(tenant.whatsappNumberStatus).toBe('PENDING_CODE');
    });

    it('verify: good code -> REGISTERED, connectedAt/by recorded, connected audited with mode', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappRegistrationPin: encrypt('654321'), whatsappDisplayNumber: '+233241234567', whatsappVerifiedName: 'TURBO Rides' };
        await build();
        const res = await post('/hosted/verify', { code: '123 456' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: true, status: 'REGISTERED', mode: 'BOOKLY_HOSTED', displayNumber: '+233241234567', verifiedName: 'TURBO Rides' });
        expect(meta.registerNumber).toHaveBeenCalledWith('pn-hosted', '654321');
        expect(tenant).toMatchObject({ whatsappNumberStatus: 'REGISTERED', whatsappConnectionMode: 'BOOKLY_HOSTED', whatsappConnectedByUserId: 'u-owner' });
        expect(tenant.whatsappConnectedAt).toBeInstanceOf(Date);
        expect(audits.find((a) => a.action === 'whatsapp.connected')?.metadata).toMatchObject({ mode: 'BOOKLY_HOSTED' });
        expect((await get('/status')).json()).toMatchObject({ connected: true, state: 'CONNECTED', billedBy: 'BOOKLY' });
    });

    it('verify: code accepted but register fails -> VERIFIED; a retry without a code only registers', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappRegistrationPin: encrypt('654321') };
        meta.registerNumber.mockRejectedValueOnce(new NumberOnboardingError('register', 'http_500: temporarily unavailable'));
        await build();
        const first = await post('/hosted/verify', { code: '123456' });
        expect(first.json()).toMatchObject({ code: 'META_ERROR', message: expect.stringMatching(/no new code/i) });
        expect(tenant.whatsappNumberStatus).toBe('VERIFIED');
        expect((await get('/status')).json()).toMatchObject({ state: 'REGISTERING', pending: { step: 'CODE_VERIFIED' } });

        const retry = await post('/hosted/verify', {});
        expect(retry.statusCode).toBe(200);
        expect(meta.verifyCode).toHaveBeenCalledTimes(1);
        expect(tenant.whatsappNumberStatus).toBe('REGISTERED');
    });

    it('verify / resend with nothing pending -> 409 NO_PENDING_VERIFICATION', async () => {
        await build();
        expect((await post('/hosted/verify', { code: '123456' })).json().code).toBe('NO_PENDING_VERIFICATION');
        expect((await post('/hosted/resend', {})).json().code).toBe('NO_PENDING_VERIFICATION');
    });

    it('resend: by voice after the cool-down; RESEND_TOO_SOON with Retry-After inside it', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappCodeSentAt: new Date(Date.now() - 10_000) };
        await build();
        const soon = await post('/hosted/resend', { codeMethod: 'VOICE' });
        expect(soon.statusCode).toBe(429);
        expect(soon.json().code).toBe('RESEND_TOO_SOON');
        expect(Number(soon.headers['retry-after'])).toBeGreaterThan(0);
        expect(meta.resendVerificationCode).not.toHaveBeenCalled();

        tenant.whatsappCodeSentAt = new Date(Date.now() - 120_000);
        const ok = await post('/hosted/resend', { codeMethod: 'VOICE' });
        expect(ok.statusCode).toBe(200);
        expect(ok.json()).toMatchObject({ success: true, codeMethod: 'VOICE' });
        expect(meta.resendVerificationCode).toHaveBeenCalledWith('pn-hosted', 'VOICE');
        expect(tenant.whatsappCodeMethod).toBe('VOICE');
    });

    it('rate limit on verify answers 429 TOO_MANY_ATTEMPTS', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE', whatsappRegistrationPin: encrypt('654321') };
        meta.verifyCode.mockRejectedValue(new NumberOnboardingError('verify_code', 'http_400: Code mismatch'));
        await build('OWNER', { rateLimited: true });
        let last;
        for (let i = 0; i < 7; i += 1) last = await post('/hosted/verify', { code: '000000' });
        expect(last!.statusCode).toBe(429);
        expect(last!.json().code).toBe('TOO_MANY_ATTEMPTS');
    });
});

describe('Embedded Signup (own Meta account; primary path)', () => {
    it('config: public app id + config id, v4 FB.login options with prefill, never the secret', async () => {
        await build();
        const res = await get('/embedded-signup/config');
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toMatchObject({
            available: true, appId: 'app-123', configId: 'cfg-456', sdkVersion: 'v25.0',
            login: {
                config_id: 'cfg-456', response_type: 'code', override_default_response_type: true,
                extras: {
                    setup: {
                        business: { name: 'TURBO Rides', email: 'owner@turbo.example', address: { country: 'GH' }, timezone: 'UTC+00:00' },
                        phone: { displayName: 'TURBO Rides', category: 'TRAVEL', description: '' },
                    },
                },
            },
            sessionEvent: { origins: ['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'], type: 'WA_EMBEDDED_SIGNUP' },
            completePath: '/whatsapp/embedded-signup',
        });
        // v4: the configuration decides the version.
        expect(body.login.extras.sessionInfoVersion).toBeUndefined();
        expect(body.login.extras.version).toBeUndefined();
        expect(res.body).not.toContain('super-secret-value');
    });

    it('accepts the v4 message event as sessionInfo, picks that WABA + number, records OWN_ACCOUNT', async () => {
        await build();
        const res = await post('/embedded-signup', {
            code: 'fb-code',
            sessionInfo: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '222', waba_id: '111', business_id: '999', page_ids: [] } },
        });
        expect(res.statusCode).toBe(200);
        expect(meta.completeEmbeddedSignup).toHaveBeenCalledWith('fb-code', undefined, { wabaId: '111', phoneNumberId: '222' });
        expect(res.json()).toMatchObject({ success: true, mode: 'OWN_ACCOUNT', displayNumber: '+233 30 000 0000', verifiedName: 'TURBO Rides', status: { connected: true, mode: 'OWN_ACCOUNT' } });
        expect(tenant).toMatchObject({ whatsappConnectionMode: 'OWN_ACCOUNT', whatsappConnectedByUserId: 'u-owner', whatsappAccountId: '111', whatsappHosted: false });
        expect(tenant.whatsappAccessToken).not.toBe('tenant-token-xyz'); // stored encrypted
        expect(tenant.whatsappRegistrationPin).toBeTruthy();
        expect(tenant.whatsappRegistrationPin).not.toBe('482913'); // the per-number PIN, encrypted
        expect(res.body).not.toContain('tenant-token-xyz');
        expect(audits.find((a) => a.action === 'whatsapp.connected')?.metadata).toMatchObject({ mode: 'OWN_ACCOUNT', via: 'embedded_signup' });
    });

    it('still accepts the flat v2/v3 shapes and a bare code', () => {
        expect(sessionHint({ code: 'c', waba_id: '1', phone_number_id: '2' } as any)).toEqual({ wabaId: '1', phoneNumberId: '2' });
        expect(sessionHint({ code: 'c', wabaId: '3', phoneNumberId: '4' } as any)).toEqual({ wabaId: '3', phoneNumberId: '4' });
        expect(sessionHint({ code: 'c', sessionInfo: { data: { waba_ids: ['5'] } } } as any)).toEqual({ wabaId: '5', phoneNumberId: undefined });
        // several waba_ids: no guess
        expect(sessionHint({ code: 'c', sessionInfo: { data: { waba_ids: ['5', '6'] } } } as any)).toEqual({ wabaId: undefined, phoneNumberId: undefined });
        expect(sessionHint({ code: 'c' } as any)).toEqual({ wabaId: undefined, phoneNumberId: undefined });
    });

    it('409 NUMBER_IN_USE when another organisation has that number', async () => {
        others = [{ id: 't2', whatsappPhoneNumberId: '222' }];
        await build();
        const res = await post('/embedded-signup', { code: 'fb-code', waba_id: '111', phone_number_id: '222' });
        expect(res.statusCode).toBe(409);
        expect(res.json().code).toBe('NUMBER_IN_USE');
    });

    it('a cancelled session is refused before calling Meta', async () => {
        await build();
        const res = await post('/embedded-signup', { code: 'fb-code', sessionInfo: { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: {} } });
        expect(res.json().code).toBe('META_ERROR');
        expect(meta.completeEmbeddedSignup).not.toHaveBeenCalled();
    });

    it('Meta step failures -> 502 META_ERROR; missing app config -> 503 EMBEDDED_SIGNUP_NOT_AVAILABLE', async () => {
        await build();
        meta.completeEmbeddedSignup.mockRejectedValueOnce(new EmbeddedSignupError('token_exchange', 'http_400: code expired'));
        const a = await post('/embedded-signup', { code: 'x' });
        expect(a.statusCode).toBe(502);
        expect(a.json().code).toBe('META_ERROR');
        expect(a.json().message).not.toMatch(/http_400/);
        meta.completeEmbeddedSignup.mockRejectedValueOnce(new EmbeddedSignupError('config', 'missing'));
        expect((await post('/embedded-signup', { code: 'x' })).json().code).toBe('EMBEDDED_SIGNUP_NOT_AVAILABLE');
    });

    it('a live hosted number must be disconnected first; an unfinished one is released and replaced', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'REGISTERED' };
        await build();
        expect((await post('/embedded-signup', { code: 'x' })).json().code).toBe('ALREADY_CONNECTED');

        tenant = { ...blankTenant(), whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'PENDING_CODE' };
        expect((await post('/embedded-signup', { code: 'x' })).statusCode).toBe(200);
        expect(meta.deleteHostedNumber).toHaveBeenCalledWith('pn-hosted');
        expect(tenant).toMatchObject({ whatsappHosted: false, whatsappNumberStatus: null, whatsappPhoneNumberId: '222' });
    });
});

describe('manual connect and disconnect', () => {
    it('manual connect verifies the token and number with Meta, then records MANUAL', async () => {
        await build();
        const res = await post('/connect', { phoneNumberId: '9', accountId: '8', accessToken: 'tok', displayNumber: '+1' });
        expect(res.json()).toMatchObject({ success: true, mode: 'MANUAL' });
        expect(meta.inspectToken).toHaveBeenCalledWith('tok');
        expect(meta.listWabaPhoneIds).toHaveBeenCalledWith('8', 'tok');
        expect(tenant.whatsappConnectionMode).toBe('MANUAL');
    });

    it.each([
        ['the platform WABA', { accountId: 'platform-waba' }, (): void => undefined],
        ['a token from another app', {}, () => meta.inspectToken.mockResolvedValue({ isValid: true, appId: 'other-app', expiresAt: null, wabaIds: [] })],
        ['an invalid token', {}, () => meta.inspectToken.mockResolvedValue({ isValid: false, appId: 'app-123', expiresAt: null, wabaIds: [] })],
        ['an account the token was not granted', {}, () => meta.inspectToken.mockResolvedValue({ isValid: true, appId: 'app-123', expiresAt: null, wabaIds: ['other'] })],
        ['a number not on that account', {}, () => meta.listWabaPhoneIds.mockResolvedValue(['1', '2'])],
        ['a Bookly-hosted number', { phoneNumberId: 'pn-hosted' }, () => meta.listWabaPhoneIds.mockResolvedValue(['pn-hosted'])],
    ])('manual connect refuses %s and stores nothing', async (_label, over, arrange) => {
        arrange();
        await build();
        const res = await post('/connect', { phoneNumberId: '9', accountId: '8', accessToken: 'tok', ...over });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('MANUAL_CREDENTIALS_INVALID');
        expect(tenant.whatsappPhoneNumberId).toBeNull();
    });

    it('disconnect clears everything, unsubscribes our app from an own WABA and audits mode + actor', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: '222', whatsappAccountId: '111', whatsappAccessToken: encrypt('tenant-token-xyz'), whatsappConnectionMode: 'OWN_ACCOUNT', whatsappDisplayNumber: '+233' };
        await build();
        const res = await post('/disconnect');
        expect(res.json()).toEqual({ success: true, wasConnected: true });
        expect(meta.unsubscribeApp).toHaveBeenCalledWith('111', 'tenant-token-xyz');
        expect(tenant).toMatchObject({ whatsappPhoneNumberId: null, whatsappAccessToken: null, whatsappConnectionMode: null, whatsappConnectedAt: null });
        const a = audits.find((x) => x.action === 'whatsapp.disconnected');
        expect(a).toMatchObject({ actorType: 'USER', actorId: 'u-owner', metadata: { mode: 'OWN_ACCOUNT', metaCleanup: 'unsubscribed_app', by: 'owner' } });
    });

    it('disconnect of a hosted number releases its slot on our WABA', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: 'pn-hosted', whatsappHosted: true, whatsappNumberStatus: 'REGISTERED' };
        await build();
        await post('/disconnect');
        expect(meta.deleteHostedNumber).toHaveBeenCalledWith('pn-hosted');
        expect(meta.unsubscribeApp).not.toHaveBeenCalled();
    });

    it('a Meta failure never blocks the disconnect', async () => {
        tenant = { ...tenant, whatsappPhoneNumberId: '222', whatsappAccountId: '111', whatsappAccessToken: encrypt('t') };
        meta.unsubscribeApp.mockRejectedValue(new Error('graph down'));
        await build();
        expect((await post('/disconnect')).statusCode).toBe(200);
        expect(tenant.whatsappPhoneNumberId).toBeNull();
    });
});
