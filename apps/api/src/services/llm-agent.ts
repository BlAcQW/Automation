/**
 * Conversational layer for the WhatsApp assistant.
 *
 * The model handles understanding and tone. It does NOT hold business rules:
 * availability, booking creation, cancellation and payment all run through the
 * same services the menu bot uses, exposed here as tools. That split is the
 * whole design — a model that invents a free slot or a payment link is worse
 * than a rigid menu, so anything with a consequence stays in code the model can
 * only call, never improvise.
 *
 * If OPENAI_API_KEY is unset, `isLlmEnabled()` is false and callers fall back to
 * the existing state machine. That is the rollout switch.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { computeAvailableSlots } from './availability.js';
import { buildCustomerMemory } from './customer-memory.js';
import { safeZone, startOfDayInZone, zonedTimeToUtc } from './timezone.js';
import { createPaymentLink } from './payment-link.js';

/** Small and cheap: this is short-turn chat, not reasoning over documents. */
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

/** How much back-and-forth to replay. Enough for context, capped for cost. */
const HISTORY_TURNS = 12;

/** A runaway tool loop would burn tokens and stall the customer. */
const MAX_TOOL_ROUNDS = 4;

/** Silence longer than this starts a new session — and a fresh welcome. */
const SESSION_GAP_MS = 8 * 60 * 60 * 1000;

let client: OpenAI | null = null;

export function isLlmEnabled(): boolean {
    return !!process.env.OPENAI_API_KEY;
}

function getClient(): OpenAI {
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}

export interface AgentContext {
    prisma: ExtendedPrismaClient;
    tenantId: string;
    tenantName: string;
    /** IANA zone. Times the customer says are wall-clock in THIS zone. */
    timezone: string;
    /** ISO 4217 code shown next to every price, e.g. GHS. */
    currency: string;
    /** Tenant.paystackSecretKey as stored (encrypted); null if not connected. */
    paystackSecretKeyEncrypted: string | null;
    businessType: 'SERVICE' | 'PRODUCT';
    conversationId: string;
    customerPhone: string;
}

