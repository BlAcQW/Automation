/**
 * Product and order tools for the assistant of a PRODUCT business ("shop").
 *
 * Same contract as the appointment tools in llm-agent.ts: the model only calls
 * these, and everything with a consequence (prices, stock, the order, the
 * payment link) is decided in code. Every query is scoped by tenantId, and
 * order lookups are further scoped to the customer's VERIFIED phone (WhatsApp) or,
 * where there is none, to the orders this conversation created, so one customer
 * can never read another's order. Stock and order creation reuse
 * services/order-create.ts (guarded atomic decrement; never negative).
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config/index.js';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { createPaymentLink } from './payment-link.js';
import { createNotification } from './notifications.js';
import { createOrderAtomic, OrderError, MAX_LINE_QUANTITY } from './order-create.js';
import { ownedIds, rememberOwned } from './chat-ownership.js';
import { orderExpiryMinutes } from './order-expiry.js';

/** The slice of AgentContext these tools need (kept structural to avoid an import cycle). */
export interface ShopToolContext {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    currency: string;
    paystackSecretKeyEncrypted: string | null;
    customerPhone: string;
    conversationId: string;
    /** Which inbox this is. Only WhatsApp gives a phone the platform has verified. */
    channel?: 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';
    log?: FastifyBaseLogger;
}

/**
 * True only when `customerPhone` is the sender number the channel itself
 * reported (WhatsApp). On Instagram / Messenger any phone was TYPED by the
 * customer and is a claim, not an identity: it must never scope a lookup of
 * orders, tracking links or payment links (see chat-ownership.ts).
 */
export function isPhoneVerified(ctx: { channel?: string; customerPhone: string }): boolean {
    return ctx.channel === 'WHATSAPP' && !!ctx.customerPhone;
}

/** A customer may have at most this many chat-created orders waiting for payment. */
export const MAX_OPEN_UNPAID_CHAT_ORDERS = 3;

type OrderScope = { customerPhone: string } | { id: { in: string[] } };

/**
 * The only orders this customer may see or pay for: by verified phone, or (no
 * verified identity) by the ids this conversation created. null = none.
 */
async function orderScope(ctx: ShopToolContext): Promise<OrderScope | null> {
    if (isPhoneVerified(ctx)) return { customerPhone: ctx.customerPhone };
    const ids = await ownedIds(ctx.prisma, ctx.tenantId, ctx.conversationId, 'orders');
    return ids.length ? { id: { in: ids } } : null;
}

const NO_CHAT_ORDERS =
    'No orders were placed in this conversation, and an order can only be looked up in the chat it was placed in. ' +
    'Do not ask for a phone number to look one up. If they ordered another way, offer request_human.';

const DEFAULT_LIST = 10;
const MAX_LIST = 20;
const QUERY_MAX = 80;
/** A repeated create_order within this window is the same order, not a new one. */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

const money = (ctx: ShopToolContext, v: unknown) => `${ctx.currency} ${Number(v).toFixed(2)}`;

export const SHOP_TOOLS: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'list_products',
            description:
                'List or search this shop\'s products with price and how many are in stock. Call this before ' +
                'discussing what is available, a price, or stock. Pass `query` for a name/category search. Never guess.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'optional words to match against name, description or category' },
                    limit: { type: 'number', description: `optional, max ${MAX_LIST}` },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_product',
            description: 'Get one product\'s details, price and current stock by id (from list_products).',
            parameters: {
                type: 'object',
                properties: { productId: { type: 'string' } },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_order',
            description:
                'Place an order. Only call after the customer has agreed to the exact items, quantities and total. ' +
                'Call it ONCE per order. It returns the order reference and a payment link to send in the same reply.',
            parameters: {
                type: 'object',
                properties: {
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                productId: { type: 'string', description: 'id from list_products' },
                                quantity: { type: 'number', description: 'whole number, at least 1' },
                            },
                            required: ['productId', 'quantity'],
                            additionalProperties: false,
                        },
                    },
                    customerName: { type: 'string' },
                    deliveryAddress: { type: 'string', description: 'where to deliver, if they want delivery' },
                    notes: { type: 'string', description: 'anything else the shop should know (e.g. will collect)' },
                },
                required: ['items', 'customerName'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_order_status',
            description:
                'Look up this customer\'s orders: status, payment and items. Omit reference for their most recent orders.',
            parameters: {
                type: 'object',
                properties: { reference: { type: 'string', description: 'optional order reference (e.g. ORD-...)' } },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_order_payment_link',
            description:
                'Get the payment link for the customer\'s unpaid order, e.g. when they ask how or where to pay, or lost ' +
                'the link. Omit reference to use their most recent unpaid order. Send the link as-is.',
            parameters: {
                type: 'object',
                properties: { reference: { type: 'string', description: 'optional order reference (e.g. ORD-...)' } },
                required: [],
                additionalProperties: false,
            },
        },
    },
];

