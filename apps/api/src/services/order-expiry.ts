/**
 * Release stock held by orders nobody paid for.
 *
 * An order made in chat (or sent a payment link from the dashboard) is
 * PENDING + UNPAID and has already taken its stock. A customer who asked for a
 * link and walked away would hold those units forever. This sweep cancels such
 * orders after a window (ORDER_EXPIRY_MINUTES, default 60) and puts the stock back.
 *
 * Scope: only orders that have an online payment link (`paymentAuthorizationUrl`).
 * An order with no link is one staff are settling by hand (cash, transfer,
 * Paystack not connected); it is not "abandoned checkout" and is never expired.
 *
 * MULTI-PROCESS SAFETY. The cancel is a single guarded `updateMany`
 * (WHERE status = PENDING AND paymentStatus = UNPAID) and the stock increments
 * run in the SAME transaction, only if that claim returned count 1. Two sweepers
 * racing for one order: one gets count 1 and restocks, the other gets 0 and
 * skips; a restock failure rolls the cancel back so the next tick retries. A
 * payment webhook landing mid-sweep flips the row to PAID/CONFIRMED first, so
 * the claim finds nothing and the customer keeps their order.
 *
 * LATE PAYMENT. If the customer pays the (still valid) Paystack link after the
 * order expired, payment-fulfillment's fulfillOrderCharge finds status
 * CANCELLED + UNPAID, marks it PAID without re-opening it, raises a CRITICAL
 * `payment.after_order_cancelled` alert and credits the wallet as PENDING
 * (never withdrawable) so staff refund it. Nothing here changes that path.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { createNotification } from './notifications.js';

export const ORDER_EXPIRY_MINUTES_DEFAULT = 60;
/** Below this a slow checkout (3-D Secure, bank app) would be cancelled under the customer. */
const ORDER_EXPIRY_MINUTES_FLOOR = 5;
const SWEEP_EVERY_MS = 60_000;
const BATCH = 100;

export function orderExpiryMinutes(env: Record<string, string | undefined> = process.env): number {
    const n = Number(env.ORDER_EXPIRY_MINUTES);
    if (!Number.isFinite(n) || n <= 0) return ORDER_EXPIRY_MINUTES_DEFAULT;
    return Math.max(ORDER_EXPIRY_MINUTES_FLOOR, Math.floor(n));
}

export interface CancelOrderArgs {
    tenantId: string;
    orderId: string;
    items: Array<{ productId: string; quantity: number }>;
    /** Extra WHERE conditions that must still hold at claim time (the "expected state"). */
    guard: Record<string, unknown>;
}

/**
 * Cancel an order and return its stock, atomically. Returns false (and changes
 * nothing) when the guard no longer matches, so a repeat or a race never
 * restocks twice. A product that has since been deleted is skipped, not fatal.
 */
export async function cancelOrderAndRestock(prisma: ExtendedPrismaClient, args: CancelOrderArgs): Promise<boolean> {
    return prisma.$transaction(async (tx: any) => {
        const claimed = await tx.order.updateMany({
            where: { ...args.guard, id: args.orderId, tenantId: args.tenantId },
            data: { status: 'CANCELLED' },
        });
        if (claimed.count === 0) return false;
        for (const item of args.items) {
            await tx.product.updateMany({
                where: { id: item.productId, tenantId: args.tenantId },
                data: { stock: { increment: item.quantity } },
            });
        }
        return true;
    });
}

export async function expireUnpaidOrders(
    prisma: ExtendedPrismaClient,
    log?: FastifyBaseLogger,
    now: Date = new Date(),
    windowMinutes: number = orderExpiryMinutes(),
): Promise<number> {
    const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
    const candidates: Array<{
        id: string; tenantId: string; orderRef: string; customerName: string;
        items: Array<{ productId: string; quantity: number }>;
    }> = await prisma.order.findMany({
        where: {
            status: 'PENDING',
            paymentStatus: 'UNPAID',
            paymentAuthorizationUrl: { not: null },
            createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        select: {
            id: true, tenantId: true, orderRef: true, customerName: true,
            items: { select: { productId: true, quantity: true } },
        },
    });

    let expired = 0;
    for (const o of candidates) {
        try {
            const done = await cancelOrderAndRestock(prisma, {
                tenantId: o.tenantId,
                orderId: o.id,
                items: o.items,
                guard: { status: 'PENDING', paymentStatus: 'UNPAID' },
            });
            if (!done) continue;
            expired += 1;
            await createNotification(prisma, {
                tenantId: o.tenantId,
                type: 'SYSTEM',
                title: 'Unpaid order expired',
                message: `${o.customerName}'s order ${o.orderRef} was cancelled and its stock returned: not paid within ${windowMinutes} minutes.`,
                metadata: { orderId: o.id, reason: 'payment_timeout' },
            }, log).catch(() => undefined);
        } catch (err) {
            // One bad order (rolled back) must not stop the rest; the next tick retries it.
            log?.error({ err, orderId: o.id }, 'Order expiry failed for one order');
        }
    }
    if (expired > 0) log?.info({ expired }, 'Cancelled expired unpaid orders');
    return expired;
}

export function startOrderExpirySweeper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    const timer = setInterval(() => {
        expireUnpaidOrders(prisma, log).catch((err) => log.error({ err }, 'Order expiry sweep failed'));
    }, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
