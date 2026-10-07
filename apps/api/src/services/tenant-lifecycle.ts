/**
 * Organisation lifecycle for the platform admin: the permanent-delete check
 * and the delete itself. Deactivate / reactivate are a flag flip and live in
 * routes/admin/tenant-lifecycle.ts.
 *
 * Rules
 *  - Only a DEACTIVATED organisation can be deleted (deactivation is the
 *    reversible step; deletion is not).
 *  - An organisation with ANY money history is never deleted: ledger
 *    movements, paid bookings/orders, paid ride passes / PAYG rides, payout
 *    requests, a non-zero wallet, or a Bookly subscription. Financial records
 *    must be kept, so such an organisation can only stay deactivated. The
 *    check runs again INSIDE the delete transaction (serializable), so a
 *    direct call or a payment landing between check and delete still refuses.
 *  - Open payment links (a held booking, an unpaid order link, a held ride
 *    pass, an in-date PAYG ride link) also block: a customer could still pay.
 *  - Every relation to Tenant cascades, but some rows are keyed by tenantId
 *    without a foreign key (FlowDefinition, PayoutRecipient, DeviceToken,
 *    WebhookDelivery, CalendarEvent via its integration id) and two FKs are
 *    RESTRICT (Booking -> Service, OrderItem -> Product). `purgeTenant`
 *    removes those explicitly, in an order that never trips a RESTRICT.
 *  - AuditLog and PlatformAlert deliberately have no FK and are kept: the
 *    audit history survives, and the tenant's open alerts are resolved.
 */
import type { ExtendedPrismaClient } from '../plugins/prisma.js';

/** The client or an interactive-transaction client: same model delegates. */
export type LifecycleDb = Omit<ExtendedPrismaClient, '$transaction' | '$connect' | '$disconnect' | '$extends'>;

export interface MoneyHistory {
    ledgerMovements: number;
    paidBookings: number;
    paidOrders: number;
    paidPasses: number;
    paidRides: number;
    payoutRequests: number;
    walletNonZero: boolean;
    /** A Bookly plan subscription was set up through Paystack. */
    subscription: boolean;
}

export type BlockerCode = 'NOT_DEACTIVATED' | 'MONEY_HISTORY' | 'OPEN_PAYMENT_LINKS';

/**
 * Payment links a customer could still pay. Deleting under them would let
 * money land at Paystack with no record to credit, so they block too.
 */
export interface OpenPaymentLinks {
    /** PENDING_PAYMENT + UNPAID: the hold sweeper cancels these once they lapse. */
    bookings: number;
    /** UNPAID with a payment link, not cancelled. */
    orders: number;
    /** HELD with the hold still in the future. */
    passes: number;
    /** PAYG PENDING_PAYMENT with the link still in date. */
    rides: number;
}

export const NO_OPEN_LINKS: OpenPaymentLinks = { bookings: 0, orders: 0, passes: 0, rides: 0 };

export const OPEN_PAYMENT_LINKS_MESSAGE = 'Has unpaid payment links still open — wait for them to expire or cancel them first.';

export interface DeleteBlocker {
    code: BlockerCode;
    message: string;
    count: number;
}

export interface DeleteCounts {
    users: number;
    conversations: number;
    messages: number;
    customers: number;
    bookings: number;
    orders: number;
    products: number;
    services: number;
    rides: number;
    passes: number;
    drivers: number;
    flows: number;
    apiKeys: number;
    webhookSubscriptions: number;
    notifications: number;
    ledgerMovements: number;
}

export interface DeleteCheck {
    tenant: { id: string; name: string; isActive: boolean };
    canDelete: boolean;
    blockers: DeleteBlocker[];
    counts: DeleteCounts;
}

/** The typed name must equal the organisation's name exactly (case-sensitive), ignoring outer whitespace. */
export function confirmNameMatches(typed: string, actual: string): boolean {
    const t = typed.trim();
    return t.length > 0 && t === actual.trim();
}

