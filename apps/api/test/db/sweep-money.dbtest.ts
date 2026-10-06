/**
 * Column-existence sweep, part 3 (bookings, money lifecycle, onboarding,
 * billing statement, emergency switches) plus the deposit-state races that
 * mock-based tests cannot see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { guardedPrisma, rawPrisma } from './helpers/db.js';
import { ledgerSums, seedBooking, seedConversation, seedFundedWallet, seedPayoutRecipient, seedService, seedTenant, seedUser } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { silentLogger } from './helpers/fake-fastify.js';
import { cancelBooking } from '../../src/services/booking-cancel.js';
import { creditDepositToWallet } from '../../src/services/wallet-credit.js';
import { clearFundsForEntity } from '../../src/services/wallet-clearing.js';
import { refundDepositForBooking } from '../../src/services/wallet-refund.js';
import { retryDueRefunds } from '../../src/services/refund-retry.js';
import { refundOrderPayment } from '../../src/services/order-refund.js';
import { createWithdrawal } from '../../src/services/payout-request.js';
import { createTenantWithOwner, DuplicateOwnerEmailError } from '../../src/services/tenant-onboarding.js';
import { getStatement } from '../../src/services/billing-usage.js';
import {
    isOutboundPaused, isPayoutsPaused, setPlatformSetting, setTenantSwitch, clearSwitchCache, PAYOUTS_PAUSED_KEY,
} from '../../src/services/platform-switches.js';
import { refundTransaction } from '../../src/services/paystack.js';

vi.mock('../../src/services/paystack.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/paystack.js')>();
    return { ...actual, refundTransaction: vi.fn() };
});
const refund = vi.mocked(refundTransaction);

/** A CONFIRMED + PAID platform-collected booking with its deposit sitting pending in the wallet. */
async function paidBooking(tenantId: string, serviceId: string, reference: string, over: Record<string, unknown> = {}) {
    const prisma = await guardedPrisma();
    const booking = await seedBooking(tenantId, serviceId, {
        status: 'CONFIRMED', paymentStatus: 'PAID', paymentReference: reference, paidAt: new Date(), collectionRoute: 'PLATFORM', ...over,
    });
    await creditDepositToWallet({ prisma, tenantId, grossMinor: 5000, currency: 'GHS', reference, storedRoute: 'PLATFORM', bookingId: booking.id });
    return booking;
}

