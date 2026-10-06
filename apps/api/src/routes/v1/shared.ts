/**
 * Shared pieces of the public API v1: the error type and handler (one envelope
 * for every failure), cursor pagination, serializers, and request validators.
 *
 * ENVELOPE  success: { data } or { data: [...], pagination: { nextCursor, hasMore } }
 *           failure: { error: { code, message } }   (+ details on validation errors)
 *
 * SERIALIZERS are allow-lists. Rows carry bot state, assignment, provider ids
 * and tenant ids that an external app has no business seeing, so nothing is
 * returned by spreading a row.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { publishEvent } from '../../services/events/publish.js';
import { scoped } from '../../lib/logger.js';

const log = scoped('api-v1');

export class ApiError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

/**
 * Applied to every v1 route. The global per-IP limiter would run first and set
 * the once-per-request flag that stops the per-key limiter in
 * authenticateApiKey, so v1 opts out and relies on the key + failure limiters.
 */
export const V1_ROUTE_CONFIG = { rateLimit: false } as const;

const STATUS_CODES: Record<number, string> = {
    400: 'bad_request',
    401: 'unauthorized',
    402: 'payment_required',
    403: 'forbidden',
    404: 'not_found',
    405: 'method_not_allowed',
    409: 'conflict',
    413: 'payload_too_large',
    415: 'unsupported_media_type',
    422: 'unprocessable',
    429: 'rate_limited',
};

export function sendError(reply: FastifyReply, status: number, code: string, message: string, extra: object = {}) {
    return reply.status(status).send({ error: { code, message, ...extra } });
}

export function installV1ErrorHandling(fastify: FastifyInstance): void {
    fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
        if (error instanceof ZodError) {
            const details = error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
            return sendError(reply, 400, 'validation_error', details.map((d) => `${d.field}: ${d.message}`).join('; '), { details });
        }
        if (error instanceof ApiError) {
            return sendError(reply, error.statusCode, error.code, error.message);
        }

        const prismaCode = (error as { code?: string }).code;
        if (prismaCode === 'P2002') return sendError(reply, 409, 'conflict', 'That already exists.');
        if (prismaCode === 'P2025') return sendError(reply, 404, 'not_found', 'Not found.');

        const status = error.statusCode ?? 500;
        if (status >= 400 && status < 500) {
            return sendError(reply, status, STATUS_CODES[status] ?? 'error', error.message);
        }

        // Anything else: log everything here, tell the client nothing.
        request.log.error({ err: error, url: request.url }, 'v1 request failed');
        return sendError(reply, 500, 'internal_error', 'Something went wrong on our side.', { requestId: request.id });
    });

    fastify.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'not_found', 'No such endpoint.'));
}

// ---------------------------------------------------------------------------
// Validation

/** Strict E.164: +, non-zero first digit, 8-15 digits, no separators. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const e164 = z.string().regex(E164_PATTERN, 'Must be E.164, e.g. +233241234567');

/** Ids are cuids (or similar): short, URL-safe. Bounded so junk never reaches the DB. */
export const idParam = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid id');

export const MAX_ATTRIBUTES_BYTES = 4096;
export const attributesSchema = z
    .record(z.string(), z.unknown())
    .refine((v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_ATTRIBUTES_BYTES, `attributes must be at most ${MAX_ATTRIBUTES_BYTES} bytes of JSON`);

// ---------------------------------------------------------------------------
// Cursor pagination

const CURSOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeCursor(id: string): string {
    return Buffer.from(id, 'utf8').toString('base64url');
}

const cursorSchema = z
    .string()
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid cursor')
    .transform((raw, ctx) => {
        const id = Buffer.from(raw, 'base64url').toString('utf8');
        if (!CURSOR_ID.test(id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid cursor' });
            return z.NEVER;
        }
        return id;
    });

export const paginationQuery = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: cursorSchema.optional(),
});

/** Prisma args for "page after cursor, one extra row to detect more". */
export function pageArgs(q: { limit: number; cursor?: string }) {
    return {
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    };
}

export function toPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; pagination: { nextCursor: string | null; hasMore: boolean } } {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
        items,
        pagination: { nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null, hasMore },
    };
}

// ---------------------------------------------------------------------------
// Serializers (allow-lists)

/** Customer-service window: free-form messages are only deliverable for 24h after the customer's last message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowOpen(lastInboundAt: Date | null | undefined, now = Date.now()): boolean {
    return !!lastInboundAt && now - lastInboundAt.getTime() < WINDOW_MS;
}

export function serializeConversation(c: any) {
    return {
        id: c.id,
        channel: c.channel,
        customerPhone: c.customerPhone ?? null,
        customerName: c.customerName ?? null,
        customerHandle: c.customerHandle ?? null,
        customerId: c.customerId ?? null,
        state: c.state,
        lastInboundAt: c.lastInboundAt ?? null,
        windowOpen: windowOpen(c.lastInboundAt),
        windowClosesAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS) : null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

export function serializeMessage(m: any) {
    return {
        id: m.id,
        conversationId: m.conversationId,
        direction: m.direction,
        content: m.content,
        messageType: m.messageType,
        status: m.status ?? null,
        source: (m.metadata as { source?: string } | null)?.source ?? null,
        createdAt: m.createdAt,
    };
}

export function serializeCustomer(c: any) {
    return {
        id: c.id,
        phone: c.phone,
        name: c.name ?? null,
        email: c.email ?? null,
        attributes: c.attributes ?? null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
}

// ---------------------------------------------------------------------------

/**
 * Events are a side effect of a change that already committed: a failed publish
 * must not turn a successful API call into an error (the caller would retry and
 * repeat the change), so it is logged and swallowed.
 */
export async function publishBestEffort(
    prisma: unknown,
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        await publishEvent(prisma, { tenantId, type, payload: { v: 1, ...payload } });
    } catch (err) {
        log.warn({ err, type, tenantId }, 'event publish failed after a successful API change');
    }
}

export function requireApiKey(request: FastifyRequest): { tenantId: string; prefix: string } {
    if (!request.apiKey) throw new ApiError(401, 'unauthorized', 'Invalid or missing API key');
    return request.apiKey;
}
