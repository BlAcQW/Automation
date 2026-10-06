import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import bcrypt from 'bcryptjs';

const mocks = vi.hoisted(() => ({
    initiateTransfer: vi.fn(),
    markPayoutProcessing: vi.fn(),
    reportTransferUncertain: vi.fn(),
    markPayoutFailed: vi.fn(),
    createWithdrawal: vi.fn(),
    isPayoutsPaused: vi.fn(),
    createTransferRecipient: vi.fn(),
    listMomoProviders: vi.fn(),
    resolveAccountName: vi.fn(),
    audit: vi.fn(async () => undefined),
    createNotification: vi.fn(async () => undefined),
    raiseAlert: vi.fn(async () => undefined),
    deriveBalances: vi.fn(),
    readWalletCurrency: vi.fn(),
}));

vi.mock('../../config/index.js', async (orig) => {
    const real = await orig<typeof import('../../config/index.js')>();
    return { ...real, config: { ...real.config, platformPaystack: { secretKey: 'sk_test_platform' } } };
});
vi.mock('../../services/payout-transfer.js', async (orig) => ({
    ...(await orig<typeof import('../../services/payout-transfer.js')>()),
    initiateTransfer: mocks.initiateTransfer,
    markPayoutProcessing: mocks.markPayoutProcessing,
    reportTransferUncertain: mocks.reportTransferUncertain,
    markPayoutFailed: mocks.markPayoutFailed,
}));
vi.mock('../../services/payout-request.js', async (orig) => ({
    ...(await orig<typeof import('../../services/payout-request.js')>()),
    createWithdrawal: mocks.createWithdrawal,
}));
vi.mock('../../services/platform-switches.js', () => ({ isPayoutsPaused: mocks.isPayoutsPaused }));
vi.mock('../../services/payout-recipient.js', async (orig) => ({
    ...(await orig<typeof import('../../services/payout-recipient.js')>()),
    createTransferRecipient: mocks.createTransferRecipient,
    listMomoProviders: mocks.listMomoProviders,
    resolveAccountName: mocks.resolveAccountName,
}));
vi.mock('../../services/audit.js', () => ({ audit: mocks.audit }));
vi.mock('../../services/notifications.js', () => ({ createNotification: mocks.createNotification }));
vi.mock('../../services/alerts.js', () => ({ raiseAlert: mocks.raiseAlert }));
vi.mock('../../services/ledger.js', async (orig) => ({
    ...(await orig<typeof import('../../services/ledger.js')>()),
    deriveBalances: mocks.deriveBalances,
    readWalletCurrency: mocks.readWalletCurrency,
}));

const TENANT = 'tenant-aaa';
const PASSWORD = 'correct horse battery';
import { resetThrottleMemory } from '../../services/admin-throttle.js';
let app: FastifyInstance;
let role = 'OWNER';
let errs: typeof import('../../services/payout-transfer.js');
let reqErrs: typeof import('../../services/payout-request.js');

const prisma: any = {
    user: { findFirst: vi.fn() },
    payoutRecipient: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    payoutRequest: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
};

beforeAll(async () => {
    const { default: moneyRoutes } = await import('./index.js');
    errs = await import('../../services/payout-transfer.js');
    reqErrs = await import('../../services/payout-request.js');
    app = Fastify({ logger: false });
    await app.register(sensible);
    app.decorate('prisma', prisma as never);
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: 'user-1', tenantId: TENANT, role };
    });
    await app.register(moneyRoutes as any, { prefix: '/money' });
    await app.ready();
});
afterAll(async () => { await app?.close(); });

beforeEach(async () => {
    vi.clearAllMocks();
    resetThrottleMemory();
    role = 'OWNER';
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    prisma.user.findFirst.mockResolvedValue({ passwordHash });
    prisma.payoutRecipient.findFirst.mockResolvedValue(null);
    prisma.payoutRecipient.create.mockImplementation(async ({ data }: any) => ({
        id: 'rcp_new', accountName: data.accountName, accountNumberMasked: data.accountNumberMasked, bankCode: data.bankCode, usableFrom: data.usableFrom,
    }));
    mocks.readWalletCurrency.mockResolvedValue({ walletExists: true, currency: 'GHS' });
    mocks.deriveBalances.mockResolvedValue({ availableMinor: 1000, pendingMinor: 200, payoutPendingMinor: 0 });
    mocks.isPayoutsPaused.mockResolvedValue({ paused: false });
    mocks.createWithdrawal.mockResolvedValue({
        payoutId: 'po_1', amountMinor: 5000, currency: 'GHS', recipientId: 'rcp_snap', recipientCode: 'RCP_snap',
    });
    mocks.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1', status: 'pending' });
    mocks.markPayoutProcessing.mockResolvedValue({ advanced: true });
    mocks.markPayoutFailed.mockResolvedValue({ applied: true });
    mocks.reportTransferUncertain.mockResolvedValue(undefined);
    mocks.createTransferRecipient.mockResolvedValue({ recipientCode: 'RCP_new', accountName: 'Ama Mensah' });
    mocks.listMomoProviders.mockResolvedValue([]);
    mocks.resolveAccountName.mockResolvedValue('Ama Mensah');
});