describe('booking cancellation money paths', () => {
    let tenantId: string; let serviceId: string;
    beforeEach(async () => {
        refund.mockReset();
        refund.mockResolvedValue(undefined as never);
        tenantId = (await seedTenant()).id;
        serviceId = (await seedService(tenantId)).id;
    });
    const queue = () => ({ add: vi.fn().mockResolvedValue({ id: 'j' }), remove: vi.fn() }) as any;

    it('customer cancel forfeits the deposit: booking CANCELLED, notification stored, funds cleared to available, no refund call', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_forfeit');
        const nq = queue();
        const r = await cancelBooking({ prisma, bookingId: b.id, tenantId, reason: 'changed my mind', cancelledBy: 'CUSTOMER', notificationsQueue: nq, remindersQueue: queue() });
        expect(r.ok).toBe(true);
        const db = rawPrisma();
        expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CANCELLED');
        expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).depositState).toBe('CLEARED');
        const sums = await ledgerSums(tenantId);
        expect(sums.TENANT_PENDING).toBe(0);
        expect(sums.TENANT_AVAILABLE).toBe(5000);
        expect(refund).not.toHaveBeenCalled();
        expect(nq.add).toHaveBeenCalledTimes(1);
        // These notification writes are .catch(() => undefined) in the service: assert the ROW, not the absence of an error.
        const notes = await db.notification.findMany({ where: { tenantId } });
        expect(notes.map((n) => n.type)).toEqual(['BOOKING_CANCELLED']);
        expect(notes[0].metadata).toMatchObject({ bookingId: b.id, reason: 'changed my mind' });
    });

    it('business cancel refunds through the provider and reverses the pending credit exactly once', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_biz');
        const r = await cancelBooking({ prisma, bookingId: b.id, tenantId, reason: 'sick', cancelledBy: 'BUSINESS' });
        expect(r.ok).toBe(true);
        expect(refund).toHaveBeenCalledTimes(1);
        expect(refund.mock.calls[0][1]).toBe('ref_biz');
        expect(refund.mock.calls[0][2]).toBe(5000);
        const db = rawPrisma();
        expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).depositState).toBe('REFUNDED');
        const sums = await ledgerSums(tenantId);
        expect(sums.TENANT_PENDING).toBe(0);
        expect(sums.EXTERNAL).toBe(0); // paid in 5000, refunded 5000
        expect(await db.ledgerMovement.count({ where: { idempotencyKey: `refund:booking:${b.id}` } })).toBe(1);
    });

    it('two simultaneous cancels: one wins the status claim, one money step', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_two');
        const { ok } = await race(4, () => cancelBooking({ prisma, bookingId: b.id, tenantId, reason: 'x', cancelledBy: 'BUSINESS' }));
        expect(ok.filter((r) => r.ok)).toHaveLength(1);
        expect(ok.filter((r) => !r.ok).every((r: any) => r.reason === 'already_cancelled')).toBe(true);
        expect(refund).toHaveBeenCalledTimes(1);
        expect(await rawPrisma().notification.count({ where: { tenantId } })).toBe(1);
    });

    it('refuses to cancel what is not cancellable or not found (and never cross-tenant)', async () => {
        const prisma = await guardedPrisma();
        const other = (await seedTenant()).id;
        const held = await seedBooking(tenantId, serviceId, { status: 'PENDING_PAYMENT' });
        const done = await seedBooking(tenantId, serviceId, { status: 'COMPLETED' });
        const c = (id: string, t = tenantId) => cancelBooking({ prisma, bookingId: id, tenantId: t, reason: 'x', cancelledBy: 'CUSTOMER' });
        expect(await c(held.id)).toEqual({ ok: false, reason: 'not_cancellable' });
        expect(await c(done.id)).toEqual({ ok: false, reason: 'not_cancellable' });
        expect(await c('nope')).toEqual({ ok: false, reason: 'not_found' });
        expect(await c(held.id, other)).toEqual({ ok: false, reason: 'not_found' });
    });

    it('a failed provider refund parks the deposit REFUND_PENDING (wave-3 columns exist) and keeps it untouchable by clearing', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_fail');
        refund.mockRejectedValueOnce(new Error('paystack down sk_test_abcdef123456'));
        const res = await refundDepositForBooking({ prisma, tenantId, bookingId: b.id });
        expect(res).toEqual({ refunded: false, reason: 'provider_failed' });
        const row = await rawPrisma().booking.findUniqueOrThrow({ where: { id: b.id } });
        expect(row.depositState).toBe('REFUND_PENDING');
        expect(row.refundAttempts).toBe(1);
        expect(row.refundNextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
        expect(row.refundLastError).toContain('paystack down');
        expect(row.refundLastError).not.toContain('sk_test_abcdef123456'); // keys are scrubbed
        expect(await rawPrisma().platformAlert.count({ where: { kind: 'refund.provider_failed' } })).toBe(1);
        // Neither a clearing nor a second (non-retry) refund can claim it.
        expect((await clearFundsForEntity({ prisma, tenantId, bookingId: b.id })).reason).toBe('already_cleared');
        expect((await refundDepositForBooking({ prisma, tenantId, bookingId: b.id })).reason).toBe('claim_lost');
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(5000);
    });

    it('the retry sweep refunds a due parked deposit; two sweeps racing call the provider once', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_retry');
        refund.mockRejectedValueOnce(new Error('timeout'));
        await refundDepositForBooking({ prisma, tenantId, bookingId: b.id });
        refund.mockClear();
        refund.mockImplementation((async () => { await new Promise((r) => setTimeout(r, 100)); }) as never);
        const later = new Date(Date.now() + 24 * 3600_000);
        const { ok } = await race(2, () => retryDueRefunds(prisma, undefined, later));
        expect(refund).toHaveBeenCalledTimes(1);
        expect(ok.reduce((t, r) => t + r.refunded, 0)).toBe(1);
        const row = await rawPrisma().booking.findUniqueOrThrow({ where: { id: b.id } });
        expect(row.depositState).toBe('REFUNDED');
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(0);
        expect(await rawPrisma().ledgerMovement.count({ where: { idempotencyKey: `refund:booking:${b.id}` } })).toBe(1);
    });

    it('stranded REFUNDING claims (crashed process) are recovered by the sweep', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_strand');
        await rawPrisma().$executeRaw`UPDATE "Booking" SET "depositState" = 'REFUNDING', "updatedAt" = now() - interval '1 hour' WHERE id = ${b.id}`;
        const r = await retryDueRefunds(prisma);
        expect(r.recovered).toBe(1);
        expect(r.refunded).toBe(1);
        expect((await rawPrisma().booking.findUniqueOrThrow({ where: { id: b.id } })).depositState).toBe('REFUNDED');
    });

    it('a refund and a clearing racing on one deposit: exactly one wins, pending never goes negative', async () => {
        const prisma = await guardedPrisma();
        const b = await paidBooking(tenantId, serviceId, 'ref_race');
        const { ok, failed } = await race(2, (i) => (i === 0
            ? refundDepositForBooking({ prisma, tenantId, bookingId: b.id })
            : clearFundsForEntity({ prisma, tenantId, bookingId: b.id })));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        const refunded = (ok[0] as any).refunded === true;
        const cleared = (ok[1] as any).cleared === true;
        expect(Number(refunded) + Number(cleared)).toBe(1);
        const sums = await ledgerSums(tenantId);
        expect(sums.TENANT_PENDING).toBe(0);
        expect(sums.TENANT_AVAILABLE ?? 0).toBe(cleared ? 5000 : 0);
        expect(refund).toHaveBeenCalledTimes(refunded ? 1 : 0);
    });

    it('a fee is reversed with the refund (platform fee returns to zero)', async () => {
        const prisma = await guardedPrisma();
        const booking = await seedBooking(tenantId, serviceId, { status: 'CONFIRMED', paymentStatus: 'PAID', paymentReference: 'ref_fee', collectionRoute: 'PLATFORM' });
        // Post a fee-bearing deposit directly (the env fee rate is 0 in tests).
        const { depositReceived, postMovement, ensureWallet } = await import('../../src/services/ledger.js');
        const w = await ensureWallet(prisma, tenantId, 'GHS');
        await prisma.$transaction((tx) => postMovement(tx as never, {
            tenantId, walletId: w.id, reason: 'DEPOSIT_RECEIVED', idempotencyKey: 'deposit:ref_fee', lines: depositReceived(5000, 250), bookingId: booking.id,
        }));
        const res = await refundDepositForBooking({ prisma, tenantId, bookingId: booking.id });
        expect(res).toMatchObject({ refunded: true, amountMinor: 5000 });
        const sums = await ledgerSums(tenantId);
        expect(sums.PLATFORM_FEE).toBe(0);
        expect(sums.TENANT_PENDING).toBe(0);
        expect(sums.EXTERNAL).toBe(0);
    });
});

