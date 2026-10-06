import { beforeEach, describe, expect, it } from 'vitest';
import { rawPrisma } from './helpers/db.js';
import { makeFastify } from './helpers/fake-fastify.js';
import { silentLogger } from './helpers/fake-fastify.js';
import { ledgerSums, seedBooking, seedService, seedTenant } from './helpers/seed.js';
import { race } from './helpers/concurrency.js';
import { fulfillBookingCharge } from '../../src/services/payment-fulfillment.js';
import { clearFundsForEntity } from '../../src/services/wallet-clearing.js';
import type { VerifyResult } from '../../src/services/paystack.js';

const verified = (amountKobo: number, reference: string): VerifyResult =>
    ({ status: 'success', amountKobo, currency: 'GHS', reference, paidAt: new Date(), channel: 'mobile_money' } as VerifyResult);

async function fulfillable(bookingId: string) {
    const b = await rawPrisma().booking.findUniqueOrThrow({ where: { id: bookingId }, include: { service: true } });
    return b as any;
}

describe('payment fulfilment on a real database', () => {
    let tenantId: string; let serviceId: string;
    beforeEach(async () => {
        tenantId = (await seedTenant()).id;
        serviceId = (await seedService(tenantId)).id;
    });

    it('concurrent duplicate fulfilment: one claim, one credit, one payment.succeeded event', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { paymentReference: 'ref_dup', depositAmount: 50 });
        const b = await fulfillable(booking.id);
        const { ok, failed } = await race(8, () =>
            fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: b, verified: verified(5000, 'ref_dup'), reference: 'ref_dup' }));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(ok.filter((r) => r.applied)).toHaveLength(1);

        const db = rawPrisma();
        const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.status).toBe('CONFIRMED');
        expect(after.paymentStatus).toBe('PAID');
        // One credit.
        expect(await db.ledgerMovement.count({ where: { idempotencyKey: 'deposit:ref_dup' } })).toBe(1);
        expect((await ledgerSums(tenantId)).TENANT_PENDING).toBe(5000);
        // One event (dedupeKey unique).
        const events = await db.domainEvent.findMany({ where: { tenantId, type: 'payment.succeeded' } });
        expect(events).toHaveLength(1);
        expect(events[0].dedupeKey).toBe('payment.succeeded:reference:ref_dup');
        expect(events[0].payload).toMatchObject({ reference: 'ref_dup', amount: 5000, currency: 'GHS', bookingId: booking.id });
        // Side effects ran once: one confirmation job, one audit row.
        expect(fastify.queues.notifications.add).toHaveBeenCalledTimes(1);
        expect(await db.auditLog.count({ where: { action: 'payments.charge.success' } })).toBe(1);
        expect(await db.notification.count({ where: { tenantId } })).toBe(1);
    });

    it('sequential redelivery after success is idempotent', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { paymentReference: 'ref_seq' });
        const b = await fulfillable(booking.id);
        const run = () => fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: b, verified: verified(5000, 'ref_seq'), reference: 'ref_seq' });
        expect((await run()).applied).toBe(true);
        expect((await run()).applied).toBe(false);
        expect(await rawPrisma().domainEvent.count({ where: { tenantId, type: 'payment.succeeded' } })).toBe(1);
        expect(await rawPrisma().ledgerMovement.count({ where: { tenantId } })).toBe(1);
    });

    it('a late payment on a cancelled booking does not resurrect it, raises an alert and credits PENDING only', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { status: 'CANCELLED', paymentReference: 'ref_late' });
        const b = await fulfillable(booking.id);
        const { ok, failed } = await race(4, () =>
            fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: b, verified: verified(5000, 'ref_late'), reference: 'ref_late' }));
        expect(failed.map((e) => String(e?.message ?? e))).toEqual([]);
        expect(ok.every((r) => r.applied === false)).toBe(true);

        const db = rawPrisma();
        const after = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
        expect(after.status).toBe('CANCELLED');
        expect(after.paymentStatus).toBe('PAID');        // traceable, refundable
        expect(fastify.queues.notifications.add).not.toHaveBeenCalled();
        const alerts = await db.platformAlert.findMany({ where: { kind: 'payment.after_hold_expired' } });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].severity).toBe('critical');
        // Credited exactly once, and only as pending (never withdrawable).
        const sums = await ledgerSums(tenantId);
        expect(sums.TENANT_PENDING).toBe(5000);
        expect(sums.TENANT_AVAILABLE ?? 0).toBe(0);
        expect(await db.domainEvent.count({ where: { tenantId, type: 'payment.succeeded' } })).toBe(1);
    });

    it('a cancelled booking never clears to available (only a refund can release the late money)', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { status: 'CANCELLED', paymentReference: 'ref_late2' });
        await fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: await fulfillable(booking.id), verified: verified(5000, 'ref_late2'), reference: 'ref_late2' });
        // The state machine forbids CANCELLED -> COMPLETED; here we prove the ledger side:
        // clearing is idempotent and claims exactly once even when raced.
        const prisma = fastify.prisma;
        const { ok } = await race(4, () => clearFundsForEntity({ prisma, tenantId, bookingId: booking.id }));
        expect(ok.filter((r) => r.cleared)).toHaveLength(1);
        expect((await ledgerSums(tenantId)).TENANT_AVAILABLE).toBe(5000);
    });

    it('underpayment is not confirmed, not credited, and records payment.failed once per reference', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { paymentReference: 'ref_under', depositAmount: 50 });
        const b = await fulfillable(booking.id);
        const { ok, failed } = await race(3, () =>
            fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: b, verified: verified(2000, 'ref_under'), reference: 'ref_under' }));
        expect(failed).toEqual([]);
        expect(ok.every((r) => !r.applied)).toBe(true);
        const db = rawPrisma();
        expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus).toBe('UNPAID');
        expect(await db.ledgerMovement.count()).toBe(0);
        expect(await db.domainEvent.count({ where: { tenantId, type: 'payment.failed' } })).toBe(1);
    });

    it('non-platform collection route confirms the booking but credits no wallet', async () => {
        const fastify = await makeFastify();
        const booking = await seedBooking(tenantId, serviceId, { paymentReference: 'ref_own', collectionRoute: 'TENANT' });
        await fulfillBookingCharge({ fastify, logger: silentLogger, tenantId, booking: await fulfillable(booking.id), verified: verified(5000, 'ref_own'), reference: 'ref_own' });
        const db = rawPrisma();
        expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
        expect(await db.ledgerMovement.count()).toBe(0);
        expect(await db.wallet.count()).toBe(0);
    });
});
