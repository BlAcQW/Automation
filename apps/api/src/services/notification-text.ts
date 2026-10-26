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
import {
    emailButton,
    emailDetails,
    emailLink,
    emailParagraph,
    escapeHtml,
    renderEmailLayout,
    renderEmailText,
} from './email-layout.js';

export interface TextBundle {
    sms: string;
    emailSubject: string;
    emailText: string;
    emailHtml: string;
}

/** Structured email content; rendered into the branded layout at the end. */
interface EmailContent {
    heading: string;
    preheader: string;
    /** Already-escaped HTML paragraphs. */
    paragraphs: string[];
    details?: Array<[string, string]>;
}

interface BaseBundle {
    sms: string;
    emailSubject: string;
    /** Plain-text body without the sign-off (links are appended before it). */
    emailText: string;
    email: EmailContent;
}

const CUSTOMER_FOOTER_NOTE = 'You got this email because you booked or ordered with a business that uses Bookly.';

function renderBundle(base: BaseBundle, extraText: string[] = [], extraHtml: string[] = []): TextBundle {
    const { email } = base;
    const body = [
        ...email.paragraphs.map((p) => emailParagraph(p)),
        email.details ? emailDetails(email.details) : '',
        ...extraHtml,
    ].filter(Boolean);
    return {
        sms: base.sms,
        emailSubject: base.emailSubject,
        emailText: renderEmailText([base.emailText, ...extraText]),
        emailHtml: renderEmailLayout({
            title: base.emailSubject,
            preheader: email.preheader,
            heading: email.heading,
            bodyHtml: body.join('\n'),
            footerNote: CUSTOMER_FOOTER_NOTE,
        }),
    };
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
    if (!links) return renderBundle(base);

    // Order purposes get the tracking link; booking reminders get the cancel link.
    const isOrderPurpose =
        purpose === 'ORDER_CONFIRMATION' ||
        purpose === 'ORDER_SHIPPED' ||
        purpose === 'ORDER_DELIVERED';

    if (isOrderPurpose && links.trackUrl) {
        return renderBundle(
            { ...base, sms: `${base.sms}\n\nTrack your order: ${links.trackUrl}` },
            ['', `Track your order: ${links.trackUrl}`],
            [emailButton('Track your order', links.trackUrl)],
        );
    }
    if (purpose === 'BOOKING_REMINDER' && links.cancelUrl) {
        return renderBundle(
            { ...base, sms: `${base.sms}\n\nNeed to cancel? ${links.cancelUrl}` },
            ['', `Need to cancel? ${links.cancelUrl}`],
            [emailParagraph(`Can&#39;t make it? ${emailLink('Cancel this appointment', links.cancelUrl)}`, { small: true, muted: true })],
        );
    }
    return renderBundle(base);
}