describe('tenant onboarding (admin creates an organisation)', () => {
    const input = (email: string) => ({
        name: 'Glow Salon', timezone: 'Africa/Accra', vertical: 'APPOINTMENTS' as const, planId: 'free' as const,
        monthlyMessageQuotaOverride: 250, owner: { name: 'Ama Mensah', email },
    });
    const deps = (over: Record<string, unknown> = {}) => ({
        prisma: rawPrisma() as any, secret: 'x'.repeat(40), frontendUrl: 'https://app.example.test',
        emailConfigured: true, sendInvite: vi.fn().mockResolvedValue({ ok: true }), ...over,
    });

    it('writes tenant, OWNER user and default working hours in one transaction and sends the invite', async () => {
        const d = deps();
        const out = await createTenantWithOwner(d as never, input('owner@example.test'));
        expect(out.invite).toEqual({ sent: true });
        const tenant = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: out.tenant.id } });
        expect(tenant).toMatchObject({ name: 'Glow Salon', vertical: 'APPOINTMENTS', planId: 'free', monthlyMessageQuotaOverride: 250, timezone: 'Africa/Accra' });
        expect(tenant.quotaCycleStart).toBeInstanceOf(Date);
        const user = await rawPrisma().user.findFirstOrThrow({ where: { tenantId: tenant.id } });
        expect(user).toMatchObject({ email: 'owner@example.test', role: 'OWNER', isActive: true });
        expect(await rawPrisma().workingHours.count({ where: { tenantId: tenant.id } })).toBe(5);
        expect(d.sendInvite).toHaveBeenCalledTimes(1);
    });

    it('a duplicate owner email is refused and leaves no orphan tenant', async () => {
        await createTenantWithOwner(deps() as never, input('dupe@example.test'));
        await expect(createTenantWithOwner(deps() as never, input('dupe@example.test'))).rejects.toBeInstanceOf(DuplicateOwnerEmailError);
        expect(await rawPrisma().tenant.count()).toBe(1);
        expect(await rawPrisma().user.count({ where: { email: 'dupe@example.test' } })).toBe(1);
    });

    // BUG (reported, not fixed here): the uniqueness check is find-then-create,
    // and the only DB constraint is (tenantId, email), which a brand-new tenant
    // can never violate, so the P2002 -> DuplicateOwnerEmailError catch in
    // tenant-onboarding.ts is dead code. A double-submitted form creates several
    // tenants owned by the same email, which login (by email alone) cannot tell apart.
    it('a double-submitted admin form creates exactly one organisation for the owner email', async () => {
        const { ok, failed } = await race(4, () => createTenantWithOwner(deps() as never, input('race@example.test')));
        expect(ok).toHaveLength(1);
        for (const e of failed) expect(e).toBeInstanceOf(DuplicateOwnerEmailError);
        expect(await rawPrisma().user.count({ where: { email: 'race@example.test' } })).toBe(1);
    });

    it('without email configured the invite link is returned for the admin to pass on', async () => {
        const out = await createTenantWithOwner(deps({ emailConfigured: false }) as never, input('nomail@example.test'));
        expect(out.invite).toMatchObject({ sent: false, reason: 'email_not_configured' });
        expect(out.invite.link).toContain('/reset-password?token=');
    });
});

