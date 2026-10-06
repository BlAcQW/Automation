/**
 * Customer records: one row per (tenant, phone), linked from conversations,
 * bookings and orders.
 *
 * Until now a "customer" was whatever phone string happened to be on a
 * conversation, a booking or an order, and every feature that wanted to know
 * more about one (memory, email fallback, the customers page) re-derived it by
 * matching phones. This is the single place that creates and finds the row.
 *
 * Two rules shape it:
 *  - A phone we cannot normalise is refused (null), never guessed. A guessed
 *    number would create a second, wrong customer that merges with a stranger.
 *  - Creating or enriching a customer is a side effect of a booking or an
 *    order. It must never be the reason one fails, so the booking and order
 *    paths use resolveCustomerIdSafe.
 */

import { Prisma } from '@prisma/client';
import type { Customer, TemplatePurpose } from '@prisma/client';
import { normalizeCustomerPhone } from './customer-phone.js';
import { publishEventSafe } from './events/emit.js';
import { purposeEntity } from './notification-purposes.js';
import { scoped } from '../lib/logger.js';

const log = scoped('customers');

/** The slice of prisma these helpers use; the extended client and a tx both fit. */
export type CustomerDb = any;

export interface UpsertCustomerArgs {
    tenantId: string;
    phone: string;
    name?: string | null;
    email?: string | null;
    /**
     * The business's own E.164 number, used to complete a local "0..." number.
     * When omitted it is read from the tenant, but only if needed.
     */
    businessNumber?: string | null;
}

export interface UpsertCustomerDeps {
    publish?: (prisma: CustomerDb, input: { tenantId: string; type: string; payload: Record<string, unknown> }) => Promise<unknown>;
}

function clean(value: string | null | undefined): string | undefined {
    const v = typeof value === 'string' ? value.trim() : '';
    return v === '' ? undefined : v;
}

async function normalise(prisma: CustomerDb, args: UpsertCustomerArgs): Promise<string | null> {
    const direct = normalizeCustomerPhone(args.phone ?? '', args.businessNumber ?? null);
    if (direct || args.businessNumber !== undefined) return direct;
    // A local number needs the business's country. Only pay for the lookup then.
    const tenant = await prisma.tenant.findUnique({
        where: { id: args.tenantId },
        select: { whatsappDisplayNumber: true },
    });
    return normalizeCustomerPhone(args.phone ?? '', tenant?.whatsappDisplayNumber ?? null);
}

/** Fill name/email only where the row has none: a known value is never replaced. */
async function fillMissing(
    prisma: CustomerDb,
    existing: Customer,
    name: string | undefined,
    email: string | undefined,
): Promise<Customer> {
    const data: { name?: string; email?: string } = {};
    if (name && !clean(existing.name)) data.name = name;
    if (email && !clean(existing.email)) data.email = email;
    if (Object.keys(data).length === 0) return existing;
    return prisma.customer.update({ where: { id: existing.id }, data });
}

function isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Find or create the customer for a phone. Returns null when the phone cannot
 * be normalised. Safe under concurrency: a lost insert race (P2002) reads the
 * winner's row instead of failing.
 */
export async function upsertCustomerByPhone(
    prisma: CustomerDb,
    args: UpsertCustomerArgs,
    deps: UpsertCustomerDeps = {},
): Promise<Customer | null> {
    const phone = await normalise(prisma, args);
    if (!phone) {
        log.debug({ tenantId: args.tenantId }, 'Phone could not be normalised; no customer record made');
        return null;
    }
    const name = clean(args.name);
    const email = clean(args.email);
    const where = { tenantId_phone: { tenantId: args.tenantId, phone } };

    const existing: Customer | null = await prisma.customer.findUnique({ where });
    if (existing) return fillMissing(prisma, existing, name, email);

    let created: Customer;
    try {
        created = await prisma.customer.create({
            data: { tenantId: args.tenantId, phone, name: name ?? null, email: email ?? null },
        });
    } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const winner: Customer | null = await prisma.customer.findUnique({ where });
        if (!winner) throw err;
        return fillMissing(prisma, winner, name, email);
    }

    // The versioned emit helper adds `v: 1` and swallows failures (a customer
    // record must never fail because the event log had a blip). `deps.publish`
    // is a test seam that bypasses it.
    const input = { tenantId: args.tenantId, type: 'customer.created', payload: { customerId: created.id } };
    if (deps.publish) {
        try {
            await deps.publish(prisma, { ...input, payload: { ...input.payload, v: 1 } });
        } catch (err) {
            log.warn({ err, tenantId: args.tenantId, customerId: created.id }, 'customer.created event not published');
        }
    } else {
        await publishEventSafe(prisma, input);
    }
    return created;
}

