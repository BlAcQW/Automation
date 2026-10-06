/**
 * Seed helpers. All write through the raw client (no tenant guard) and go
 * through the real ledger code for anything money-shaped, so a seeded wallet
 * is one the production code could have produced.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { rawPrisma } from './db.js';
import { depositReceived, fundsCleared, postMovement } from '../../../src/services/ledger.js';

const uid = () => randomUUID().replace(/-/g, '').slice(0, 12);

export async function seedTenant(over: Partial<Prisma.TenantUncheckedCreateInput> = {}) {
    return rawPrisma().tenant.create({
        data: { name: `Tenant ${uid()}`, paymentCurrency: 'GHS', planId: 'free', ...over },
    });
}

export async function seedUser(tenantId: string, over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    return rawPrisma().user.create({
        data: { tenantId, email: `${uid()}@example.test`, passwordHash: 'x', name: 'Owner', role: 'OWNER', ...over },
    });
}

export async function seedService(tenantId: string, over: Partial<Prisma.ServiceUncheckedCreateInput> = {}) {
    return rawPrisma().service.create({
        data: { tenantId, name: 'Haircut', price: 100, durationMinutes: 60, ...over },
    });
}

export async function seedBooking(
    tenantId: string,
    serviceId: string,
    over: Partial<Prisma.BookingUncheckedCreateInput> = {},
) {
    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    return rawPrisma().booking.create({
        data: {
            tenantId,
            serviceId,
            customerName: 'Ama',
            customerPhone: '+233241234567',
            startTime: start,
            endTime: new Date(start.getTime() + 3600_000),
            bookingReference: `BK-${uid()}`,
            status: 'PENDING_PAYMENT',
            paymentStatus: 'UNPAID',
            paymentReference: `ref_${uid()}`,
            collectionRoute: 'PLATFORM',
            depositAmount: 50,
            ...over,
        },
    });
}

export async function seedConversation(tenantId: string, over: Partial<Prisma.ConversationUncheckedCreateInput> = {}) {
    return rawPrisma().conversation.create({
        data: { tenantId, channel: 'WHATSAPP', externalId: `233${Math.floor(Math.random() * 1e9)}`, customerPhone: '+233241234567', ...over },
    });
}

export async function seedWallet(tenantId: string, currency = 'GHS') {
    return rawPrisma().wallet.create({ data: { tenantId, currency } });
}

/**
 * A wallet holding `availableMinor` withdrawable and `pendingMinor` pending,
 * built from real ledger movements (zero fee).
 */
export async function seedFundedWallet(
    tenantId: string,
    funds: { availableMinor?: number; pendingMinor?: number } = {},
) {
    const db = rawPrisma();
    const wallet = await seedWallet(tenantId);
    const available = funds.availableMinor ?? 0;
    const pending = funds.pendingMinor ?? 0;
    const total = available + pending;
    if (total > 0) {
        await db.$transaction(async (tx) => {
            await postMovement(tx as never, {
                tenantId, walletId: wallet.id, reason: 'DEPOSIT_RECEIVED',
                idempotencyKey: `seed:deposit:${uid()}`, lines: depositReceived(total, 0),
            });
            if (available > 0) {
                await postMovement(tx as never, {
                    tenantId, walletId: wallet.id, reason: 'FUNDS_CLEARED',
                    idempotencyKey: `seed:clear:${uid()}`, lines: fundsCleared(available),
                });
            }
        });
    }
    return wallet;
}

export async function seedPayoutRecipient(tenantId: string, over: Partial<Prisma.PayoutRecipientUncheckedCreateInput> = {}) {
    return rawPrisma().payoutRecipient.create({
        data: {
            tenantId, type: 'mobile_money', accountName: 'Ama Mensah', accountNumberEnc: 'enc',
            accountNumberMasked: '024 *** 4567', bankCode: 'MTN', providerCode: 'RCP_dbtest',
            usableFrom: new Date(Date.now() - 48 * 3600_000), isDefault: true, ...over,
        },
    });
}

/** Sum of ledger entries per account for a tenant, read raw. */
export async function ledgerSums(tenantId: string): Promise<Record<string, number>> {
    const rows = await rawPrisma().ledgerEntry.groupBy({ by: ['account'], where: { tenantId }, _sum: { amountMinor: true } });
    return Object.fromEntries(rows.map((r) => [r.account, r._sum.amountMinor ?? 0]));
}
