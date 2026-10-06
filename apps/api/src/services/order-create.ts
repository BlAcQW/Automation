/**
 * Create an order for a PRODUCT business, callable from anywhere (the LLM
 * agent's create_order tool).
 *
 * This mirrors POST /orders (routes/orders/index.ts) field for field, so an
 * order made in chat is indistinguishable from one made in the dashboard. It is
 * a separate service rather than an extraction because that route is owned
 * elsewhere; once it is free, it should call this instead of duplicating it.
 *
 * One deliberate difference: the stock decrement is a GUARDED atomic update
 * (`stock >= quantity` in the WHERE), so two customers racing for the last
 * unit cannot both succeed and stock can never go negative. The route checks
 * stock with a read first and decrements unconditionally afterwards, which
 * leaves a window under concurrency.
 */

import { nanoid } from 'nanoid';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { generatePublicToken } from '../lib/public-token.js';
import { resolveCustomerIdSafe } from './customers.js';
import { emitOrderCreated } from './events/emit.js';

/** A chat order is a handful of things, not a wholesale purchase. This is the default cap. */
export const MAX_LINE_QUANTITY = 100;
/** Staff entering an order in the dashboard may be taking a wholesale one. Still a sanity bound. */
export const DASHBOARD_MAX_LINE_QUANTITY = 10_000;

export type OrderErrorCode = 'NO_ITEMS' | 'INVALID_QUANTITY' | 'UNKNOWN_PRODUCT' | 'OUT_OF_STOCK' | 'NO_PHONE';

export class OrderError extends Error {
    constructor(
        readonly code: OrderErrorCode,
        message: string,
        readonly details: { productName?: string; available?: number } = {},
    ) {
        super(message);
        this.name = 'OrderError';
    }
    get productName(): string | undefined { return this.details.productName; }
    get available(): number | undefined { return this.details.available; }
}

export interface CreateOrderArgs {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    customerName: string;
    customerPhone: string;
    /** ISO 4217, used for the order.created event. */
    currency: string;
    items: Array<{ productId: string; quantity: number }>;
    deliveryAddress?: string;
    notes?: string;
    /**
     * Per-product cap (after merging duplicate lines). Defaults to MAX_LINE_QUANTITY (chat);
     * the dashboard route passes DASHBOARD_MAX_LINE_QUANTITY.
     */
    maxLineQuantity?: number;
    /**
     * Link the order to the Customer record for this phone (default true).
     * False when the phone is only what a customer TYPED (Instagram/Messenger):
     * it could be anyone's, and linking would put this order in their history.
     */
    linkCustomer?: boolean;
    log?: { warn: (obj: object, msg?: string) => void };
}

/**
 * Duplicate lines for one product are merged (one order line, one guarded stock
 * decrement, stable lock order). The total is identical to keeping them apart,
 * and the cap applies to the merged quantity.
 */
function mergeLines(items: CreateOrderArgs['items'], max: number): Array<{ productId: string; quantity: number }> {
    const byProduct = new Map<string, number>();
    for (const { productId, quantity } of items) {
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
            throw new OrderError('INVALID_QUANTITY', `Quantity must be a whole number from 1 to ${max}.`);
        }
        byProduct.set(productId, (byProduct.get(productId) ?? 0) + quantity);
    }
    for (const q of byProduct.values()) {
        if (q > max) throw new OrderError('INVALID_QUANTITY', `At most ${max} of one product per order.`);
    }
    // Stable order so concurrent multi-line orders take row locks the same way.
    return [...byProduct.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([productId, quantity]) => ({ productId, quantity }));
}

export async function createOrderAtomic(args: CreateOrderArgs) {
    const { prisma, tenantId } = args;
    if (!args.items.length) throw new OrderError('NO_ITEMS', 'An order needs at least one item.');
    if (!args.customerPhone) throw new OrderError('NO_PHONE', 'A phone number is needed to place an order.');
    const lines = mergeLines(args.items, args.maxLineQuantity ?? MAX_LINE_QUANTITY);

    const customerId = args.linkCustomer === false
        ? null
        : await resolveCustomerIdSafe(
            prisma as any,
            { tenantId, phone: args.customerPhone, name: args.customerName },
            args.log,
        ).catch(() => null);

    const order = await prisma.$transaction(async (tx: any) => {
        const products: Array<{ id: string; name: string; price: unknown; stock: number }> = await tx.product.findMany({
            where: { id: { in: lines.map((l) => l.productId) }, tenantId, isActive: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        if (lines.some((l) => !byId.has(l.productId))) {
            throw new OrderError('UNKNOWN_PRODUCT', 'One or more products were not found.');
        }

        // Minor units: 3 x 0.10 must be 0.30, and the total is stored to 2dp.
        let totalMinor = 0;
        const orderItems = lines.map((l) => {
            const unitPrice = Number(byId.get(l.productId)!.price);
            totalMinor += Math.round(unitPrice * 100) * l.quantity;
            return { productId: l.productId, quantity: l.quantity, unitPrice };
        });

        const created = await tx.order.create({
            data: {
                tenantId,
                orderRef: `ORD-${nanoid(8).toUpperCase()}`,
                customerName: args.customerName,
                customerPhone: args.customerPhone,
                customerId,
                totalAmount: totalMinor / 100,
                deliveryAddress: args.deliveryAddress,
                notes: args.notes,
                publicToken: generatePublicToken(),
                items: { create: orderItems },
            },
            include: { items: { include: { product: true } } },
        });

        for (const l of lines) {
            const { count } = await tx.product.updateMany({
                where: { id: l.productId, tenantId, isActive: true, stock: { gte: l.quantity } },
                data: { stock: { decrement: l.quantity } },
            });
            if (count === 0) {
                const p = byId.get(l.productId)!;
                // Throwing rolls the whole transaction back: no order, no partial decrement.
                throw new OrderError('OUT_OF_STOCK', `Not enough stock for ${p.name}.`, {
                    productName: p.name,
                    available: Math.max(0, p.stock),
                });
            }
        }
        return created;
    });

    // After the commit and never fatal: an event failure must not undo an order.
    await emitOrderCreated(prisma, {
        tenantId,
        orderId: order.id,
        customerId: customerId ?? null,
        total: Number(order.totalAmount),
        currency: args.currency,
    }).catch((err: unknown) => args.log?.warn({ err, orderId: order.id }, 'order.created event failed'));

    return order;
}