const withdraw = (payload: Record<string, unknown> = { amountMinor: 5000, password: PASSWORD }) =>
    app.inject({ method: 'POST', url: '/money/withdraw', payload });
const saveDestination = (payload: Record<string, unknown> = {}) =>
    app.inject({
        method: 'POST', url: '/money/destination',
        payload: { accountNumber: '0241234567', provider: 'MTN', password: PASSWORD, ...payload },
    });

describe('withdraw: step-up authentication', () => {
    it('refuses without a password, before anything moves', async () => {
        const res = await withdraw({ amountMinor: 5000 });
        expect(res.statusCode).toBe(400);
        expect(mocks.createWithdrawal).not.toHaveBeenCalled();
    });

    it('refuses a wrong password with 403, audits the failure, and moves nothing', async () => {
        const res = await withdraw({ amountMinor: 5000, password: 'wrong' });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toMatch(/password/i);
        expect(mocks.createWithdrawal).not.toHaveBeenCalled();
        expect(mocks.initiateTransfer).not.toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'money.step_up_failed', tenantId: TENANT, actorId: 'user-1',
            metadata: expect.objectContaining({ for: 'withdraw' }),
        }));
        // the password itself is never logged
        expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('wrong');
    });

    it('staff are refused before the password is even looked at', async () => {
        role = 'STAFF';
        const res = await withdraw();
        expect(res.statusCode).toBe(403);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('the right password lets it through', async () => {
        const res = await withdraw();
        expect(res.statusCode).toBe(200);
        expect(mocks.createWithdrawal).toHaveBeenCalledOnce();
    });

    it('the password is never passed on to the withdrawal service', async () => {
        await withdraw();
        expect(JSON.stringify(mocks.createWithdrawal.mock.calls[0][0])).not.toContain(PASSWORD);
    });
});

describe('stable error codes: only password problems carry a PASSWORD_ code', () => {
    it('a missing password is 400 PASSWORD_REQUIRED (withdraw and destination)', async () => {
        const w = await withdraw({ amountMinor: 5000 });
        expect(w.statusCode).toBe(400);
        expect(w.json().code).toBe('PASSWORD_REQUIRED');
        const d = await saveDestination({ password: undefined });
        expect(d.statusCode).toBe(400);
        expect(d.json().code).toBe('PASSWORD_REQUIRED');
    });

    it('a wrong password is 403 PASSWORD_INCORRECT', async () => {
        const w = await withdraw({ amountMinor: 5000, password: 'wrong' });
        expect(w.statusCode).toBe(403);
        expect(w.json().code).toBe('PASSWORD_INCORRECT');
        expect((await saveDestination({ password: 'nope' })).json().code).toBe('PASSWORD_INCORRECT');
    });

    it('a bad amount with a present password is a 400 WITHOUT a password code', async () => {
        const res = await withdraw({ amountMinor: -5, password: PASSWORD });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBeUndefined();
    });

    it('withdrawal refusals (daily limit, paused) are 400 without a password code', async () => {
        mocks.createWithdrawal.mockRejectedValue(new reqErrs.WithdrawalRefusedError('payouts_paused', reqErrs.refusalMessage('payouts_paused')));
        const res = await withdraw();
        expect(res.statusCode).toBe(400);
        expect(String(res.json().code ?? '')).not.toMatch(/^PASSWORD_/);
    });

    it('the "we are checking your balance" 400 (reversal failed) has no password code', async () => {
        mocks.isPayoutsPaused.mockResolvedValue({ paused: true });
        mocks.markPayoutFailed.mockRejectedValue(new Error('db down'));
        const res = await withdraw();
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/do not try again/i);
        expect(String(res.json().code ?? '')).not.toMatch(/^PASSWORD_/);
    });
});

