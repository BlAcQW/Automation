/**
 * Phase 5 — plain-text bodies (SMS) and email bundles (subject + text + HTML)
 * for each notification purpose. Mirrors the variable order documented in
 * apps/api/prisma/schema.prisma's MessageTemplate comments.
 *
 * Returns null when the variable count doesn't match — caller skips that
 * fallback layer for that purpose. Phase 5b will replace this with
 * tenant-customisable bodies via a new schema model.
 */

import type { TemplatePurpose } from '@prisma/client';

export interface TextBundle {
    sms: string;
    emailSubject: string;
    emailText: string;
    emailHtml: string;
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function htmlBundle(parts: string[]): string {
    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #1f2937;">${parts.join('')}</div>`;
}

/**
 * Optional customer self-service links appended to the SMS / email body.
 *  - `trackUrl`  — order tracking page, for ORDER_* purposes
 *  - `cancelUrl` — appointment cancel page, for BOOKING_REMINDER
 */
export interface MessageLinks {
    trackUrl?: string;
    cancelUrl?: string;
}

/**
 * Build the SMS / email bundle for a notification purpose, optionally
 * appending a tracking or cancel link. The link is appended to the SMS and
 * email bodies only — WhatsApp template sends are unaffected (they use the
 * approved template, not this bundle).
 */
export function buildTextBundle(
    purpose: TemplatePurpose,
    variables: string[],
    links?: MessageLinks,
): TextBundle | null {
    const base = baseTextBundle(purpose, variables);
    if (!base) return base;
    if (!links) return base;

    // Order purposes get the tracking link; booking reminders get the cancel link.
    const isOrderPurpose =
        purpose === 'ORDER_CONFIRMATION' ||
        purpose === 'ORDER_SHIPPED' ||
        purpose === 'ORDER_DELIVERED';

    if (isOrderPurpose && links.trackUrl) {
        return {
            sms: `${base.sms}\n\nTrack your order: ${links.trackUrl}`,
            emailSubject: base.emailSubject,
            emailText: `${base.emailText}\n\nTrack your order: ${links.trackUrl}`,
            emailHtml: base.emailHtml.replace(
                '</div>',
                `<p><a href="${escapeHtml(links.trackUrl)}">Track your order</a></p></div>`,
            ),
        };
    }
    if (purpose === 'BOOKING_REMINDER' && links.cancelUrl) {
        return {
            sms: `${base.sms}\n\nNeed to cancel? ${links.cancelUrl}`,
            emailSubject: base.emailSubject,
            emailText: `${base.emailText}\n\nNeed to cancel? ${links.cancelUrl}`,
            emailHtml: base.emailHtml.replace(
                '</div>',
                `<p><a href="${escapeHtml(links.cancelUrl)}">Cancel this appointment</a></p></div>`,
            ),
        };
    }
    return base;
}

function baseTextBundle(
    purpose: TemplatePurpose,
    variables: string[],
): TextBundle | null {
    switch (purpose) {
        case 'BOOKING_CONFIRMATION': {
            if (variables.length !== 5) return null;
            const [name, svc, date, time, ref] = variables;
            const eName = escapeHtml(name);
            const eSvc = escapeHtml(svc);
            const eDate = escapeHtml(date);
            const eTime = escapeHtml(time);
            const eRef = escapeHtml(ref);
            return {
                sms: `Hi ${name}, your ${svc} booking on ${date} at ${time} is confirmed. Ref: ${ref}.`,
                emailSubject: `Booking confirmed: ${svc}`,
                emailText:
                    `Hi ${name},\n\n` +
                    `Your ${svc} appointment is confirmed for ${date} at ${time}.\n` +
                    `Reference: ${ref}\n`,
                emailHtml: htmlBundle([
                    `<p>Hi ${eName},</p>`,
                    `<p>Your <strong>${eSvc}</strong> appointment is confirmed for <strong>${eDate}</strong> at <strong>${eTime}</strong>.</p>`,
                    `<p>Reference: <code>${eRef}</code></p>`,
                ]),
            };
        }

        case 'BOOKING_REMINDER': {
            if (variables.length !== 2) return null;
            const [svc, time] = variables;
            const eSvc = escapeHtml(svc);
            const eTime = escapeHtml(time);
            return {
                sms: `Reminder: your ${svc} appointment is at ${time}.`,
                emailSubject: `Reminder: ${svc} at ${time}`,
                emailText: `Reminder: your ${svc} appointment is at ${time}.`,
                emailHtml: htmlBundle([
                    `<p>Reminder: your <strong>${eSvc}</strong> appointment is at <strong>${eTime}</strong>.</p>`,
                ]),
            };
        }

        case 'BOOKING_CANCELLED': {
            if (variables.length !== 2) return null;
            const [svc, date] = variables;
            const eSvc = escapeHtml(svc);
            const eDate = escapeHtml(date);
            return {
                sms: `Your ${svc} booking on ${date} has been cancelled.`,
                emailSubject: `Booking cancelled: ${svc}`,
                emailText: `Your ${svc} booking on ${date} has been cancelled.`,
                emailHtml: htmlBundle([
                    `<p>Your <strong>${eSvc}</strong> booking on <strong>${eDate}</strong> has been cancelled.</p>`,
                ]),
            };
        }

        case 'BOOKING_RESCHEDULED': {
            if (variables.length !== 3) return null;
            const [svc, newDate, newTime] = variables;
            const eSvc = escapeHtml(svc);
            const eDate = escapeHtml(newDate);
            const eTime = escapeHtml(newTime);
            return {
                sms: `Your ${svc} booking is rescheduled to ${newDate} at ${newTime}.`,
                emailSubject: `Booking rescheduled: ${svc}`,
                emailText: `Your ${svc} booking has been rescheduled to ${newDate} at ${newTime}.`,
                emailHtml: htmlBundle([
                    `<p>Your <strong>${eSvc}</strong> booking has been rescheduled to <strong>${eDate}</strong> at <strong>${eTime}</strong>.</p>`,
                ]),
            };
        }

        case 'ORDER_CONFIRMATION': {
            if (variables.length !== 2) return null;
            const [ref, total] = variables;
            const eRef = escapeHtml(ref);
            const eTotal = escapeHtml(total);
            return {
                sms: `Order #${ref} confirmed. Total: ${total}.`,
                emailSubject: `Order #${ref} confirmed`,
                emailText: `Your order #${ref} is confirmed. Total: ${total}.`,
                emailHtml: htmlBundle([
                    `<p>Your order <code>${eRef}</code> is confirmed.</p>`,
                    `<p>Total: <strong>${eTotal}</strong></p>`,
                ]),
            };
        }

        case 'ORDER_SHIPPED': {
            if (variables.length !== 1) return null;
            const [ref] = variables;
            const eRef = escapeHtml(ref);
            return {
                sms: `Your order #${ref} has shipped.`,
                emailSubject: `Order #${ref} shipped`,
                emailText: `Your order #${ref} has shipped.`,
                emailHtml: htmlBundle([
                    `<p>Your order <code>${eRef}</code> has shipped.</p>`,
                ]),
            };
        }

        case 'ORDER_DELIVERED': {
            if (variables.length !== 1) return null;
            const [ref] = variables;
            const eRef = escapeHtml(ref);
            return {
                sms: `Your order #${ref} has been delivered.`,
                emailSubject: `Order #${ref} delivered`,
                emailText: `Your order #${ref} has been delivered.`,
                emailHtml: htmlBundle([
                    `<p>Your order <code>${eRef}</code> has been delivered.</p>`,
                ]),
            };
        }
    }
}

// Re-export for tests / call sites that want type-safe purpose enumeration.
export type { TemplatePurpose } from '@prisma/client';