export const SHOP_TOOL_NAMES: ReadonlySet<string> = new Set(SHOP_TOOLS.flatMap((t) => (t.type === 'function' ? [t.function.name] : [])));

type ToolOut = { result: unknown };

const orderItemsArg = z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number(),
})).min(1).max(20);

function normaliseItems(items: Array<{ productId: string; quantity: number }>) {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.quantity);
    return m;
}

function sameItems(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

async function ownerNotice(ctx: ShopToolContext, title: string, message: string, metadata: Record<string, unknown>) {
    await createNotification(ctx.prisma, { tenantId: ctx.tenantId, type: 'SYSTEM', title, message, metadata: metadata as Prisma.InputJsonValue }, ctx.log)
        .catch(() => undefined);
}

function orderReply(ctx: ShopToolContext, order: any) {
    return {
        reference: order.orderRef,
        status: order.status,
        total: money(ctx, order.totalAmount),
        items: order.items.map((i: any) => ({
            name: i.product?.name,
            quantity: i.quantity,
            unitPrice: money(ctx, i.unitPrice),
        })),
    };
}

async function listProducts(ctx: ShopToolContext, args: Record<string, unknown>): Promise<ToolOut> {
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, QUERY_MAX) : '';
    const asked = Number(args.limit);
    const take = Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_LIST) : DEFAULT_LIST;

    const products = await ctx.prisma.product.findMany({
        where: {
            tenantId: ctx.tenantId,
            isActive: true,
            ...(query
                ? {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                        { category: { contains: query, mode: 'insensitive' } },
                    ],
                }
                : {}),
        },
        // In-stock first so a long catalogue shows what can actually be bought.
        orderBy: [{ stock: 'desc' }, { name: 'asc' }],
        take,
        select: { id: true, name: true, description: true, price: true, stock: true, category: true },
    });
    if (products.length === 0) {
        return { result: { products: [], note: query ? 'Nothing matches that search.' : 'No products are listed yet.' } };
    }
    return {
        result: {
            products: products.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                category: p.category,
                price: String(p.price),
                inStock: p.stock > 0,
                stock: Math.max(0, p.stock),
            })),
        },
    };
}

async function getProduct(ctx: ShopToolContext, args: Record<string, unknown>): Promise<ToolOut> {
    const productId = String(args.productId ?? '');
    const p = await ctx.prisma.product.findFirst({
        where: { id: productId, tenantId: ctx.tenantId, isActive: true },
        select: { id: true, name: true, description: true, price: true, stock: true, category: true },
    });
    if (!p) return { result: { error: 'Product not found — call list_products to see what is available.' } };
    return {
        result: {
            id: p.id, name: p.name, description: p.description, category: p.category,
            price: String(p.price), inStock: p.stock > 0, stock: Math.max(0, p.stock),
        },
    };
}