export interface AgentResult {
    /** Plain text to send back. Empty means the model chose to stay silent. */
    reply: string;
    /** Tools actually executed — useful for logging and for tests. */
    toolsUsed: string[];
    /** True when the model asked for a human. */
    wantsHuman: boolean;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'list_services',
            description:
                'List the services this business offers, with price and duration. ' +
                'Call this before discussing what is available or quoting a price — never guess.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_availability',
            description:
                'Get the genuinely free start times for a service on a date. ' +
                'ALWAYS call this before offering any time. Never invent or assume availability.',
            parameters: {
                type: 'object',
                properties: {
                    serviceId: { type: 'string', description: 'id from list_services' },
                    date: { type: 'string', description: 'ISO date, YYYY-MM-DD' },
                },
                required: ['serviceId', 'date'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_my_bookings',
            description: "List this customer's upcoming and recent bookings.",
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_payment_link',
            description:
                'Get the deposit payment link for the customer\'s booking that still needs paying. ' +
                'Call this ONLY when the customer has chosen to pay now, or asks how/where to pay. ' +
                'Omit reference to use their most recent unpaid booking. Returns a link to send them as-is.',
            parameters: {
                type: 'object',
                properties: {
                    reference: { type: 'string', description: 'optional booking reference (e.g. BK...)' },
                },
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_booking',
            description:
                'Book a slot. Only call after check_availability has confirmed the exact time is free ' +
                'and the customer has explicitly agreed to it.',
            parameters: {
                type: 'object',
                properties: {
                    serviceId: { type: 'string' },
                    date: { type: 'string', description: 'ISO date, YYYY-MM-DD' },
                    time: { type: 'string', description: '24-hour HH:MM, must be one returned by check_availability' },
                    customerName: { type: 'string' },
                },
                required: ['serviceId', 'date', 'time', 'customerName'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'request_human',
            description:
                'Hand the conversation to a member of staff. Use when the customer asks for a person, ' +
                'is upset, or wants something outside booking and product questions.',
            parameters: {
                type: 'object',
                properties: { reason: { type: 'string' } },
                required: ['reason'],
                additionalProperties: false,
            },
        },
    },
];

async function runTool(
    ctx: AgentContext,
    name: string,
    args: Record<string, unknown>,
): Promise<{ result: unknown; wantsHuman?: boolean }> {
    switch (name) {
        case 'list_services': {
            const services = await ctx.prisma.service.findMany({
                where: { tenantId: ctx.tenantId, isActive: true },
                select: { id: true, name: true, description: true, price: true, durationMinutes: true, depositAmount: true },
            });
            return {
                result: services.map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    price: String(s.price),
                    durationMinutes: s.durationMinutes,
                    depositRequired: s.depositAmount ? String(s.depositAmount) : null,
                })),
            };
        }

        case 'check_availability': {
            const serviceId = String(args.serviceId ?? '');
            const dateStr = String(args.date ?? '');
            const date = startOfDayInZone(dateStr, safeZone(ctx.timezone));
            if (!date) {
                return { result: { error: 'Invalid date. Use YYYY-MM-DD.' } };
            }

            const service = await ctx.prisma.service.findFirst({
                where: { id: serviceId, tenantId: ctx.tenantId },
                select: { durationMinutes: true },
            });
            if (!service) return { result: { error: 'Unknown serviceId — call list_services first.' } };

            // Same computation the REST endpoint and the menu bot use, so the
            // model cannot see availability the rest of the system disagrees with.
            const { slots, isBlackout, notWorking } = await computeAvailableSlots({
                prisma: ctx.prisma,
                tenantId: ctx.tenantId,
                date,
                durationMinutes: service.durationMinutes,
                serviceId,
            });

            if (isBlackout) return { result: { closed: true, reason: 'The business is closed that day.' } };
            if (notWorking) return { result: { closed: true, reason: 'Not a working day.' } };

            return {
                result: {
                    date: dateStr,
                    // AvailableSlot carries the wall-clock as `startTime` ("HH:MM").
                    availableTimes: slots.map((s) => s.startTime).slice(0, 20),
                },
            };
        }

        case 'get_my_bookings': {
            const bookings = await ctx.prisma.booking.findMany({
                where: { tenantId: ctx.tenantId, customerPhone: ctx.customerPhone },
                orderBy: { startTime: 'desc' },
                take: 5,
                select: {
                    bookingReference: true,
                    startTime: true,
                    status: true,
                    paymentStatus: true,
                    service: { select: { name: true } },
                },
            });
            return {
                result: bookings.map((b) => ({
                    reference: b.bookingReference,
                    service: b.service?.name,
                    when: b.startTime.toISOString(),
                    status: b.status,
                    payment: b.paymentStatus,
                })),
            };
        }

        case 'get_payment_link': {
            const reference = args.reference ? String(args.reference) : undefined;
            const booking = await ctx.prisma.booking.findFirst({
                where: {
                    tenantId: ctx.tenantId,
                    customerPhone: ctx.customerPhone,
                    paymentStatus: 'UNPAID',
                    ...(reference ? { bookingReference: reference } : {}),
                },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    bookingReference: true,
                    depositAmount: true,
                    paymentAuthorizationUrl: true,
                    service: { select: { name: true } },
                },
            });

            if (!booking) {
                return { result: { error: 'No unpaid booking found for this customer — nothing to pay for right now.' } };
            }

            const amount = booking.depositAmount ? Number(booking.depositAmount) : 0;
            if (amount <= 0) {
                return {
                    result: {
                        reference: booking.bookingReference,
                        note: 'This booking has no deposit due online. Let them know they can settle any balance when they arrive.',
                    },
                };
            }

            // Reuse an existing link if one was already generated; only hit
            // Paystack when there is nothing to reuse.
            let payUrl = booking.paymentAuthorizationUrl;
            if (!payUrl) {
                payUrl = await createPaymentLink({
                    prisma: ctx.prisma,
                    tenantId: ctx.tenantId,
                    paystackSecretKeyEncrypted: ctx.paystackSecretKeyEncrypted,
                    currency: ctx.currency,
                    entity: 'booking',
                    id: booking.id,
                    amount,
                    customerPhone: ctx.customerPhone,
                });
            }

            if (!payUrl) {
                return {
                    result: {
                        error: 'Payment link could not be generated; tell the customer the team will send it shortly.',
                    },
                };
            }

            return {
                result: {
                    reference: booking.bookingReference,
                    service: booking.service?.name,
                    amount: `${ctx.currency} ${amount.toFixed(2)}`,
                    payUrl,
                },
            };
        }

