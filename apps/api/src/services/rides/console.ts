/**
 * Read side of the TURBO console: overview cards, ride history, customers,
 * packages and payments. Every query is tenant-filtered (the tenant guard
 * blocks anything else in request context).
 */
import type { Prisma, RideKind, RideStatus } from '@prisma/client';
import type { RidesDb } from './db.js';
import { getRideSettings } from './settings.js';
import { passBalances } from './passes.js';
import { paygDayKey, paygUsed } from './capacity.js';
import { BOOKED_RIDE, OPEN_STATUSES, rideInclude } from './rides.js';
import { startOfDayInZone } from '../timezone.js';
import {
    balanceLogView, customerSummary, packagePaymentView, passView, paygPaymentView, personRef, rideView,
    type ConsolePassStatus, type ConsolePaymentStatus,
} from './views.js';

export interface PageQuery { page: number; limit: number }

export function pagination(q: PageQuery, total: number) {
    return { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

const skip = (q: PageQuery) => (q.page - 1) * q.limit;

function todayStart(now: Date, tz: string): Date {
    return startOfDayInZone(paygDayKey(now, tz), tz) ?? new Date(now.getTime() - 24 * 3600_000);
}

// ---------------------------------------------------------------- overview

export async function overview(db: RidesDb, tenantId: string, now = new Date()) {
    const s = await getRideSettings(db, tenantId);
    const start = todayStart(now, s.timezone);
    const day = paygDayKey(now, s.timezone);

    const [sold, activated, held, usedAgg, remainingAgg, live, used, ridesToday, passPayments, paygPayments] = await Promise.all([
        db.ridePass.count({ where: { tenantId, activatedAt: { not: null } } }),
        db.ridePass.count({ where: { tenantId, status: 'ACTIVE' } }),
        db.ridePass.count({ where: { tenantId, status: 'HELD', holdExpiresAt: { gt: now } } }),
        db.ridePassEntry.aggregate({ where: { tenantId, type: 'RIDE' }, _sum: { delta: true } }),
        db.ridePassEntry.aggregate({ where: { tenantId, pass: { status: 'ACTIVE' } }, _sum: { delta: true } }),
        db.ride.groupBy({ by: ['status'], where: { tenantId, status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
        paygUsed(db, tenantId, day),
        db.ride.groupBy({ by: ['kind'], where: { tenantId, requestedAt: { gte: start }, ...BOOKED_RIDE }, _count: { _all: true } }),
        db.ridePass.findMany({
            where: { tenantId, OR: [{ paidAt: { gte: start } }, { createdAt: { gte: start } }, { status: 'HELD' }] },
            select: { paidAt: true, status: true, holdExpiresAt: true, createdAt: true },
        }),
        db.ride.findMany({
            where: { tenantId, kind: 'PAYG', OR: [{ paidAt: { gte: start } }, { createdAt: { gte: start } }, { status: 'PENDING_PAYMENT' }] },
            select: { paidAt: true, status: true, paymentExpiresAt: true, createdAt: true },
        }),
    ]);

    const payments = { SUCCEEDED: 0, PENDING: 0, FAILED: 0 };
    for (const p of passPayments) {
        if (p.paidAt) { if (p.paidAt >= start) payments.SUCCEEDED++; continue; }
        if (p.status === 'HELD' && p.holdExpiresAt && p.holdExpiresAt > now) payments.PENDING++;
        else if (p.createdAt >= start) payments.FAILED++;
    }
    for (const r of paygPayments) {
        if (r.paidAt) { if (r.paidAt >= start) payments.SUCCEEDED++; continue; }
        if (r.status === 'PENDING_PAYMENT' && r.paymentExpiresAt && r.paymentExpiresAt > now) payments.PENDING++;
        else if (r.createdAt >= start) payments.FAILED++;
    }

    const liveCounts = { REQUESTED: 0, ASSIGNED: 0, EN_ROUTE: 0 } as Record<'REQUESTED' | 'ASSIGNED' | 'EN_ROUTE', number>;
    for (const g of live) liveCounts[g.status as keyof typeof liveCounts] = g._count._all;
    const today = { PACKAGE: 0, PAYG: 0 } as Record<RideKind, number>;
    for (const g of ridesToday) today[g.kind] = g._count._all;

    return {
        packages: { sold, activated, cap: s.foundingCap, slotsLeft: Math.max(0, s.foundingCap - sold - held), held },
        rides: { used: -(usedAgg._sum.delta ?? 0), remaining: Math.max(0, remainingAgg._sum.delta ?? 0) },
        live: liveCounts,
        payg: { open: s.paygOpen, dailyLimit: s.paygDailyLimit, used, available: Math.max(0, s.paygDailyLimit - used) },
        payments,
        ridesToday: today,
    };
}

// ---------------------------------------------------------------- rides

export async function liveRides(db: RidesDb, tenantId: string, status: RideStatus | undefined, mask: boolean) {
    const rows = await db.ride.findMany({
        where: { tenantId, status: status ? status : { in: OPEN_STATUSES } },
        orderBy: { requestedAt: 'desc' },
        take: 200,
        include: rideInclude,
    });
    return { data: rows.map((r) => rideView(r, mask)), pagination: { page: 1, limit: 200, total: rows.length, totalPages: 1 } };
}

export interface RideHistoryQuery extends PageQuery {
    from?: Date;
    to?: Date;
    status?: RideStatus;
    kind?: RideKind;
}

export async function rideHistory(db: RidesDb, tenantId: string, q: RideHistoryQuery, mask: boolean) {
    const where: Prisma.RideWhereInput = {
        tenantId,
        ...BOOKED_RIDE,
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.from || q.to ? { requestedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
        db.ride.findMany({ where, orderBy: { requestedAt: 'desc' }, skip: skip(q), take: q.limit, include: rideInclude }),
        db.ride.count({ where }),
    ]);
    return { data: rows.map((r) => rideView(r, mask)), pagination: pagination(q, total) };
}

// ---------------------------------------------------------------- customers

export async function customerList(db: RidesDb, tenantId: string, q: PageQuery & { search?: string }, mask: boolean) {
    const term = q.search?.trim();
    const where: Prisma.CustomerWhereInput = { tenantId };
    if (term) {
        // Phone and email search are withheld from masked viewers (a digit-at-a-time way back to the hidden number).
        where.OR = [
            { name: { contains: term, mode: 'insensitive' } },
            { attributes: { path: ['studentId'], string_contains: term } },
            { attributes: { path: ['university'], string_contains: term } },
            ...(mask ? [] : [{ phone: { contains: term } }, { email: { contains: term, mode: 'insensitive' as const } }]),
        ];
    }
    const [rows, total] = await Promise.all([
        db.customer.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: skip(q), take: q.limit }),
        db.customer.count({ where }),
    ]);
    const passes = rows.length
        ? await db.ridePass.findMany({ where: { tenantId, customerId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' } })
        : [];
    const balances = await passBalances(db, tenantId, passes.map((p) => p.id));
    return {
        data: rows.map((c) => customerSummary(c, passes.filter((p) => p.customerId === c.id), balances, mask)),
        pagination: pagination(q, total),
    };
}

export async function customerDetail(db: RidesDb, tenantId: string, customerId: string, mask: boolean) {
    const customer = await db.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) return null;
    const [passes, entries, rides] = await Promise.all([
        db.ridePass.findMany({ where: { tenantId, customerId }, orderBy: { createdAt: 'desc' } }),
        db.ridePassEntry.findMany({ where: { tenantId, pass: { customerId } }, orderBy: { createdAt: 'asc' }, take: 1000 }),
        db.ride.findMany({ where: { tenantId, customerId, ...BOOKED_RIDE }, orderBy: { requestedAt: 'desc' }, take: 100, include: rideInclude }),
    ]);
    const balances = await passBalances(db, tenantId, passes.map((p) => p.id));
    const rideIds = entries.flatMap((e) => (e.rideId ? [e.rideId] : []));
    const refs = rideIds.length
        ? await db.ride.findMany({ where: { tenantId, id: { in: rideIds } }, select: { id: true, ref: true } })
        : [];
    return {
        ...customerSummary(customer, passes, balances, mask),
        createdAt: customer.createdAt,
        passes: passes.map((p) => passView(p, balances.get(p.id))),
        balanceLog: balanceLogView(entries, new Map(refs.map((r) => [r.id, r.ref]))),
        rides: rides.map((r) => rideView(r, mask)),
    };
}

// ---------------------------------------------------------------- packages

export async function passList(db: RidesDb, tenantId: string, q: PageQuery & { status?: ConsolePassStatus }, mask: boolean) {
    const include = { customer: { select: { id: true, name: true, phone: true } } } as const;
    const view = (rows: Prisma.RidePassGetPayload<{ include: typeof include }>[], balances: Awaited<ReturnType<typeof passBalances>>) =>
        rows.map((p) => passView(p, balances.get(p.id), personRef(p.customer, mask)));

    if (q.status === 'ACTIVE' || q.status === 'EXHAUSTED') {
        // Exhausted is ACTIVE with nothing left: split in memory (at most the founding cap of rows).
        const rows = await db.ridePass.findMany({ where: { tenantId, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, include, take: 5000 });
        const balances = await passBalances(db, tenantId, rows.map((p) => p.id));
        const wanted = rows.filter((p) => ((balances.get(p.id)?.remaining ?? 0) <= 0) === (q.status === 'EXHAUSTED'));
        return { data: view(wanted.slice(skip(q), skip(q) + q.limit), balances), pagination: pagination(q, wanted.length) };
    }
    const status = q.status === 'PENDING_PAYMENT' ? 'HELD' : q.status;
    const where: Prisma.RidePassWhereInput = { tenantId, ...(status ? { status } : {}) };
    const [rows, total] = await Promise.all([
        db.ridePass.findMany({ where, orderBy: { createdAt: 'desc' }, skip: skip(q), take: q.limit, include }),
        db.ridePass.count({ where }),
    ]);
    const balances = await passBalances(db, tenantId, rows.map((p) => p.id));
    return { data: view(rows, balances), pagination: pagination(q, total) };
}

// ---------------------------------------------------------------- payments

function passPaymentWhere(tenantId: string, status: ConsolePaymentStatus | undefined, now: Date): Prisma.RidePassWhereInput | null {
    switch (status) {
        case undefined: return { tenantId };
        case 'SUCCEEDED': return { tenantId, paidAt: { not: null } };
        case 'PENDING': return { tenantId, paidAt: null, status: 'HELD', holdExpiresAt: { gt: now } };
        case 'FAILED': return { tenantId, paidAt: null, OR: [{ status: 'CANCELLED' }, { status: 'HELD', holdExpiresAt: { lte: now } }, { status: 'HELD', holdExpiresAt: null }] };
        case 'REFUNDED': return null; // refunds are made in the tenant's own Paystack and not tracked here
    }
}

function paygPaymentWhere(tenantId: string, status: ConsolePaymentStatus | undefined, now: Date): Prisma.RideWhereInput | null {
    const base = { tenantId, kind: 'PAYG' as const };
    switch (status) {
        case undefined: return base;
        case 'SUCCEEDED': return { ...base, paidAt: { not: null } };
        case 'PENDING': return { ...base, paidAt: null, status: 'PENDING_PAYMENT', paymentExpiresAt: { gt: now } };
        case 'FAILED': return { ...base, paidAt: null, OR: [{ status: 'CANCELLED' }, { status: 'PENDING_PAYMENT', paymentExpiresAt: { lte: now } }] };
        case 'REFUNDED': return null;
    }
}

export async function paymentList(
    db: RidesDb,
    tenantId: string,
    q: PageQuery & { kind?: RideKind; status?: ConsolePaymentStatus },
    mask: boolean,
    now = new Date(),
) {
    const customer = { select: { id: true, name: true, phone: true } } as const;
    const passWhere = q.kind === 'PAYG' ? null : passPaymentWhere(tenantId, q.status, now);
    const rideWhere = q.kind === 'PACKAGE' ? null : paygPaymentWhere(tenantId, q.status, now);
    const upto = q.page * q.limit; // enough of each side to merge one page
    const [passes, passTotal, rides, rideTotal] = await Promise.all([
        passWhere ? db.ridePass.findMany({ where: passWhere, orderBy: { createdAt: 'desc' }, take: upto, include: { customer } }) : [],
        passWhere ? db.ridePass.count({ where: passWhere }) : 0,
        rideWhere ? db.ride.findMany({ where: rideWhere, orderBy: { createdAt: 'desc' }, take: upto, include: { customer } }) : [],
        rideWhere ? db.ride.count({ where: rideWhere }) : 0,
    ]);
    const merged = [
        ...passes.map((p) => packagePaymentView(p, mask, now)),
        ...rides.map((r) => paygPaymentView(r, mask, now)),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { data: merged.slice(skip(q), skip(q) + q.limit), pagination: pagination(q, passTotal + rideTotal) };
}