describe('billing statement + emergency switches against the real schema', () => {
    let tenantId: string;
    beforeEach(async () => { clearSwitchCache(); tenantId = (await seedTenant({ timezone: 'Africa/Accra' })).id; });

    it('getStatement reads tenant, BillingTerms and counts the billable DomainEvents inside the month', async () => {
        const prisma = await guardedPrisma();
        expect(await getStatement(prisma as never, 'missing-tenant')).toBeNull();
        const empty = await getStatement(prisma as never, tenantId, '2026-10');
        expect(empty).toMatchObject({ tenantId, unitCount: 0, totalMinor: 0 });
        expect(empty!.period.month).toBe('2026-10');

        const db = rawPrisma();
        await db.billingTerms.create({
            data: { tenantId, currency: 'GHS', monthlyFeeMinor: 10_000, unitPriceMinor: 50, unitEventType: 'flow.completed', createdAt: new Date('2026-09-01T00:00:00Z') },
        });
        const mk = (createdAt: string, type = 'flow.completed') => db.domainEvent.create({ data: { tenantId, type, payload: {}, createdAt: new Date(createdAt) } });
        await mk('2026-10-02T10:00:00Z');
        await mk('2026-10-30T10:00:00Z');
        await mk('2026-09-30T10:00:00Z');           // previous month
        await mk('2026-10-05T10:00:00Z', 'other.type');
        const stmt = await getStatement(prisma as never, tenantId, '2026-10');
        expect(stmt!.unitCount).toBe(2);
        expect(stmt!.lines.find((l) => l.code === 'usage')).toMatchObject({ quantity: 2, unitAmountMinor: 50, amountMinor: 100 });
        expect(stmt!.totalMinor).toBe(10_000 + 100);
    });

    it('usage counts from when the unit type was set (read from the real audit trail), and says so', async () => {
        const prisma = await guardedPrisma();
        const db = rawPrisma();
        await db.billingTerms.create({
            data: { tenantId, currency: 'GHS', monthlyFeeMinor: 0, unitPriceMinor: 10, unitEventType: 'flow.completed', createdAt: new Date('2026-09-01T00:00:00Z') },
        });
        await db.auditLog.create({
            data: {
                tenantId, actorType: 'ADMIN', action: 'billing.terms.updated', targetType: 'BillingTerms', targetId: tenantId,
                metadata: { before: { unitEventType: null }, after: { unitEventType: 'flow.completed' } },
                createdAt: new Date('2026-10-10T00:00:00Z'),
            },
        });
        const mk = (createdAt: string) => db.domainEvent.create({ data: { tenantId, type: 'flow.completed', payload: {}, createdAt: new Date(createdAt) } });
        await mk('2026-10-02T10:00:00Z'); // partial, pre-change rows: must not be counted
        await mk('2026-10-12T10:00:00Z');
        await mk('2026-10-20T10:00:00Z');
        const stmt = await getStatement(prisma as never, tenantId, '2026-10', new Date('2026-11-05T00:00:00Z'));
        expect(stmt!.unitCount).toBe(2);
        expect(stmt!.unitCountedFrom).toEqual(new Date('2026-10-10T00:00:00Z'));
        expect(stmt!.notes.join(' ')).toMatch(/counting began inside this period/i);
    });

    it('tenant pause flags and the platform setting both stop payouts and outbound, and resuming clears them', async () => {
        const prisma = await guardedPrisma();
        expect(await isPayoutsPaused(prisma, tenantId)).toEqual({ paused: false });
        expect(await setTenantSwitch(prisma, tenantId, 'payouts', true, 'investigating fraud')).toBe(true);
        expect(await isPayoutsPaused(prisma, tenantId)).toMatchObject({ paused: true, reason: 'investigating fraud' });
        expect(await isOutboundPaused(prisma, tenantId)).toEqual({ paused: false });
        const row = await rawPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
        expect(row.payoutsPausedAt).toBeInstanceOf(Date);
        expect(row.pauseReason).toBe('investigating fraud');
        await setTenantSwitch(prisma, tenantId, 'payouts', false);
        expect(await isPayoutsPaused(prisma, tenantId)).toEqual({ paused: false });

        await setPlatformSetting(prisma, PAYOUTS_PAUSED_KEY, { paused: true, reason: 'incident' }, 'admin-1');
        expect(await isPayoutsPaused(prisma, tenantId)).toMatchObject({ paused: true, reason: 'incident' });
        expect(await rawPrisma().platformSetting.findUniqueOrThrow({ where: { key: PAYOUTS_PAUSED_KEY } })).toMatchObject({ updatedBy: 'admin-1' });
    });

    it('a paused tenant cannot withdraw: refused and nothing written', async () => {
        const prisma = await guardedPrisma();
        const userId = (await seedUser(tenantId)).id;
        await seedPayoutRecipient(tenantId);
        await seedFundedWallet(tenantId, { availableMinor: 5000 });
        await setTenantSwitch(prisma, tenantId, 'payouts', true, 'hold on');
        await expect(createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 1000 }))
            .rejects.toMatchObject({ reason: 'payouts_paused' });
        expect(await rawPrisma().payoutRequest.count()).toBe(0);
        expect((await ledgerSums(tenantId)).TENANT_AVAILABLE).toBe(5000);
        await setTenantSwitch(prisma, tenantId, 'payouts', false);
        await expect(createWithdrawal({ prisma, tenantId, requestedByUserId: userId, amountMinor: 1000 })).resolves.toMatchObject({ amountMinor: 1000 });
    });
});


