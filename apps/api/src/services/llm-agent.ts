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

/** Small and cheap: this is short-turn chat, not reasoning over documents. */
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

/** How much back-and-forth to replay. Enough for context, capped for cost. */
const HISTORY_TURNS = 12;

/** A runaway tool loop would burn tokens and stall the customer. */
const MAX_TOOL_ROUNDS = 4;

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
                    availableTimes: slots.map((s) => (s as { time?: string }).time ?? String(s)).slice(0, 20),
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
            const free = slots.some((s) => ((s as { time?: string }).time ?? String(s)) === time);
            if (!free) {
                return { result: { error: 'That slot is no longer free. Call check_availability again.' } };
            }

            const end = new Date(start.getTime() + service.durationMinutes * 60_000);
            const reference = `BK${Date.now().toString(36).toUpperCase()}`;

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
                    status: service.depositAmount ? 'PENDING_PAYMENT' : 'CONFIRMED',
                },
                select: { bookingReference: true, startTime: true, status: true },
            });

            return {
                result: {
                    reference: booking.bookingReference,
                    service: service.name,
                    when: booking.startTime.toISOString(),
                    status: booking.status,
                    depositRequired: service.depositAmount ? String(service.depositAmount) : null,
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

function systemPrompt(ctx: AgentContext, memory: string): string {
    const base = [
        `You are the assistant for ${ctx.tenantName}, replying on WhatsApp.`,
        '',
        'How to write:',
        '- Short. One or two sentences, like a person texting. No bullet lists, no markdown.',
        '- Warm and direct. Never corporate.',
        '- One question at a time.',
        '',
        'Hard rules:',
        '- NEVER state a price, service or available time you did not get from a tool.',
        '- Call check_availability before offering any time. If unsure, check again.',
        '- Confirm the exact service, date and time back to the customer before create_booking.',
        '- If you cannot help, call request_human rather than guessing.',
        '- Never mention tools, internal ids, or that you are an AI model.',
    ];

    if (memory) {
        base.push(
            '',
            'What you already know about this customer (use it naturally — greet them by name,',
            'refer to what they usually book — but never recite it back as a list, and never',
            'mention missed appointments unless they raise it first):',
            memory,
        );
    } else {
        base.push('', 'This is a new customer. You know nothing about them yet — ask their name when it matters.');
    }

    return base.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAgent(ctx: AgentContext, incoming: string): Promise<AgentResult> {
    const [memory, history] = await Promise.all([
        buildCustomerMemory(ctx.prisma, ctx.tenantId, ctx.customerPhone),
        ctx.prisma.message.findMany({
            where: { conversationId: ctx.conversationId },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_TURNS,
            select: { direction: true, content: true },
        }),
    ]);

    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt(ctx, memory.summary) },
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