        case 'create_booking': {
            const serviceId = String(args.serviceId ?? '');
            const dateStr = String(args.date ?? '');
            const time = String(args.time ?? '');
            const customerName = String(args.customerName ?? '').trim();

            const service = await ctx.prisma.service.findFirst({
                where: { id: serviceId, tenantId: ctx.tenantId, isActive: true },
                select: { id: true, name: true, durationMinutes: true, depositAmount: true },
            });
            if (!service) return { result: { error: 'Unknown service.' } };

            // Wall-clock in the tenant's zone, not the server's.
            const start = zonedTimeToUtc(dateStr, time, safeZone(ctx.timezone));
            if (!start) return { result: { error: 'Invalid date or time.' } };
            if (start.getTime() < Date.now()) return { result: { error: 'That time is in the past.' } };

            // Re-check availability at write time. The model may have been told
            // a slot was free several turns ago; someone else may have taken it.
            const { slots } = await computeAvailableSlots({
                prisma: ctx.prisma,
                tenantId: ctx.tenantId,
                date: startOfDayInZone(dateStr, safeZone(ctx.timezone))!,
                durationMinutes: service.durationMinutes,
                serviceId,
            });
            const free = slots.some((s) => s.startTime === time);
            if (!free) {
                return { result: { error: 'That slot is no longer free. Call check_availability again.' } };
            }

            const end = new Date(start.getTime() + service.durationMinutes * 60_000);
            const reference = `BK${Date.now().toString(36).toUpperCase()}`;

            const depositAmount = service.depositAmount ? Number(service.depositAmount) : 0;
            const requiresDeposit = depositAmount > 0;

            const booking = await ctx.prisma.booking.create({
                data: {
                    tenantId: ctx.tenantId,
                    serviceId: service.id,
                    customerName: customerName || 'Customer',
                    customerPhone: ctx.customerPhone,
                    startTime: start,
                    endTime: end,
                    bookingReference: reference,
                    // A deposit-bearing service is held, not confirmed, until paid —
                    // same rule the menu bot applies.
                    status: requiresDeposit ? 'PENDING_PAYMENT' : 'CONFIRMED',
                    depositAmount: requiresDeposit ? service.depositAmount : null,
                },
                select: { id: true, bookingReference: true, startTime: true, status: true },
            });

            // Don't generate a payment link yet. Deposit-bearing bookings offer
            // the customer a choice — pay the deposit now, or on arrival — so the
            // link is created lazily by get_payment_link only if they pick "now".
            return {
                result: {
                    reference: booking.bookingReference,
                    service: service.name,
                    when: booking.startTime.toISOString(),
                    status: booking.status,
                    depositRequired: requiresDeposit ? `${ctx.currency} ${depositAmount.toFixed(2)}` : null,
                    ...(requiresDeposit
                        ? {
                              askPayNowOrOnArrival: true,
                              note: 'Ask the customer whether they want to pay this deposit now to lock the slot in, or pay when they arrive. Only call get_payment_link if they choose to pay now.',
                          }
                        : {}),
                },
            };
        }

        case 'request_human':
            return { result: { ok: true }, wantsHuman: true };

        default:
            return { result: { error: `Unknown tool ${name}` } };
    }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