async function createOrder(ctx: ShopToolContext, args: Record<string, unknown>): Promise<ToolOut> {
    if (!ctx.customerPhone) {
        return {
            result: {
                error:
                    'No phone number on file for this customer. Ask for their phone number, save it with ' +
                    'save_customer_phone, then call create_order again.',
            },
        };
    }
    const parsed = orderItemsArg.safeParse(args.items);
    if (!parsed.success) {
        return { result: { error: 'items must be a list of { productId, quantity } with at least one entry.' } };
    }
    const items = parsed.data;
    const customerName = String(args.customerName ?? '').trim() || 'Customer';
    const deliveryAddress = typeof args.deliveryAddress === 'string' && args.deliveryAddress.trim() ? args.deliveryAddress.trim() : undefined;
    const notes = typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : undefined;

    // Same customer = verified phone, or (Instagram / Messenger) only the orders
    // THIS conversation made. A typed phone must not find, return or be blocked
    // by someone else's orders.
    const scope = await orderScope(ctx);

    // The model sometimes repeats a call. Same customer + same items moments ago
    // and still unpaid is the same order: return it, do not take stock twice.
    const recent = scope ? await ctx.prisma.order.findMany({
        where: {
            tenantId: ctx.tenantId,
            ...scope,
            status: 'PENDING',
            paymentStatus: 'UNPAID',
            createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { items: { include: { product: { select: { name: true } } } } },
    }) : [];
    const wanted = normaliseItems(items);
    const dup = recent.find((o: any) => sameItems(wanted, normaliseItems(o.items)));
    if (dup) {
        const payUrl = dup.paymentAuthorizationUrl ?? await payLinkFor(ctx, dup);
        return {
            result: {
                ...orderReply(ctx, dup),
                alreadyPlaced: true,
                ...(payUrl ? { payUrl } : { note: 'The team will send the payment link shortly.' }),
            },
        };
    }

    // Unpaid orders hold stock until they expire, so chat may not open an
    // unbounded number of them.
    const open = scope ? await ctx.prisma.order.count({
        where: { tenantId: ctx.tenantId, ...scope, status: 'PENDING', paymentStatus: 'UNPAID' },
    }) : 0;
    if (open >= MAX_OPEN_UNPAID_CHAT_ORDERS) {
        return {
            result: {
                error:
                    `This customer already has ${open} orders waiting for payment (the limit is ${MAX_OPEN_UNPAID_CHAT_ORDERS}). ` +
                    'Nothing was ordered. Tell them kindly: pay one of them first (use get_order_payment_link to resend a link), ' +
                    `or it will be released automatically if unpaid after ${orderExpiryMinutes()} minutes, and then they can order again.`,
            },
        };
    }

    let order;
    try {
        order = await createOrderAtomic({
            prisma: ctx.prisma,
            tenantId: ctx.tenantId,
            customerName,
            customerPhone: ctx.customerPhone,
            currency: ctx.currency,
            items,
            deliveryAddress,
            notes,
            log: ctx.log,
            linkCustomer: isPhoneVerified(ctx),
        });
    } catch (err) {
        if (err instanceof OrderError) {
            switch (err.code) {
                case 'OUT_OF_STOCK':
                    return {
                        result: {
                            error: `Not enough stock for ${err.productName}: ${err.available ?? 0} left. ` +
                                'Offer that amount or an alternative from list_products. Nothing was ordered.',
                        },
                    };
                case 'UNKNOWN_PRODUCT':
                    return { result: { error: 'One of those products is not available. Call list_products and use ids from it. Nothing was ordered.' } };
                case 'INVALID_QUANTITY':
                    return { result: { error: `Quantities must be whole numbers from 1 to ${MAX_LINE_QUANTITY}. Nothing was ordered.` } };
                case 'NO_PHONE':
                    return { result: { error: 'No phone number on file. Ask for it and call save_customer_phone first.' } };
                default:
                    return { result: { error: 'The order could not be placed. Nothing was ordered.' } };
            }
        }
        // Unexpected (database down, ...): let the turn fail and retry rather than
        // have the model tell the customer something untrue.
        throw err;
    }

    if (!isPhoneVerified(ctx)) await rememberOwned(ctx.prisma, ctx.tenantId, ctx.conversationId, 'orders', order.id);

    await ownerNotice(
        ctx,
        'New order',
        `${customerName} placed order ${order.orderRef} for ${money(ctx, order.totalAmount)} via chat.`,
        { orderId: order.id, source: 'assistant' },
    );

    const payUrl = await payLinkFor(ctx, order);
    if (!payUrl) {
        await ownerNotice(
            ctx,
            'Order payment link not created',
            `Order ${order.orderRef} (${money(ctx, order.totalAmount)}) has no payment link: online payment could not be set up. Contact ${customerName} to arrange payment.`,
            { orderId: order.id, reason: 'no_payment_link' },
        );
        return {
            result: {
                ...orderReply(ctx, order),
                note: 'Online payment is not available right now. The order is placed; say the team will contact them to arrange payment. Do not invent a link.',
            },
        };
    }
    return {
        result: {
            ...orderReply(ctx, order),
            payUrl,
            instruction:
                'In THIS reply: give the order reference, the items and the total with currency, and paste payUrl ' +
                'exactly as given. The order is confirmed once they pay. Do NOT call create_order again for this order.',
        },
    };
}

function payLinkFor(ctx: ShopToolContext, order: { id: string; totalAmount: unknown }): Promise<string | null> {
    const amount = Number(order.totalAmount);
    if (!(amount > 0)) return Promise.resolve(null);
    return createPaymentLink({
        prisma: ctx.prisma,
        tenantId: ctx.tenantId,
        paystackSecretKeyEncrypted: ctx.paystackSecretKeyEncrypted,
        currency: ctx.currency,
        entity: 'order',
        id: order.id,
        amount,
        customerPhone: ctx.customerPhone,
    });
}

async function getOrderStatus(ctx: ShopToolContext, args: Record<string, unknown>): Promise<ToolOut> {
    const scope = await orderScope(ctx);
    if (!scope) return { result: { error: isPhoneVerified(ctx) ? 'No orders found for this customer.' : NO_CHAT_ORDERS } };
    const reference = args.reference ? String(args.reference) : undefined;
    const orders = await ctx.prisma.order.findMany({
        where: {
            tenantId: ctx.tenantId,
            ...scope,
            ...(reference ? { orderRef: reference } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: reference ? 1 : 3,
        select: {
            orderRef: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true, publicToken: true,
            items: { select: { quantity: true, product: { select: { name: true } } } },
        },
    });
    if (orders.length === 0) return { result: { error: 'No orders found for this customer.' } };
    return {
        result: {
            orders: orders.map((o) => ({
                reference: o.orderRef,
                status: o.status,
                payment: o.paymentStatus,
                total: money(ctx, o.totalAmount),
                placed: o.createdAt.toISOString(),
                items: o.items.map((i) => ({ name: i.product?.name, quantity: i.quantity })),
                ...(o.publicToken && config.frontendUrl ? { trackUrl: `${config.frontendUrl}/track/${o.publicToken}` } : {}),
            })),
        },
    };
}

async function getOrderPaymentLink(ctx: ShopToolContext, args: Record<string, unknown>): Promise<ToolOut> {
    const scope = await orderScope(ctx);
    if (!scope) return { result: { error: isPhoneVerified(ctx) ? 'No unpaid order found for this customer — nothing to pay for right now.' : NO_CHAT_ORDERS } };
    const reference = args.reference ? String(args.reference) : undefined;
    const order = await ctx.prisma.order.findFirst({
        where: {
            tenantId: ctx.tenantId,
            ...scope,
            paymentStatus: 'UNPAID',
            status: { not: 'CANCELLED' },
            ...(reference ? { orderRef: reference } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, orderRef: true, totalAmount: true, paymentAuthorizationUrl: true },
    });
    if (!order) return { result: { error: 'No unpaid order found for this customer — nothing to pay for right now.' } };

    const payUrl = order.paymentAuthorizationUrl ?? await payLinkFor(ctx, order);
    if (!payUrl) {
        return { result: { error: 'Payment link could not be generated; tell the customer the team will send it shortly.' } };
    }
    return { result: { reference: order.orderRef, amount: money(ctx, order.totalAmount), payUrl } };
}

/** Runs a shop tool, or returns null when `name` is not one. */
export async function runShopTool(ctx: ShopToolContext, name: string, args: Record<string, unknown>): Promise<ToolOut | null> {
    switch (name) {
        case 'list_products': return listProducts(ctx, args);
        case 'get_product': return getProduct(ctx, args);
        case 'create_order': return createOrder(ctx, args);
        case 'get_order_status': return getOrderStatus(ctx, args);
        case 'get_order_payment_link': return getOrderPaymentLink(ctx, args);
        default: return null;
    }
}

export interface ShopPromptInput {
    tenantName: string;
    channelLabel: string;
    currency: string;
    timezoneLabel: string;
    today: string;
    openingHours: string;
    hasPhone: boolean;
    isFirstTurn: boolean;
    isReturning: boolean;
    customerName: string | null;
}

/** System prompt for a shop. No appointment, slot or deposit language: none of that exists here. */
export function shopSystemPrompt(i: ShopPromptInput): string {
    const lines = [
        `You are the assistant for ${i.tenantName}, a shop, replying to customers on ${i.channelLabel}.`,
        '',
        'You can: tell customers what is in stock and the price, take orders, share the payment link, and check on an order.',
        '',
        `Opening hours: ${i.openingHours}.`,
        `Right now it is ${i.today} (${i.timezoneLabel}).`,
        '',
        'How to sound:',
        '- Like a friendly member of staff texting, not a bot and not a brochure.',
        '- One or two sentences. Contractions. At most one exclamation mark per message.',
        '- Match the customer\'s register: if they write "hi", stay casual; if formal, be formal.',
        '- Use the customer\'s name at most once per message, and not in every message.',
        '- One question at a time. No bullet lists, no markdown, no emoji unless they use them.',
        '',
        'Hard rules:',
        `- NEVER state a product, price or stock level that did not come from a tool result in this conversation. Call list_products (or get_product) first, and always say prices with the currency (${i.currency}).`,
        '- If something is out of stock, say so plainly and offer what is available.',
        '- Before create_order, confirm the exact items, quantities and the total back to the customer, and ask whether they want delivery (and where to) or will collect. Put that in deliveryAddress or notes.',
        ...(i.hasPhone
            ? []
            : [
                '- You do NOT have this customer\'s phone number. Before placing an order, ask for it in its own',
                '  message and save it with save_customer_phone. Say why plainly: it is where the payment link and',
                '  updates go. Ask once you know what they want, not as an opener.',
            ]),
        '- If you cannot help, call request_human rather than guessing.',
        '- Orders can only be looked up from the chat they were placed in. Never ask for a phone number in order to find',
        '  an order, and never share an order, tracking link or payment link a tool did not return.',
        '- Never mention tools, internal ids, or that you are an AI.',
        '',
        'Orders and payment:',
        '- When create_order returns a payUrl, in that SAME reply give the order reference, the items and the total',
        '  with the currency, and paste payUrl exactly as given. Say the order is confirmed once they pay.',
        '  Never say an order is "paid" or "confirmed" until get_order_status shows payment PAID.',
        '- Call create_order ONCE per order. If the customer then asks about paying, the link or their order, use',
        '  get_order_payment_link or get_order_status. Never place the same order again.',
        '- Never invent, guess, or alter a payment link. If a tool returns an error or no link, tell them the team',
        '  will send it shortly.',
    ];

    if (i.isFirstTurn) {
        lines.push(
            '',
            'THIS IS THE FIRST MESSAGE OF THE CONVERSATION. Your reply must:',
            i.isReturning && i.customerName
                ? `1. Open with a warm welcome back that names the shop and the customer, e.g. "Welcome back to ${i.tenantName}, ${i.customerName}!"`
                : `1. Open with "Welcome to ${i.tenantName}!"`,
            '2. Say in one clause what you can help with (browsing products, placing an order, checking an order).',
            '3. Ask how you can help. Keep the whole thing to two sentences.',
            'If you can see you have ALREADY welcomed them in this conversation, skip the welcome and just answer.',
        );
    }
    return lines.join('\n');
}