describe('step-up lockout', () => {
    it('five wrong passwords lock the owner: 429 PASSWORD_LOCKED with Retry-After, even for the right one, nothing moves', async () => {
        for (let i = 0; i < 5; i++) expect((await withdraw({ amountMinor: 5000, password: 'wrong' })).statusCode).toBe(403);
        const locked = await withdraw();
        expect(locked.statusCode).toBe(429);
        expect(locked.json().code).toBe('PASSWORD_LOCKED');
        expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
        expect(locked.json().message).toMatch(/minutes/i);
        expect(mocks.createWithdrawal).not.toHaveBeenCalled();
        // the destination form shares the same lock
        expect((await saveDestination()).statusCode).toBe(429);
    });

    it('a deactivated owner cannot withdraw even with the right password', async () => {
        prisma.user.findFirst.mockResolvedValue({ passwordHash: await bcrypt.hash(PASSWORD, 4), isActive: false });
        const res = await withdraw();
        expect(res.statusCode).toBe(403);
        expect(mocks.createWithdrawal).not.toHaveBeenCalled();
    });
});

describe('withdraw: pays exactly the recipient that was validated', () => {
    it('sends to the snapshotted recipient code, in the payout currency, and never re-queries the destination', async () => {
        // A destination swapped in the meantime would be returned here; it must not be.
        prisma.payoutRecipient.findFirst.mockResolvedValue({ providerCode: 'RCP_ATTACKER' });
        mocks.createWithdrawal.mockResolvedValue({
            payoutId: 'po_1', amountMinor: 5000, currency: 'NGN', recipientId: 'rcp_snap', recipientCode: 'RCP_snap',
        });
        await withdraw();
        expect(mocks.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
            recipientCode: 'RCP_snap', currency: 'NGN', amountMinor: 5000, reference: 'po_1',
        }));
        expect(prisma.payoutRecipient.findFirst).not.toHaveBeenCalled();
    });

    it('advances the payout through the guarded transition, with the provider code', async () => {
        await withdraw();
        expect(mocks.markPayoutProcessing).toHaveBeenCalledWith({
            prisma, tenantId: TENANT, payoutId: 'po_1', transferCode: 'TRF_1',
        });
    });

    it('a failed status write AFTER Paystack accepted must not reverse the payout or alarm the owner', async () => {
        mocks.markPayoutProcessing.mockRejectedValue(new Error('db blip'));
        const res = await withdraw();
        expect(res.statusCode).toBe(200);
        expect(mocks.markPayoutFailed).not.toHaveBeenCalled();
    });
});

describe('withdraw: payout switch', () => {
    it('a refusal from the service (paused) reaches the owner as a clear 400', async () => {
        mocks.createWithdrawal.mockRejectedValue(new reqErrs.WithdrawalRefusedError('payouts_paused', reqErrs.refusalMessage('payouts_paused')));
        const res = await withdraw();
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/paused/i);
        expect(mocks.initiateTransfer).not.toHaveBeenCalled();
    });

    it('paused between the request and the send: nothing is sent and the reservation is returned', async () => {
        mocks.isPayoutsPaused.mockResolvedValue({ paused: true, reason: 'internal ticket 7' });
        const res = await withdraw();
        expect(mocks.initiateTransfer).not.toHaveBeenCalled();
        expect(mocks.markPayoutFailed).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'po_1', tenantId: TENANT }));
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/paused/i);
        expect(res.json().message).toMatch(/back in your balance/i);
        expect(res.json().message).not.toMatch(/ticket/);
    });

    it('the switch cannot be read at the send step: fails closed the same way', async () => {
        mocks.isPayoutsPaused.mockRejectedValue(new Error('db down'));
        await withdraw();
        expect(mocks.initiateTransfer).not.toHaveBeenCalled();
        expect(mocks.markPayoutFailed).toHaveBeenCalled();
    });

    it('does not claim the money is back when that reversal itself failed', async () => {
        mocks.isPayoutsPaused.mockResolvedValue({ paused: true });
        mocks.markPayoutFailed.mockRejectedValue(new Error('db down'));
        const res = await withdraw();
        expect(res.json().message).not.toMatch(/back in your balance/i);
        expect(mocks.raiseAlert).toHaveBeenCalledWith(prisma, expect.objectContaining({ kind: 'payout.reversal_failed', severity: 'critical' }));
    });
});