interface PromptInput {
    memory: string;
    isReturning: boolean;
    customerName: string | null;
    /** True at the top of a session — the welcome turn. */
    isFirstTurn: boolean;
    /** "Mon–Fri 09:00–17:00, Sat–Sun 10:00–16:00" — or a note that none are set. */
    openingHours: string;
    /** "Tuesday 16 September 2026, 14:05" in the tenant's zone. */
    today: string;
    services: Array<{ id: string; name: string; price: string; durationMinutes: number }>;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Collapse consecutive days with identical hours: "Mon–Fri 09:00–17:00". */
function formatHours(rows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>): string {
    if (rows.length === 0) return 'not set — do not guess; offer to check with staff';
    const byDay = new Map(rows.map((r) => [r.dayOfWeek, `${r.startTime}–${r.endTime}`]));
    const parts: string[] = [];
    // Walk Mon..Sun so the natural week reads left to right.
    const order = [1, 2, 3, 4, 5, 6, 0];
    let i = 0;
    while (i < order.length) {
        const span = byDay.get(order[i]);
        if (!span) { i += 1; continue; }
        let j = i;
        while (j + 1 < order.length && byDay.get(order[j + 1]) === span) j += 1;
        parts.push(`${DAY[order[i]]}${j > i ? '–' + DAY[order[j]] : ''} ${span}`);
        i = j + 1;
    }
    const closed = order.filter((d) => !byDay.has(d)).map((d) => DAY[d]);
    return parts.join(', ') + (closed.length ? `; closed ${closed.join(', ')}` : '');
}

function todayInZone(timeZone: string): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());
}