describe('order refund for a late payment on a cancelled order (real DB)', () => {
    let tenantId: string;
    beforeEach(async () => {
        refund.mockReset();
        refund.mockResolvedValue(undefined as never);
        tenantId = (await seedTenant()).id;
    });
    async function cancelledPaidOrder(reference: string) {
        const prisma = await guardedPrisma();
        const order = await rawPrisma().order.create({
            data: {
                tenantId, orderRef: `ORD-${reference}`, customerName: 'Kojo', customerPhone: '+233241234567', totalAmount: 50,
                status: 'CANCELLED', paymentStatus: 'PAID', paymentReference: reference, collectionRoute: 'PLATFORM', paidAt: new Date(),
            },
        });
        await creditDepositToWallet({ prisma, tenantId, grossMinor: 5000, currency: 'GHS', reference, storedRoute: 'PLATFORM', orderId: order.id });
        return order;
    }

    it('refunds once on the stored route, reverses the pending credit, keyed refund:order:<id>; a replay is a no-op', async () => {
        const prisma = await guardedPrisma();
        const o = await cancelledPaidOrder('ord_ref_1');
        expect(await refundOrderPayment({ prisma, tenantId, orderId: o.id })).toEqual({ refunded: true, amountMinor: 5000 });
        expect(refund).toHaveBeenCalledTimes(1);
        expect(refund.mock.calls[0][1]).toBe('ord_ref_1');
        expect((await rawPrisma().order.findUniqueOrThrow({ where: { id: o.id } })).depositState).toBe('REFUNDED');
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(0);
        expect(await rawPrisma().ledgerMovement.count({ where: { idempotencyKey: `refund:order:${o.id}` } })).toBe(1);
        expect((await refundOrderPayment({ prisma, tenantId, orderId: o.id })).refunded).toBe(false);
        expect(refund).toHaveBeenCalledTimes(1);
    });

    it('two racing refunds call the provider once', async () => {
        const prisma = await guardedPrisma();
        const o = await cancelledPaidOrder('ord_ref_2');
        refund.mockImplementation((async () => { await new Promise((r) => setTimeout(r, 100)); }) as never);
        const { ok } = await race(2, () => refundOrderPayment({ prisma, tenantId, orderId: o.id }));
        expect(refund).toHaveBeenCalledTimes(1);
        expect(ok.filter((r) => r.refunded)).toHaveLength(1);
        expect(ok.filter((r) => r.reason === 'claim_lost')).toHaveLength(1);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(0);
    });

    it('provider failure parks the order (money stays pending), alerts critical with orderId; a retry then succeeds', async () => {
        const prisma = await guardedPrisma();
        const o = await cancelledPaidOrder('ord_ref_3');
        refund.mockRejectedValueOnce(new Error('paystack down'));
        expect((await refundOrderPayment({ prisma, tenantId, orderId: o.id })).reason).toBe('provider_failed');
        expect((await rawPrisma().order.findUniqueOrThrow({ where: { id: o.id } })).depositState).toBe('REFUND_PENDING');
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(5000);
        const alert = await rawPrisma().platformAlert.findFirstOrThrow({ where: { kind: 'order.refund_failed' } });
        expect(JSON.stringify(alert.context)).toContain(o.id);
        expect((await refundOrderPayment({ prisma, tenantId, orderId: o.id })).reason).toBe('claim_lost');
        expect((await refundOrderPayment({ prisma, tenantId, orderId: o.id, retry: true })).refunded).toBe(true);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(0);
    });
});