function baseTextBundle(
    purpose: TemplatePurpose,
    variables: string[],
): BaseBundle | null {
    switch (purpose) {
        case 'BOOKING_CONFIRMATION': {
            if (variables.length !== 5) return null;
            const [name, svc, date, time, ref] = variables;
            return {
                sms: `Hi ${name}, your ${svc} booking on ${date} at ${time} is confirmed. Ref: ${ref}.`,
                emailSubject: `Booking confirmed: ${svc}`,
                emailText:
                    `Hi ${name},\n\n` +
                    `You're booked in! Your ${svc} appointment is confirmed for ${date} at ${time}.\n` +
                    `Reference: ${ref}`,
                email: {
                    heading: "You're booked in!",
                    preheader: `${svc} on ${date} at ${time}. See you soon.`,
                    paragraphs: [
                        `Hi ${escapeHtml(name)},`,
                        `Your <strong>${escapeHtml(svc)}</strong> appointment is confirmed. See you soon!`,
                    ],
                    details: [['Service', svc], ['Date', date], ['Time', time], ['Reference', ref]],
                },
            };
        }

        case 'BOOKING_REMINDER': {
            if (variables.length !== 2) return null;
            const [svc, time] = variables;
            return {
                sms: `Reminder: your ${svc} appointment is at ${time}.`,
                emailSubject: `Reminder: ${svc} at ${time}`,
                emailText: `Reminder: your ${svc} appointment is at ${time}. See you soon!`,
                email: {
                    heading: 'See you soon',
                    preheader: `Your ${svc} appointment is at ${time}.`,
                    paragraphs: [
                        `Just a friendly reminder: your <strong>${escapeHtml(svc)}</strong> appointment is at <strong>${escapeHtml(time)}</strong>.`,
                    ],
                    details: [['Service', svc], ['Time', time]],
                },
            };
        }

        case 'BOOKING_CANCELLED': {
            if (variables.length !== 2) return null;
            const [svc, date] = variables;
            return {
                sms: `Your ${svc} booking on ${date} has been cancelled.`,
                emailSubject: `Booking cancelled: ${svc}`,
                emailText: `Your ${svc} booking on ${date} has been cancelled. Want a new time? Just message the business.`,
                email: {
                    heading: 'Your booking is cancelled',
                    preheader: `Your ${svc} booking on ${date} has been cancelled.`,
                    paragraphs: [
                        `Your <strong>${escapeHtml(svc)}</strong> booking on <strong>${escapeHtml(date)}</strong> has been cancelled.`,
                        'Want a new time? Just message the business and they will sort you out.',
                    ],
                },
            };
        }

        case 'BOOKING_RESCHEDULED': {
            if (variables.length !== 3) return null;
            const [svc, newDate, newTime] = variables;
            return {
                sms: `Your ${svc} booking is rescheduled to ${newDate} at ${newTime}.`,
                emailSubject: `Booking rescheduled: ${svc}`,
                emailText: `Your ${svc} booking has been rescheduled to ${newDate} at ${newTime}.`,
                email: {
                    heading: 'New time, all set',
                    preheader: `${svc} is now on ${newDate} at ${newTime}.`,
                    paragraphs: [
                        `Your <strong>${escapeHtml(svc)}</strong> booking has been moved. Here are the new details:`,
                    ],
                    details: [['Service', svc], ['New date', newDate], ['New time', newTime]],
                },
            };
        }

        case 'ORDER_CONFIRMATION': {
            if (variables.length !== 2) return null;
            const [ref, total] = variables;
            return {
                sms: `Order #${ref} confirmed. Total: ${total}.`,
                emailSubject: `Order #${ref} confirmed`,
                emailText: `Thanks for your order! Your order #${ref} is confirmed. Total: ${total}.`,
                email: {
                    heading: 'Thanks for your order!',
                    preheader: `Order #${ref} is confirmed. Total: ${total}.`,
                    paragraphs: [`Your order <strong>#${escapeHtml(ref)}</strong> is confirmed. We will let you know when it is on its way.`],
                    details: [['Order', `#${ref}`], ['Total', total]],
                },
            };
        }

        case 'ORDER_SHIPPED': {
            if (variables.length !== 1) return null;
            const [ref] = variables;
            return {
                sms: `Your order #${ref} has shipped.`,
                emailSubject: `Order #${ref} shipped`,
                emailText: `Good news! Your order #${ref} has shipped.`,
                email: {
                    heading: 'Your order is on its way',
                    preheader: `Order #${ref} has shipped.`,
                    paragraphs: [`Good news! Your order <strong>#${escapeHtml(ref)}</strong> has shipped.`],
                },
            };
        }

        case 'ORDER_DELIVERED': {
            if (variables.length !== 1) return null;
            const [ref] = variables;
            return {
                sms: `Your order #${ref} has been delivered.`,
                emailSubject: `Order #${ref} delivered`,
                emailText: `Your order #${ref} has been delivered. Enjoy!`,
                email: {
                    heading: 'Delivered!',
                    preheader: `Order #${ref} has been delivered.`,
                    paragraphs: [`Your order <strong>#${escapeHtml(ref)}</strong> has been delivered. Enjoy!`],
                },
            };
        }
    }
}

// Re-export for tests / call sites that want type-safe purpose enumeration.
export type { TemplatePurpose } from '@prisma/client';
