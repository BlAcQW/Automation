/**
 * Messages to a ride customer outside a flow turn (driver assigned, ride
 * completed, package activated after the chat moved on, reminders).
 *
 * WhatsApp first: a free-form text through the reply outbox (stored on the
 * conversation, quota reserved, pause respected) when the customer wrote in the
 * last 24 hours. Outside that window, or when WhatsApp cannot deliver, SMS
 * (the tenant's Arkesel, else Bookly's within the platform budget), then email
 * (the tenant's Gmail, else Bookly's) to the address on the Customer record.
 * The same channels and the same quota as the notification worker.
 *
 * Never throws: by the time this runs the ride change is saved, and a failed
 * message must not turn it into an error. Every outcome is logged.
 */
import { deliverReply, ReplySendError } from '../../routes/whatsapp/reply-outbox.js';
import { tenantChannelCreds } from '../tenant-channel-creds.js';
import { tryReserveOutbound, rollbackOutboundReservation, getPlatformSmsCount, incrementPlatformSmsUsage } from '../usage.js';
import { sendSms } from '../arkesel.js';
import { resolveSmsRoute, withinSmsBudget, DEFAULT_MONTHLY_SMS_BUDGET } from '../sms-route.js';
import { sendEmail, resolveGmailCreds } from '../gmail-smtp.js';
import { isOutboundPaused } from '../platform-switches.js';
import { config } from '../../config/index.js';
import type { RidesClient } from './db.js';

/** Free-form WhatsApp messages are only deliverable for 24h after the customer's last message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type NotifyOutcome = 'whatsapp' | 'sms' | 'email' | 'paused' | 'quota' | 'failed' | 'no_customer';

export interface RidesLogger {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
}

export interface NotifyDeps {
    prisma: RidesClient;
    log: RidesLogger;
}

export interface NotifyArgs {
    tenantId: string;
    customerId: string;
    /** Prefer this conversation (the one the ride came from). */
    conversationId?: string | null;
    text: string;
    /** For logs and the stored message's metadata, e.g. 'ride.driver_assigned'. */
    kind: string;
    emailSubject?: string;
}

export function windowOpen(lastInboundAt: Date | null | undefined, now = Date.now()): boolean {
    return !!lastInboundAt && now - lastInboundAt.getTime() < WINDOW_MS;
}

async function findConversation(deps: NotifyDeps, args: NotifyArgs, phone: string) {
    const select = { id: true, externalId: true, lastInboundAt: true, channel: true } as const;
    if (args.conversationId) {
        const byId = await deps.prisma.conversation.findFirst({ where: { id: args.conversationId, tenantId: args.tenantId, channel: 'WHATSAPP' }, select });
        if (byId) return byId;
    }
    return deps.prisma.conversation.findFirst({
        where: { tenantId: args.tenantId, channel: 'WHATSAPP', OR: [{ customerId: args.customerId }, { customerPhone: phone }, { externalId: phone.replace(/^\+/, '') }] },
        orderBy: { lastInboundAt: 'desc' },
        select,
    });
}

export async function notifyRideCustomer(deps: NotifyDeps, args: NotifyArgs): Promise<NotifyOutcome> {
    try {
        return await send(deps, args);
    } catch (err) {
        deps.log.error({ err, tenantId: args.tenantId, kind: args.kind }, 'Ride notification failed');
        return 'failed';
    }
}