export function moneyHistoryTotal(m: MoneyHistory): number {
    return m.ledgerMovements + m.paidBookings + m.paidOrders + m.paidPasses + m.paidRides + m.payoutRequests
        + (m.walletNonZero ? 1 : 0) + (m.subscription ? 1 : 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeMoneyHistory(m: MoneyHistory): string {
    const parts: string[] = [];
    if (m.ledgerMovements) parts.push(plural(m.ledgerMovements, 'ledger movement'));
    if (m.paidBookings) parts.push(plural(m.paidBookings, 'paid booking'));
    if (m.paidOrders) parts.push(plural(m.paidOrders, 'paid order'));
    if (m.paidPasses) parts.push(plural(m.paidPasses, 'paid ride pass', 'paid ride passes'));
    if (m.paidRides) parts.push(plural(m.paidRides, 'paid ride'));
    if (m.payoutRequests) parts.push(plural(m.payoutRequests, 'payout'));
    if (m.walletNonZero) parts.push('a wallet balance');
    if (m.subscription) parts.push('a Bookly subscription');
    return parts.join(', ');
}

export function openLinksTotal(o: OpenPaymentLinks): number {
    return o.bookings + o.orders + o.passes + o.rides;
}

/** Pure: why this organisation cannot be deleted (empty = it can). */
export function blockersFor(tenant: { isActive: boolean }, money: MoneyHistory, open: OpenPaymentLinks = NO_OPEN_LINKS): DeleteBlocker[] {
    const blockers: DeleteBlocker[] = [];
    if (tenant.isActive) {
        blockers.push({ code: 'NOT_DEACTIVATED', message: 'Deactivate the organisation first.', count: 1 });
    }
    const total = moneyHistoryTotal(money);
    if (total > 0) {
        blockers.push({
            code: 'MONEY_HISTORY',
            message: `Has payment history (${describeMoneyHistory(money)}) — financial records must be kept; it can stay deactivated.`,
            count: total,
        });
    }
    const openCount = openLinksTotal(open);
    if (openCount > 0) {
        blockers.push({ code: 'OPEN_PAYMENT_LINKS', message: OPEN_PAYMENT_LINKS_MESSAGE, count: openCount });
    }
    return blockers;
}

export async function loadOpenPaymentLinks(db: LifecycleDb, tenantId: string, now: Date): Promise<OpenPaymentLinks> {
    const [bookings, orders, passes, rides] = await Promise.all([
        db.booking.count({ where: { tenantId, status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' } }),
        db.order.count({ where: { tenantId, paymentStatus: 'UNPAID', paymentAuthorizationUrl: { not: null }, status: { not: 'CANCELLED' } } }),
        db.ridePass.count({ where: { tenantId, status: 'HELD', holdExpiresAt: { gt: now } } }),
        db.ride.count({ where: { tenantId, kind: 'PAYG', status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } } }),
    ]);
    return { bookings, orders, passes, rides };
}

const PAID = { in: ['PAID', 'REFUNDED'] as ('PAID' | 'REFUNDED')[] };

export async function loadMoneyHistory(db: LifecycleDb, tenantId: string): Promise<MoneyHistory> {
    const [ledgerMovements, paidBookings, paidOrders, paidPasses, paidRides, payoutRequests, wallet, tenant] = await Promise.all([
        db.ledgerMovement.count({ where: { tenantId } }),
        db.booking.count({ where: { tenantId, OR: [{ paymentStatus: PAID }, { paidAt: { not: null } }] } }),
        db.order.count({ where: { tenantId, OR: [{ paymentStatus: PAID }, { paidAt: { not: null } }] } }),
        db.ridePass.count({ where: { tenantId, OR: [{ paidAt: { not: null } }, { paidAmountMinor: { not: null } }] } }),
        db.ride.count({ where: { tenantId, OR: [{ paidAt: { not: null } }, { paidAmountMinor: { not: null } }] } }),
        db.payoutRequest.count({ where: { tenantId } }),
        db.wallet.findUnique({ where: { tenantId }, select: { cachedAvailableMinor: true, cachedPendingMinor: true } }),
        db.tenant.findUnique({ where: { id: tenantId }, select: { subscriptionRef: true } }),
    ]);
    return {
        ledgerMovements,
        paidBookings,
        paidOrders,
        paidPasses,
        paidRides,
        payoutRequests,
        walletNonZero: !!wallet && (wallet.cachedAvailableMinor !== 0 || wallet.cachedPendingMinor !== 0),
        subscription: !!tenant?.subscriptionRef,
    };
}

export async function loadDeleteCounts(db: LifecycleDb, tenantId: string, ledgerMovements: number): Promise<DeleteCounts> {
    const where = { tenantId };
    const [users, conversations, messages, customers, bookings, orders, products, services, rides, passes, drivers, flows, apiKeys, webhookSubscriptions, notifications] = await Promise.all([
        db.user.count({ where }),
        db.conversation.count({ where }),
        db.message.count({ where: { conversation: { tenantId } } }),
        db.customer.count({ where }),
        db.booking.count({ where }),
        db.order.count({ where }),
        db.product.count({ where }),
        db.service.count({ where }),
        db.ride.count({ where }),
        db.ridePass.count({ where }),
        db.driver.count({ where }),
        db.flowDefinition.count({ where }),
        db.apiKey.count({ where }),
        db.webhookSubscription.count({ where }),
        db.notification.count({ where }),
    ]);
    return {
        users, conversations, messages, customers, bookings, orders, products, services, rides, passes, drivers,
        flows, apiKeys, webhookSubscriptions, notifications, ledgerMovements,
    };
}

/** The delete check, or null when the organisation does not exist. */
export async function checkTenantDeletion(db: LifecycleDb, tenantId: string, now: Date = new Date()): Promise<DeleteCheck | null> {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, isActive: true } });
    if (!tenant) return null;
    const money = await loadMoneyHistory(db, tenantId);
    const counts = await loadDeleteCounts(db, tenantId, money.ledgerMovements);
    const open = await loadOpenPaymentLinks(db, tenantId, now);
    const blockers = blockersFor(tenant, money, open);
    return { tenant, canDelete: blockers.length === 0, blockers, counts };
}

export interface PurgeResult {
    calendarEvents: number;
    bookings: number;
    orders: number;
    payoutRecipients: number;
    flowDefinitions: number;
    deviceTokens: number;
    webhookDeliveries: number;
    alertsResolved: number;
}

/**
 * Delete the tenant and everything keyed by it. Must run inside the delete
 * transaction AFTER the in-transaction re-check passed (no money history, so
 * no LedgerMovement/PayoutRequest rows exist to orphan).
 */
export async function purgeTenant(db: LifecycleDb, tenantId: string, resolvedBy: string, now: Date): Promise<PurgeResult> {
    // CalendarEvent has no FK to its integration: remove by integration id first.
    const integrations = await db.calendarIntegration.findMany({ where: { tenantId }, select: { id: true } });
    const calendarEvents = integrations.length
        ? (await db.calendarEvent.deleteMany({ where: { calendarIntegrationId: { in: integrations.map((i) => i.id) } } })).count
        : 0;
    // Booking -> Service and OrderItem -> Product are RESTRICT: remove the
    // referencing rows before the cascade reaches services/products.
    const bookings = (await db.booking.deleteMany({ where: { tenantId } })).count;
    const orders = (await db.order.deleteMany({ where: { tenantId } })).count;
    // Keyed by tenantId without a foreign key.
    const payoutRecipients = (await db.payoutRecipient.deleteMany({ where: { tenantId } })).count;
    const flowDefinitions = (await db.flowDefinition.deleteMany({ where: { tenantId } })).count;
    const deviceTokens = (await db.deviceToken.deleteMany({ where: { tenantId } })).count;
    const webhookDeliveries = (await db.webhookDelivery.deleteMany({ where: { tenantId } })).count;
    // Alerts are kept (like the audit log) but no longer ask anyone to act.
    const alertsResolved = (await db.platformAlert.updateMany({
        where: { tenantId, resolvedAt: null },
        data: { resolvedAt: now, resolvedBy },
    })).count;
    await db.tenant.delete({ where: { id: tenantId } });
    return { calendarEvents, bookings, orders, payoutRecipients, flowDefinitions, deviceTokens, webhookDeliveries, alertsResolved };
}

export type DeleteOutcome =
    | { ok: true; check: DeleteCheck; purge: PurgeResult }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'blocked'; blockers: DeleteBlocker[] };

