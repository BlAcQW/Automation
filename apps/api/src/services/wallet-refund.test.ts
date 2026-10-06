import { describe, it, expect, vi, beforeEach } from 'vitest';

const raise = vi.hoisted(() => vi.fn());
vi.mock('./alerts.js', () => ({ raiseAlert: raise }));
const refund = vi.hoisted(() => vi.fn());
vi.mock('./paystack.js', () => ({ refundTransaction: refund }));
const cfg = vi.hoisted(() => ({ platformPaystack: { secretKey: 'sk_platform' } as { secretKey: string } | null }));
vi.mock('../config/index.js', () => ({ config: cfg }));
vi.mock('./ledger.js', () => ({
    postMovement: vi.fn(async () => ({ duplicate: false })),
    refreshCachedBalances: vi.fn(),
    refundIssued: vi.fn(() => []),
}));
vi.mock('./wallet-clearing.js', () => ({ pendingFromEntries: vi.fn(() => 5000) }));

import { postMovement } from './ledger.js';
import {
    REFUND_ALERT_AFTER_ATTEMPTS,
    REFUND_MAX_ATTEMPTS,
    isAlreadyRefundedError,
    refundBackoffMs,
    refundDepositForBooking,
} from './wallet-refund.js';

const post = postMovement as unknown as ReturnType<typeof vi.fn>;
const NOW = new Date('2026-10-07T10:00:00Z');

function makePrisma(over: { booking?: Record<string, unknown>; claim?: number } = {}) {
    return {
        booking: {
            findFirst: vi.fn().mockResolvedValue({
                paymentStatus: 'PAID', paymentReference: 'ref1', collectionRoute: 'PLATFORM', refundAttempts: 0, ...over.booking,
            }),
            updateMany: vi.fn().mockResolvedValue({ count: over.claim ?? 1 }),
        },
        wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', currency: 'GHS' }) },
        ledgerMovement: {
            findMany: vi.fn().mockResolvedValue([{ entries: [{ account: 'TENANT_PENDING', amountMinor: 5000 }] }]),
        },
        tenant: { findUnique: vi.fn().mockResolvedValue({ paystackSecretKey: 'enc_tenant_key' }) },
        $transaction: vi.fn(async (fn: any) => fn({ wallet: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', currency: 'GHS' }) } })),
    } as any;
}

const run = (prisma: any, extra: Record<string, unknown> = {}) =>
    refundDepositForBooking({ prisma, tenantId: 't1', bookingId: 'b1', now: NOW, ...extra });
const updates = (prisma: any) => prisma.booking.updateMany.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
    raise.mockClear();
    refund.mockReset();
    refund.mockResolvedValue({ id: 'r1', status: 'pending', amountKobo: 5000, currency: 'GHS' });
    post.mockClear();
    post.mockResolvedValue({ duplicate: false });
    cfg.platformPaystack = { secretKey: 'sk_platform' };
});

describe('refund route comes from what was STORED, not the tenant current key', () => {
    it('a booking collected on the platform is refunded with the platform key even if the tenant has since connected their own', async () => {
        const prisma = makePrisma();
        const r = await run(prisma);
        expect(r).toEqual({ refunded: true, amountMinor: 5000 });
        expect(refund).toHaveBeenCalledWith('sk_platform', 'ref1', 5000, { merchantNote: 'refund:booking:b1' });
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('a booking collected on the tenant own gateway is not ours to refund', async () => {
        const prisma = makePrisma({ booking: { collectionRoute: 'OWN_GATEWAY' } });
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'not_platform_collected' });
        expect(refund).not.toHaveBeenCalled();
    });

    it('an unknown or missing stored route fails closed (never guess it from the tenant)', async () => {
        for (const collectionRoute of [null, undefined, 'SOMETHING']) {
            const prisma = makePrisma({ booking: { collectionRoute } });
            expect(await run(prisma)).toEqual({ refunded: false, reason: 'not_platform_collected' });
        }
        expect(refund).not.toHaveBeenCalled();
    });

    it('platform key missing from config is a retryable failure, not a silent skip', async () => {
        cfg.platformPaystack = null;
        const prisma = makePrisma();
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'provider_failed' });
        expect(refund).not.toHaveBeenCalled();
        expect(updates(prisma).at(-1).data).toMatchObject({ depositState: 'REFUND_PENDING', refundAttempts: 1 });
    });
});

