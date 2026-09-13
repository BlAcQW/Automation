/**
 * Everything the assistant knows about a customer before it says a word.
 *
 * This is deliberately NOT retrieval-augmented. A booking business's
 * personalisation comes from facts it already stores exactly — what you booked,
 * when you last came, who you usually see — and those are a database query, not
 * a similarity search. Embeddings would make exact facts fuzzy and add a sync
 * job for no gain.
 *
 * Vector retrieval earns its place later, over content that genuinely outgrows
 * the prompt: a tenant's policy documents, long FAQ pages, or months of chat
 * history. `futurefeature.md` tracks that.
 */

import type { ExtendedPrismaClient } from '../plugins/prisma.js';

export interface CustomerMemory {
    /** Rendered block injected into the system prompt. Empty for a stranger. */
    summary: string;
    isReturning: boolean;
}

/** Cap the history we pass so a chatty customer can't blow the context window. */
const RECENT_BOOKINGS = 5;

function formatDate(d: Date): string {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysSince(d: Date): number {
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/**
 * Build the memory block for one customer of one tenant.
 *
 * Returns plain prose rather than JSON: models follow natural-language context
 * more reliably than nested objects, and it keeps the token cost low.
 */
export async function buildCustomerMemory(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    customerPhone: string,
): Promise<CustomerMemory> {
    const [bookings, orders, conversation] = await Promise.all([
        prisma.booking.findMany({
            where: { tenantId, customerPhone },
            orderBy: { startTime: 'desc' },
            take: RECENT_BOOKINGS,
            select: {
                bookingReference: true,
                startTime: true,
                status: true,
                paymentStatus: true,
                customerName: true,
                service: { select: { name: true } },
            },
        }),
        prisma.order.findMany({
            where: { tenantId, customerPhone },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { orderRef: true, createdAt: true, status: true, totalAmount: true },
        }),
        prisma.conversation.findFirst({
            where: { tenantId, customerPhone },
            select: { customerName: true, createdAt: true },
        }),
    ]);

    if (bookings.length === 0 && orders.length === 0 && !conversation) {
        return { summary: '', isReturning: false };
    }

    const name = bookings[0]?.customerName || conversation?.customerName || null;
    const lines: string[] = [];

    if (name) lines.push(`Name: ${name}.`);

    if (bookings.length > 0) {
        const past = bookings.filter((b) => b.startTime < new Date());
        const upcoming = bookings.filter((b) => b.startTime >= new Date());

        if (upcoming.length > 0) {
            const next = upcoming[upcoming.length - 1];
            lines.push(
                `Has an UPCOMING booking: ${next.service?.name ?? 'appointment'} on ` +
                `${formatDate(next.startTime)} (ref ${next.bookingReference}, ${next.status.toLowerCase()}` +
                `${next.paymentStatus === 'UNPAID' ? ', not yet paid' : ''}).`,
            );
        }

        if (past.length > 0) {
            const last = past[0];
            lines.push(
                `Last visit: ${last.service?.name ?? 'appointment'} on ${formatDate(last.startTime)} ` +
                `(${daysSince(last.startTime)} days ago).`,
            );

            // A repeatedly-booked service is the single most useful fact for
            // sounding like you know them — suggest it rather than re-asking.
            const counts = new Map<string, number>();
            for (const b of past) {
                const n = b.service?.name;
                if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
            }
            const favourite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            if (favourite && favourite[1] > 1) {
                lines.push(`Usually books: ${favourite[0]} (${favourite[1]} times).`);
            }

            lines.push(`Total past bookings: ${past.length}.`);

            const noShows = past.filter((b) => b.status === 'NO_SHOW').length;
            if (noShows > 0) {
                // Stated as a fact, not an instruction — the prompt decides what
                // to do with it, and the assistant must never shame a customer.
                lines.push(`Has missed ${noShows} appointment(s) previously.`);
            }
        }
    }

    if (orders.length > 0) {
        const last = orders[0];
        lines.push(
            `Last order: ${last.orderRef} on ${formatDate(last.createdAt)} ` +
            `(${last.status.toLowerCase()}). ${orders.length} recent order(s).`,
        );
    }

    if (lines.length === 0) return { summary: '', isReturning: false };

    return {
        summary: lines.join('\n'),
        isReturning: bookings.length > 0 || orders.length > 0,
    };
}