describe('destination: step-up, currency, notification', () => {
    it('refuses without the password or with a wrong one, and never calls Paystack', async () => {
        expect((await saveDestination({ password: undefined })).statusCode).toBe(400);
        const wrong = await saveDestination({ password: 'nope' });
        expect(wrong.statusCode).toBe(403);
        expect(mocks.createTransferRecipient).not.toHaveBeenCalled();
        expect(prisma.payoutRecipient.create).not.toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'money.step_up_failed', metadata: expect.objectContaining({ for: 'destination_change' }),
        }));
    });

    it('registers the recipient in the WALLET currency', async () => {
        mocks.readWalletCurrency.mockResolvedValue({ walletExists: true, currency: 'NGN' });
        await saveDestination();
        expect(mocks.createTransferRecipient).toHaveBeenCalledWith(expect.objectContaining({ currency: 'NGN' }));
    });

    it('tells the owner when a FIRST destination is added', async () => {
        const res = await saveDestination();
        expect(res.statusCode).toBe(200);
        expect(mocks.createNotification).toHaveBeenCalledWith(prisma, expect.objectContaining({
            tenantId: TENANT, title: expect.stringMatching(/added/i),
        }), expect.anything());
        expect(res.json().coolingOffHours).toBe(0);
    });

    it('tells the owner when an existing destination is CHANGED, and holds it for cooling-off', async () => {
        prisma.payoutRecipient.findFirst.mockResolvedValue({ id: 'old' });
        const res = await saveDestination();
        expect(mocks.createNotification).toHaveBeenCalledWith(prisma, expect.objectContaining({
            title: expect.stringMatching(/changed/i),
        }), expect.anything());
        expect(res.json().coolingOffHours).toBeGreaterThan(0);
    });

    it('staff cannot change it', async () => {
        role = 'STAFF';
        expect((await saveDestination()).statusCode).toBe(403);
    });
});

describe('destination preview oracle', () => {
    const preview = (accountNumber = '0241234567') =>
        app.inject({ method: 'POST', url: '/money/destination/preview', payload: { accountNumber, provider: 'MTN' } });

    it('resolves a name and caches the repeat', async () => {
        const first = await preview('0241110001');
        expect(first.json()).toEqual({ accountName: 'Ama Mensah' });
        await preview('0241110001');
        expect(mocks.resolveAccountName).toHaveBeenCalledTimes(1);
    });

    it('answers 429 with Retry-After once the tenant has used its quota of NEW lookups', async () => {
        const { PREVIEW_WINDOW_MAX } = await import('../../services/payout-preview.js');
        let last = await preview('0242220000');
        for (let i = 1; i <= PREVIEW_WINDOW_MAX + 2; i++) last = await preview(`02422200${String(i).padStart(2, '0')}`);
        expect(last.statusCode).toBe(429);
        expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
        expect(last.json().message).toMatch(/wait/i);
    });

    it('answers 429 when the platform-wide ceiling is spent, even for a tenant that has used nothing', async () => {
        const { PREVIEW_GLOBAL_HOURLY_MAX, createPreviewGuard, defaultPreviewGuard } = await import('../../services/payout-preview.js');
        // Spend the shared ceiling through the same guard the route uses, as many tenants.
        for (let i = 0; i < PREVIEW_GLOBAL_HOURLY_MAX; i++) {
            try { await defaultPreviewGuard.consume(`other-tenant-${i}`, null); } catch { break; }
        }
        void createPreviewGuard;
        const res = await preview('0245550000');
        expect(res.statusCode).toBe(429);
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('staff cannot use it', async () => {
        role = 'STAFF';
        expect((await preview()).statusCode).toBe(403);
    });
});

describe('currency end to end on the money screen', () => {
    it('derives balances in the wallet currency and lists networks for it', async () => {
        mocks.readWalletCurrency.mockResolvedValue({ walletExists: true, currency: 'NGN' });
        prisma.payoutRecipient.findFirst.mockResolvedValue(null);
        await app.inject({ method: 'GET', url: '/money' });
        expect(mocks.deriveBalances).toHaveBeenCalledWith(prisma, TENANT, 'NGN');
        await app.inject({ method: 'GET', url: '/money/providers' });
        expect(mocks.listMomoProviders).toHaveBeenCalledWith('sk_test_platform', 'NGN');
    });
});