describe('a failed refund is scheduled for retry instead of only alerting', () => {
    it('first failure: parks in REFUND_PENDING, counts the attempt, backs off, records the error, warns', async () => {
        refund.mockRejectedValue(new Error('provider down sk_live_abc123SECRET'));
        const prisma = makePrisma();
        const r = await run(prisma);
        expect(r).toEqual({ refunded: false, reason: 'provider_failed' });

        const last = updates(prisma).at(-1);
        expect(last.where).toEqual({ id: 'b1', tenantId: 't1', depositState: 'REFUNDING' });
        expect(last.data.depositState).toBe('REFUND_PENDING');
        expect(last.data.refundAttempts).toBe(1);
        expect(last.data.refundNextAttemptAt).toEqual(new Date(NOW.getTime() + refundBackoffMs(1)));
        expect(last.data.refundLastError).toContain('provider down');
        expect(last.data.refundLastError).not.toContain('SECRET');

        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'refund.provider_failed', severity: 'warning', tenantId: 't1', dedupeKey: 'refund.provider_failed:b1',
        }));
    });

    it('while parked, a clearing or a second refund cannot claim the deposit (both claim only depositState null)', async () => {
        refund.mockRejectedValue(new Error('down'));
        const prisma = makePrisma();
        await run(prisma);
        expect(updates(prisma)[0].where.depositState).toBeNull();
        expect(updates(prisma).at(-1).data.depositState).toBe('REFUND_PENDING');
    });

    it('escalates to CRITICAL once the attempt count reaches the threshold', async () => {
        refund.mockRejectedValue(new Error('down'));
        const prisma = makePrisma({ booking: { refundAttempts: REFUND_ALERT_AFTER_ATTEMPTS - 1 } });
        await run(prisma, { retry: true });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'refund.provider_failed', severity: 'critical', dedupeKey: 'refund.provider_failed:b1',
        }));
    });

    it('stops scheduling after the maximum and raises a retry_exhausted alert', async () => {
        refund.mockRejectedValue(new Error('down'));
        const prisma = makePrisma({ booking: { refundAttempts: REFUND_MAX_ATTEMPTS - 1 } });
        await run(prisma, { retry: true });
        const last = updates(prisma).at(-1);
        expect(last.data.refundAttempts).toBe(REFUND_MAX_ATTEMPTS);
        expect(last.data.refundNextAttemptAt).toBeNull();
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'refund.retry_exhausted', severity: 'critical', dedupeKey: 'refund.retry_exhausted:b1',
        }));
    });

    it('backoff grows and is capped', () => {
        const waits = Array.from({ length: REFUND_MAX_ATTEMPTS }, (_, i) => refundBackoffMs(i + 1));
        for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
        expect(refundBackoffMs(1)).toBeLessThanOrEqual(5 * 60_000);
        expect(refundBackoffMs(999)).toBe(refundBackoffMs(REFUND_MAX_ATTEMPTS));
        expect(refundBackoffMs(999)).toBeLessThanOrEqual(6 * 3600_000);
    });
});

describe('retry mode', () => {
    it('claims a REFUND_PENDING deposit, not an untouched one', async () => {
        const prisma = makePrisma();
        await run(prisma, { retry: true });
        expect(updates(prisma)[0].where.depositState).toBe('REFUND_PENDING');
    });

    it('a successful retry posts the ledger movement keyed on the booking and clears the retry bookkeeping', async () => {
        const prisma = makePrisma({ booking: { refundAttempts: 2 } });
        const r = await run(prisma, { retry: true });
        expect(r.refunded).toBe(true);
        expect(post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idempotencyKey: 'refund:booking:b1' }));
        expect(updates(prisma).at(-1).data).toMatchObject({
            depositState: 'REFUNDED', refundNextAttemptAt: null, refundLastError: null,
        });
    });

    it('lost claim (another sweeper got it) does nothing', async () => {
        const prisma = makePrisma({ claim: 0 });
        expect(await run(prisma, { retry: true })).toEqual({ refunded: false, reason: 'claim_lost' });
        expect(refund).not.toHaveBeenCalled();
    });

    it('a provider that says the transaction is already fully reversed counts as refunded (the first attempt did go through)', async () => {
        refund.mockRejectedValue(new Error('paystack_refund: Transaction has been fully reversed'));
        const prisma = makePrisma();
        const r = await run(prisma, { retry: true });
        expect(r.refunded).toBe(true);
        expect(post).toHaveBeenCalled();
        expect(raise).not.toHaveBeenCalled();
    });

    it('recognises the already-refunded wording but not ordinary failures', () => {
        expect(isAlreadyRefundedError(new Error('Transaction has been fully reversed'))).toBe(true);
        expect(isAlreadyRefundedError(new Error('transaction already refunded'))).toBe(true);
        expect(isAlreadyRefundedError(new Error('Insufficient balance'))).toBe(false);
        expect(isAlreadyRefundedError(new Error('network_error'))).toBe(false);
        expect(isAlreadyRefundedError('x')).toBe(false);
    });
});

describe('provider succeeded but the ledger write failed', () => {
    it('is parked for retry (the retry sees "already reversed" and only posts the ledger) and alerted critically', async () => {
        const prisma = makePrisma();
        prisma.$transaction = vi.fn(async () => { throw new Error('db down'); });
        const r = await run(prisma);
        expect(r).toEqual({ refunded: false, reason: 'ledger_failed' });
        expect(updates(prisma).at(-1).data).toMatchObject({ depositState: 'REFUND_PENDING', refundAttempts: 1 });
        expect(raise).toHaveBeenCalledWith(prisma, expect.objectContaining({
            kind: 'refund.ledger_failed', severity: 'critical', dedupeKey: 'refund.ledger_failed:b1',
        }));
    });
});

describe('unchanged guards', () => {
    it('an unpaid booking has nothing to refund', async () => {
        const prisma = makePrisma({ booking: { paymentStatus: 'UNPAID' } });
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'no_reference' });
    });

    it('a refund movement that already exists reports already_refunded', async () => {
        post.mockResolvedValue({ duplicate: true });
        const prisma = makePrisma();
        expect(await run(prisma)).toEqual({ refunded: false, reason: 'already_refunded' });
    });
});
