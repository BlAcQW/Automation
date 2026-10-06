/**
 * Pure purpose-classification helpers for the notification worker.
 * No Redis/Prisma imports so they can be unit-tested in isolation.
 */

import type { TemplatePurpose } from '@prisma/client';

/**
 * Purposes sent outside the WhatsApp 24h window — gated by the tenant's
 * outOfWindowMessagesEnabled toggle.
 *
 * A NEW out-of-window purpose MUST be added here, otherwise it silently
 * bypasses the toggle and is sent even when the tenant has switched
 * out-of-window messages off. Every TemplatePurpose must appear in exactly one
 * of this set or IN_WINDOW_PURPOSES (enforced by notification-worker.test.ts).
 */
export const OUT_OF_WINDOW_PURPOSES: ReadonlySet<TemplatePurpose> = new Set([
    'BOOKING_REMINDER',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
] as TemplatePurpose[]);

/** Purposes sent as an immediate reaction to a customer action (in-window). */
export const IN_WINDOW_PURPOSES: ReadonlySet<TemplatePurpose> = new Set([
    'BOOKING_CONFIRMATION',
    'BOOKING_CANCELLED',
    'BOOKING_RESCHEDULED',
    'ORDER_CONFIRMATION',
] as TemplatePurpose[]);

const ORDER_PURPOSES: ReadonlySet<string> = new Set([
    'ORDER_CONFIRMATION',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
]);

const BOOKING_PURPOSES: ReadonlySet<string> = new Set([
    'BOOKING_CONFIRMATION',
    'BOOKING_REMINDER',
    'BOOKING_CANCELLED',
    'BOOKING_RESCHEDULED',
]);

/**
 * Which source entity a purpose's customer contact details live on.
 * Returns null for a purpose we do not know how to look up, so callers can
 * surface it loudly instead of guessing.
 */
export function purposeEntity(purpose: TemplatePurpose): 'order' | 'booking' | null {
    if (ORDER_PURPOSES.has(purpose)) return 'order';
    if (BOOKING_PURPOSES.has(purpose)) return 'booking';
    return null;
}

// ---------------------------------------------------------------------------
// Generic reminders
// ---------------------------------------------------------------------------

/** What a reminder is about, once the legacy bookingId-only shape is upgraded. */
export interface NormalizedReminderJob {
    purpose: TemplatePurpose;
    tenantId: string;
    entityType: string;
    entityId: string;
    customerId: string | null;
    customerPhone: string;
    variables: string[];
    /** Set for booking reminders; used to build the cancel link. */
    bookingId?: string;
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Read a queued reminder in either shape. Jobs queued before reminders became
 * entity-generic carry only `bookingId`; they are treated as booking
 * reminders. Returns null when the payload names no entity, so the worker can
 * drop it loudly instead of guessing.
 */
export function normalizeReminderJob(raw: unknown): NormalizedReminderJob | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (!nonEmpty(r.tenantId) || !nonEmpty(r.purpose) || !nonEmpty(r.customerPhone)) return null;

    let entityType: string;
    let entityId: string;
    if (nonEmpty(r.entityType) && nonEmpty(r.entityId)) {
        entityType = r.entityType;
        entityId = r.entityId;
    } else if (r.entityType === undefined && r.entityId === undefined && nonEmpty(r.bookingId)) {
        entityType = 'booking';
        entityId = r.bookingId;
    } else {
        return null;
    }

    return {
        purpose: r.purpose as TemplatePurpose,
        tenantId: r.tenantId,
        entityType,
        entityId,
        customerId: nonEmpty(r.customerId) ? r.customerId : null,
        customerPhone: r.customerPhone,
        variables: Array.isArray(r.variables) ? r.variables.map(String) : [],
        ...(entityType === 'booking' ? { bookingId: entityId } : {}),
    };
}

/**
 * "Is this entity still in a state where its reminder applies?" for one entity
 * type. Must be tenant-scoped, and return false (not throw) for a missing row.
 * It may throw on infrastructure errors: the worker then retries.
 */
export type ReminderEntityCheck = (
    db: any,
    ref: { tenantId: string; entityId: string },
) => Promise<boolean>;

const ENTITY_KEY_RE = /^[a-z][a-z0-9_]*$/;

const reminderEntities = new Map<string, ReminderEntityCheck>([
    [
        'booking',
        async (db, { tenantId, entityId }) => {
            const booking = await db.booking.findFirst({
                where: { id: entityId, tenantId },
                select: { status: true },
            });
            return booking?.status === 'CONFIRMED';
        },
    ],
]);

/** Let a pack declare when its own entity's reminders still apply. */
export function registerReminderEntity(entityType: string, check: ReminderEntityCheck): void {
    if (!ENTITY_KEY_RE.test(entityType)) {
        throw new Error(`registerReminderEntity: invalid entity type "${entityType}"`);
    }
    if (entityType === 'booking') {
        throw new Error('registerReminderEntity: "booking" is built in and cannot be replaced');
    }
    reminderEntities.set(entityType, check);
}

export function isReminderEntityRegistered(entityType: string): boolean {
    return reminderEntities.has(entityType);
}

/**
 * - 'applies'         : send it
 * - 'skip'            : the entity is gone, or no longer in the right state
 * - 'unknown_entity'  : nobody registered this type; skip, never send blind
 */
export async function reminderStillApplies(
    db: any,
    ref: { entityType: string; entityId: string; tenantId: string },
): Promise<'applies' | 'skip' | 'unknown_entity'> {
    const check = reminderEntities.get(ref.entityType);
    if (!check) return 'unknown_entity';
    const ok = await check(db, { tenantId: ref.tenantId, entityId: ref.entityId });
    return ok ? 'applies' : 'skip';
}