async function send(deps: NotifyDeps, args: NotifyArgs): Promise<NotifyOutcome> {
    const { prisma, log } = deps;
    const [tenant, customer] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: args.tenantId } }),
        prisma.customer.findFirst({ where: { id: args.customerId, tenantId: args.tenantId }, select: { id: true, phone: true, email: true } }),
    ]);
    if (!tenant || !customer) return 'no_customer';

    const conv = await findConversation(deps, args, customer.phone);
    if (conv && windowOpen(conv.lastInboundAt)) {
        try {
            const outcome = await deliverReply({ prisma, log }, tenant, {
                conversationId: conv.id,
                channel: 'WHATSAPP',
                creds: tenantChannelCreds(tenant, 'WHATSAPP'),
                recipientId: conv.externalId,
                text: args.text,
                metadata: { source: 'rides', kind: args.kind, channel: 'WHATSAPP' },
            });
            if (outcome === 'sent') return 'whatsapp';
            if (outcome === 'suppressed') {
                // Paused by support, or out of quota: no other channel either (same rule as the notification worker).
                return (await isOutboundPaused(prisma, args.tenantId)).paused ? 'paused' : 'quota';
            }
        } catch (err) {
            // ReplySendError: stored PENDING (visible in the inbox). Fall back so the customer still hears.
            log.warn({ err, kind: args.kind, stored: err instanceof ReplySendError }, 'Ride WhatsApp message not delivered; trying SMS/email');
        }
    }

    const reservation = await tryReserveOutbound(prisma, args.tenantId);
    if (!reservation.ok) {
        log.warn({ tenantId: args.tenantId, kind: args.kind, reason: reservation.reason }, 'Ride notification suppressed');
        return reservation.reason === 'paused' ? 'paused' : 'quota';
    }
    if (await trySms(deps, tenant, customer.phone, args.text)) return 'sms';
    if (customer.email && (await tryEmail(tenant, customer.email, args))) return 'email';
    await rollbackOutboundReservation(prisma, args.tenantId).catch(() => undefined);
    log.error({ tenantId: args.tenantId, kind: args.kind }, 'Ride notification: every channel failed');
    return 'failed';
}

async function trySms(deps: NotifyDeps, tenant: { id: string; arkeselApiKey: string | null; arkeselSenderId: string | null }, phone: string, text: string): Promise<boolean> {
    const route = resolveSmsRoute(tenant, { apiKey: config.platformSms?.apiKey ?? '', senderId: config.platformSms?.senderId ?? '' });
    if (!route) return false;
    if (route.route === 'PLATFORM') {
        const budget = config.platformSms?.monthlyBudget ?? DEFAULT_MONTHLY_SMS_BUDGET;
        if (!withinSmsBudget({ sentThisCycle: await getPlatformSmsCount(deps.prisma, tenant.id), budget })) return false;
    }
    const res = await sendSms({ apiKey: route.apiKey, senderId: route.senderId, to: phone, message: text });
    if (res.ok && route.route === 'PLATFORM') await incrementPlatformSmsUsage(deps.prisma, tenant.id).catch(() => undefined);
    return res.ok;
}

async function tryEmail(tenant: { gmailUser: string | null; gmailAppPassword: string | null; gmailFromName: string | null }, to: string, args: NotifyArgs): Promise<boolean> {
    const creds = resolveGmailCreds({
        tenantGmailUser: tenant.gmailUser, tenantGmailAppPasswordEncrypted: tenant.gmailAppPassword, tenantGmailFromName: tenant.gmailFromName,
    });
    if (!creds) return false;
    const res = await sendEmail({
        user: creds.user, appPassword: creds.appPassword, fromName: creds.fromName, source: creds.source,
        to, subject: args.emailSubject ?? 'Your TURBO ride', text: args.text,
    });
    return res.ok;
}

/** SMS to a driver (optional setting). Respects the pause; never throws. */
export async function smsDriver(deps: NotifyDeps, args: { tenantId: string; phone: string; text: string }): Promise<boolean> {
    try {
        const tenant = await deps.prisma.tenant.findUnique({ where: { id: args.tenantId } });
        if (!tenant) return false;
        const reservation = await tryReserveOutbound(deps.prisma, args.tenantId);
        if (!reservation.ok) return false;
        const ok = await trySms(deps, tenant, args.phone, args.text);
        if (!ok) await rollbackOutboundReservation(deps.prisma, args.tenantId).catch(() => undefined);
        return ok;
    } catch (err) {
        deps.log.error({ err, tenantId: args.tenantId }, 'Driver SMS failed');
        return false;
    }
}