export interface DeleteArgs {
    tenantId: string;
    adminId: string;
    reason: string;
    ipAddress: string | null;
    /** Results of the Meta cleanup that ran before the transaction. */
    cleanup: Record<string, unknown>;
    now?: Date;
}

/**
 * Re-check and delete in ONE serializable transaction, writing the
 * `tenant.deleted` audit row in the same transaction (AuditLog has no FK, so
 * it survives the cascade; it keeps the old tenantId so the organisation's
 * history stays filterable). Never deletes an organisation with money history.
 */
export async function deleteTenantPermanently(prisma: ExtendedPrismaClient, args: DeleteArgs): Promise<DeleteOutcome> {
    const now = args.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const check = await checkTenantDeletion(tx, args.tenantId, now);
        if (!check) return { ok: false as const, reason: 'not_found' as const };
        if (!check.canDelete) return { ok: false as const, reason: 'blocked' as const, blockers: check.blockers };

        const purge = await purgeTenant(tx, args.tenantId, `admin:${args.adminId}`, now);
        await tx.auditLog.create({
            data: {
                tenantId: args.tenantId,
                actorType: 'ADMIN',
                actorId: args.adminId,
                action: 'tenant.deleted',
                targetType: 'Tenant',
                targetId: args.tenantId,
                metadata: {
                    name: check.tenant.name,
                    reason: args.reason,
                    counts: { ...check.counts },
                    purged: { ...purge },
                    cleanup: args.cleanup,
                } as object,
                ipAddress: args.ipAddress,
            },
        });
        return { ok: true as const, check, purge };
    }, { isolationLevel: 'Serializable', timeout: 30_000 });
}