function systemPrompt(ctx: AgentContext, input: PromptInput): string {
    const kind = ctx.businessType === 'PRODUCT' ? 'shop' : 'business';

    const serviceLines = input.services.length
        ? input.services.map((s) => `- ${s.name} — ${ctx.currency} ${s.price} (${s.durationMinutes} min) [id: ${s.id}]`)
        : ['- (no services configured yet)'];

    const base = [
        `You are the assistant for ${ctx.tenantName}, a ${kind}, replying to customers on WhatsApp.`,
        '',
        `What ${ctx.tenantName} offers (this is the complete list — nothing else exists):`,
        ...serviceLines,
        '',
        `Opening hours: ${input.openingHours}.`,
        `Right now it is ${input.today} (${safeZone(ctx.timezone)}). Resolve "today", "tomorrow" and`,
        'weekday names from this, then pass ISO dates (YYYY-MM-DD) to tools.',
        '',
        'How to sound:',
        '- Like a friendly member of staff texting, not a bot and not a brochure.',
        '- One or two sentences. Contractions. At most one exclamation mark per message.',
        '- Match the customer\'s register: if they write "hi", stay casual; if formal, be formal.',
        '- Use the customer\'s name at most once per message, and not in every message.',
        '- One question at a time. No bullet lists, no markdown, no emoji unless they use them.',
        '',
        'Hard rules:',
        `- NEVER state a price, service or time that is not in the list above or a tool result. Always say prices with the currency (${ctx.currency}).`,
        '- Call check_availability before offering any time. If unsure, check again.',
        '- Confirm the exact service, date and time back to the customer before create_booking.',
        '- If you cannot help, call request_human rather than guessing.',
        '- Never mention tools, internal ids, or that you are an AI.',
        '',
        'Payment (deposits):',
        '- Some services need a deposit. When create_booking returns askPayNowOrOnArrival, the slot is',
        '  booked but the deposit is still due. In your NEXT message, confirm the booking and ask, in one',
        '  friendly question, whether they would like to pay the deposit now to lock it in, or pay when',
        '  they arrive. State the deposit amount with the currency. Do not send any link yet.',
        '- Only when the customer chooses to pay now — or later asks how/where to pay — call',
        '  get_payment_link and send the returned link exactly as given, with the amount.',
        '- If they choose to pay on arrival, confirm warmly that the slot is held and the deposit can be',
        '  settled when they come. Do not send a link.',
        '- Never invent, guess, or alter a payment link. If get_payment_link returns an error, tell them',
        '  the team will send the link shortly.',
    ];

    if (input.isFirstTurn) {
        const offer = input.services.slice(0, 4).map((s) => s.name).join(', ');
        base.push(
            '',
            'THIS IS THE FIRST MESSAGE OF THE CONVERSATION. Your reply must:',
            input.isReturning && input.customerName
                ? `1. Open with a warm welcome back that names the business and the customer, e.g. "Welcome back to ${ctx.tenantName}, ${input.customerName}!"`
                : `1. Open with "Welcome to ${ctx.tenantName}!"`,
            input.isReturning
                ? '2. Nod to what they usually book, if known, and ask if it\'s the same today.'
                : `2. Say in one clause what you can help with (e.g. ${offer || 'bookings'}).`,
            '3. Ask how you can help. Keep the whole thing to two sentences.',
            'If you can see you have ALREADY welcomed them in this conversation, skip the welcome and just answer.',
        );
    }

    if (input.memory) {
        base.push(
            '',
            'What you already know about this customer — use it naturally, never recite it as a',
            'list, and never mention missed appointments unless they raise it first:',
            input.memory,
        );
    } else {
        base.push('', 'This is a new customer. Ask their name only when it matters (e.g. to book).');
    }

    return base.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAgent(ctx: AgentContext, incoming: string): Promise<AgentResult> {
    const [memory, history, services, hours] = await Promise.all([
        buildCustomerMemory(ctx.prisma, ctx.tenantId, ctx.customerPhone),
        ctx.prisma.message.findMany({
            where: { conversationId: ctx.conversationId },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_TURNS,
            select: { direction: true, content: true, createdAt: true },
        }),
        ctx.prisma.service.findMany({
            where: { tenantId: ctx.tenantId, isActive: true },
            select: { id: true, name: true, price: true, durationMinutes: true },
        }),
        ctx.prisma.workingHours.findMany({
            where: { tenantId: ctx.tenantId, isActive: true },
            orderBy: { dayOfWeek: 'asc' },
            select: { dayOfWeek: true, startTime: true, endTime: true },
        }),
    ]);

    // A customer has ONE conversation per business for life, so "no reply yet"
    // would only ever be true for their first message ever — a regular coming
    // back after a fortnight would never be welcomed. Treat a gap since the
    // last message as a new session instead, and greet at the top of each one.
    // The webhook stores the customer's message before we run, so the newest
    // row is always "now" — measure the gap from the last time WE replied.
    const lastReply = history.find((m) => m.direction === 'OUTBOUND');
    const isFirstTurn = !lastReply || Date.now() - lastReply.createdAt.getTime() > SESSION_GAP_MS;
    const customerName = memory.summary.match(/^Name: (.+?)\.$/m)?.[1] ?? null;

    const messages: ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: systemPrompt(ctx, {
                memory: memory.summary,
                isReturning: memory.isReturning,
                customerName,
                isFirstTurn,
                openingHours: formatHours(hours),
                today: todayInZone(safeZone(ctx.timezone)),
                services: services.map((s) => ({
                    id: s.id,
                    name: s.name,
                    price: String(s.price),
                    durationMinutes: s.durationMinutes,
                })),
            }),
        },
        // findMany came back newest-first; the model needs chronological order.
        ...history
            .reverse()
            .map((m) => ({
                role: m.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
                content: m.content,
            })),
        { role: 'user', content: incoming },
    ];

    const toolsUsed: string[] = [];
    let wantsHuman = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const completion = await getClient().chat.completions.create({
            model: MODEL,
            messages,
            tools: TOOLS,
            temperature: 0.6,
            max_tokens: 300,
        });

        const choice = completion.choices[0]?.message;
        if (!choice) return { reply: '', toolsUsed, wantsHuman };

        const calls = choice.tool_calls ?? [];
        if (calls.length === 0) {
            return { reply: (choice.content ?? '').trim(), toolsUsed, wantsHuman };
        }

        messages.push(choice);

        for (const call of calls) {
            if (call.type !== 'function') continue;
            let parsed: Record<string, unknown> = {};
            try {
                parsed = JSON.parse(call.function.arguments || '{}');
            } catch {
                // Malformed arguments are the model's error to recover from —
                // hand the failure back rather than throwing away the turn.
            }

            toolsUsed.push(call.function.name);
            const { result, wantsHuman: human } = await runTool(ctx, call.function.name, parsed);
            if (human) wantsHuman = true;

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            });
        }
    }

    // Ran out of rounds with the model still calling tools — better to hand off
    // than to leave the customer waiting on a loop.
    return {
        reply: '',
        toolsUsed,
        wantsHuman: true,
    };
}
