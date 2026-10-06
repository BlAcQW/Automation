import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

const mocks = vi.hoisted(() => ({
    initiateTransfer: vi.fn(),
    reportTransferUncertain: vi.fn(),
    markPayoutFailed: vi.fn(),
    createWithdrawal: vi.fn(),
}));

vi.mock('../../config/index.js', async (orig) => {
    const real = await orig<typeof import('../../config/index.js')>();
    return { ...real, config: { ...real.config, platformPaystack: { secretKey: 'sk_test_platform' } } };
});

vi.mock('../../services/payout-transfer.js', async (orig) => {
    const real = await orig<typeof import('../../services/payout-transfer.js')>();
    return {
        ...real,
        initiateTransfer: mocks.initiateTransfer,
        reportTransferUncertain: mocks.reportTransferUncertain,
        markPayoutFailed: mocks.markPayoutFailed,
    };
});

vi.mock('../../services/payout-request.js', async (orig) => {
    const real = await orig<typeof import('../../services/payout-request.js')>();
    return { ...real, createWithdrawal: mocks.createWithdrawal };
});

vi.mock('../../services/audit.js', () => ({ audit: vi.fn(async () => undefined) }));

const TENANT = 'tenant-aaa';
let app: FastifyInstance;
const prisma = {
    payoutRecipient: { findFirst: vi.fn(async () => ({ providerCode: 'RCP_1' })) },
    payoutRequest: { updateMany: vi.fn(async () => ({ count: 1 })) },
};

beforeAll(async () => {
    const { default: moneyRoutes } = await import('./index.js');
    const { TransferUncertainError, TransferRejectedError } = await import('../../services/payout-transfer.js');
    (globalThis as any).__errs = { TransferUncertainError, TransferRejectedError };
    app = Fastify({ logger: false });
    await app.register(sensible);
    app.decorate('prisma', prisma as never);
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: 'user-1', tenantId: TENANT, role: 'OWNER' };
    });
    await app.register(moneyRoutes as any, { prefix: '/money' });
    await app.ready();
});

afterAll(async () => {
    await app?.close();
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWithdrawal.mockResolvedValue({ payoutId: 'po_1', amountMinor: 5000, currency: 'GHS' });
    mocks.reportTransferUncertain.mockResolvedValue(undefined);
    mocks.markPayoutFailed.mockResolvedValue({ applied: true });
});

const withdraw = () =>
    app.inject({ method: 'POST', url: '/money/withdraw', payload: { amountMinor: 5000 } });

describe('POST /money/withdraw transfer outcomes', () => {
    it('reverses a rejected transfer scoped to the caller\'s tenant', async () => {
        const { TransferRejectedError } = (globalThis as any).__errs;
        mocks.initiateTransfer.mockRejectedValue(new TransferRejectedError('insufficient balance'));
        await withdraw();
        expect(mocks.markPayoutFailed).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'po_1', tenantId: TENANT }));
    });

    it('does not claim the money is back when the reversal itself failed', async () => {
        const { TransferRejectedError } = (globalThis as any).__errs;
        mocks.initiateTransfer.mockRejectedValue(new TransferRejectedError('insufficient balance'));
        mocks.markPayoutFailed.mockRejectedValue(new Error('db down'));
        const res = await withdraw();
        expect(res.statusCode).toBe(502);
        expect(res.json().message).not.toMatch(/back in your balance/i);
    });

    it('raises the payout.uncertain alert when the outcome is unknown, and does not reverse', async () => {
        const { TransferUncertainError } = (globalThis as any).__errs;
        mocks.initiateTransfer.mockRejectedValue(new TransferUncertainError('network_error: timeout'));

        const res = await withdraw();

        // Must not be flattened into "nothing has left your balance — try
        // again": the money may be on its way, and a retry could pay twice.
        expect(res.statusCode).toBe(504);
        expect(res.json().message).toMatch(/do not try again/i);
        expect(res.json().message).not.toMatch(/nothing has left/i);
        expect(mocks.reportTransferUncertain).toHaveBeenCalledOnce();
        expect(mocks.reportTransferUncertain).toHaveBeenCalledWith({
            prisma,
            tenantId: TENANT,
            payoutId: 'po_1',
            detail: 'network_error: timeout',
        });
        expect(mocks.markPayoutFailed).not.toHaveBeenCalled();
    });

    it('still answers 504 when raising the alert itself fails', async () => {
        const { TransferUncertainError } = (globalThis as any).__errs;
        mocks.initiateTransfer.mockRejectedValue(new TransferUncertainError('indeterminate_http_502'));
        mocks.reportTransferUncertain.mockRejectedValue(new Error('db down'));

        const res = await withdraw();

        expect(res.statusCode).toBe(504);
        expect(mocks.markPayoutFailed).not.toHaveBeenCalled();
    });

    it('does not raise the uncertain alert for a definitive rejection (money goes back)', async () => {
        const { TransferRejectedError } = (globalThis as any).__errs;
        mocks.initiateTransfer.mockRejectedValue(new TransferRejectedError('insufficient balance'));

        const res = await withdraw();

        expect(res.statusCode).toBe(502);
        expect(mocks.reportTransferUncertain).not.toHaveBeenCalled();
        expect(mocks.markPayoutFailed).toHaveBeenCalledOnce();
    });

    it('does not alert on success', async () => {
        mocks.initiateTransfer.mockResolvedValue({ transferCode: 'TRF_1', status: 'pending' });

        const res = await withdraw();

        expect(res.statusCode).toBe(200);
        expect(mocks.reportTransferUncertain).not.toHaveBeenCalled();
    });
});