/**
 * upsertCustomerByPhone for callers that must not fail because of it (booking
 * and order creation). Returns the customer id, or null on an unusable phone
 * or any error.
 */
export async function resolveCustomerIdSafe(
    prisma: CustomerDb,
    args: UpsertCustomerArgs,
    logger?: { warn: (obj: object, msg?: string) => void },
    deps?: UpsertCustomerDeps,
): Promise<string | null> {
    try {
        const customer = await upsertCustomerByPhone(prisma, args, deps);
        return customer?.id ?? null;
    } catch (err) {
        (logger ?? log).warn({ err, tenantId: args.tenantId }, 'Customer record not linked');
        return null;
    }
}

/**
 * Point a conversation at a customer. Both must belong to the tenant; returns
 * whether the link was written.
 */
export async function linkConversationToCustomer(
    prisma: CustomerDb,
    args: { tenantId: string; conversationId: string; customerId: string },
): Promise<boolean> {
    const owned = await prisma.customer.count({ where: { id: args.customerId, tenantId: args.tenantId } });
    if (owned === 0) return false;
    const { count } = await prisma.conversation.updateMany({
        where: { id: args.conversationId, tenantId: args.tenantId },
        data: { customerId: args.customerId },
    });
    return count > 0;
}

/** The email on the Customer record, by id or by phone, within the tenant. */
export async function findCustomerEmail(
    prisma: CustomerDb,
    args: { tenantId: string; customerId?: string | null; phone?: string | null },
): Promise<string | null> {
    if (args.customerId) {
        const byId = await prisma.customer.findFirst({
            where: { id: args.customerId, tenantId: args.tenantId },
            select: { email: true },
        });
        if (clean(byId?.email)) return byId.email;
    }
    if (args.phone) {
        // Rows are stored normalised; the job may carry the raw form.
        const candidates = [args.phone];
        const normalised = normalizeCustomerPhone(args.phone, null);
        if (normalised && normalised !== args.phone) candidates.push(normalised);
        const byPhone = await prisma.customer.findFirst({
            where: { tenantId: args.tenantId, phone: { in: candidates } },
            select: { email: true },
        });
        if (clean(byPhone?.email)) return byPhone.email;
    }
    return null;
}

export interface ResolvedEmail {
    email: string | null;
    source: 'customer' | 'booking' | 'order' | null;
}

/**
 * Where to send an email fallback.
 *
 * For a booking or order purpose the LATEST booking/order for the phone comes
 * first: that is the address the customer gave most recently, and a Customer
 * record only ever fills a missing email, so it can be older than the booking.
 * The Customer record is the fallback there, and the only source for purposes
 * with no entity (generic reminders, flows). An unmapped purpose still gets the
 * Customer lookup (the caller raises the alert).
 */
export async function resolveCustomerEmail(
    prisma: CustomerDb,
    args: { tenantId: string; purpose: TemplatePurpose; customerPhone: string; customerId?: string | null },
): Promise<ResolvedEmail> {
    const entity = purposeEntity(args.purpose);
    if (entity) {
        const model = entity === 'order' ? prisma.order : prisma.booking;
        const row = await model.findFirst({
            where: { tenantId: args.tenantId, customerPhone: args.customerPhone },
            orderBy: { createdAt: 'desc' },
            select: { customerEmail: true },
        });
        if (clean(row?.customerEmail)) return { email: row.customerEmail, source: entity };
    }

    const fromCustomer = await findCustomerEmail(prisma, {
        tenantId: args.tenantId,
        customerId: args.customerId,
        phone: args.customerPhone,
    });
    return fromCustomer ? { email: fromCustomer, source: 'customer' } : { email: null, source: null };
}
