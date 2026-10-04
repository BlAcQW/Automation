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
