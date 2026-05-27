/**
 * Notification Worker
 *
 * Drains the BullMQ `notifications` and `reminders` queues. Sends approved
 * WhatsApp templates only — never free-form text — so messages are accepted
 * by Meta outside the 24-hour customer-service window.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient, TemplatePurpose } from '@prisma/client';
import { QUEUE_NAMES, NotificationJob, ReminderJob } from '../plugins/redis.js';
import { decrypt } from './crypto.js';
import { sendTemplateMessage } from './whatsapp-templates.js';
import { tryReserveOutbound, rollbackOutboundReservation } from './usage.js';
import { sendSms } from './arkesel.js';
import { sendEmail, resolveGmailCreds } from './gmail-smtp.js';
import { buildTextBundle, type TextBundle, type MessageLinks } from './notification-text.js';
import { config } from '../config/index.js';

/** Purposes sent outside the WhatsApp 24h window — gated by the tenant toggle. */
const OUT_OF_WINDOW_PURPOSES: ReadonlySet<TemplatePurpose> = new Set([
    'BOOKING_REMINDER',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
] as TemplatePurpose[]);

/**
 * Resolve the customer self-service link for a message, if applicable.
 * Order purposes → tracking link (resolved via orderRef). BOOKING_REMINDER
 * → cancel link (resolved via bookingId). Best-effort: returns undefined on
 * any miss so a message still sends without the link.
 */
async function resolveMessageLinks(
    purpose: TemplatePurpose,
    variables: string[],
    bookingId?: string,
): Promise<MessageLinks | undefined> {
    try {
        if (
            purpose === 'ORDER_CONFIRMATION' ||
            purpose === 'ORDER_SHIPPED' ||
            purpose === 'ORDER_DELIVERED'
        ) {
            const order = await prisma.order.findUnique({
                where: { orderRef: variables[0] },
                select: { publicToken: true },
            });
            if (order?.publicToken) {
                return { trackUrl: `${config.frontendUrl}/track/${order.publicToken}` };
            }
        }
        if (purpose === 'BOOKING_REMINDER' && bookingId) {
            const booking = await prisma.booking.findUnique({
                where: { id: bookingId },
                select: { publicToken: true },
            });
            if (booking?.publicToken) {
                return { cancelUrl: `${config.frontendUrl}/c/${booking.publicToken}` };
            }
        }
    } catch {
        // Link resolution is best-effort — never block a send on it.
    }
    return undefined;
}

const prisma = new PrismaClient();

interface TenantCreds {
    accessToken: string;
    phoneNumberId: string;
}

async function loadTenantCreds(tenantId: string): Promise<TenantCreds | null> {
    const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { whatsappAccessToken: true, whatsappPhoneNumberId: true },
    });
    if (!tenant?.whatsappAccessToken || !tenant.whatsappPhoneNumberId) {
        return null;
    }
    return {
        accessToken: decrypt(tenant.whatsappAccessToken),
        phoneNumberId: tenant.whatsappPhoneNumberId,
    };
}

async function alertDashboard(
    tenantId: string,
    purpose: TemplatePurpose,
    customerPhone: string,
    title: string,
    message: string,
): Promise<void> {
    await prisma.notification.create({
        data: {
            tenantId,
            type: 'SYSTEM',
            title,
            message,
            metadata: { purpose, customerPhone },
        },
    });
}

/**
 * Common send path. Returns:
 *   - 'ok'        : message sent (or skipped due to misconfiguration that
 *                   was surfaced as a dashboard alert — do NOT retry)
 *   - 'retry'     : transient send failure (Meta 5xx, network error)
 */
async function sendByPurpose(
    tenantId: string,
    purpose: TemplatePurpose,
    customerPhone: string,
    variables: string[],
    bookingId?: string,
): Promise<'ok' | 'retry'> {
    // Master toggle — if the tenant has switched off out-of-window messages,
    // skip reminders + order updates entirely (no send, no quota burn).
    if (OUT_OF_WINDOW_PURPOSES.has(purpose)) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { outOfWindowMessagesEnabled: true },
        });
        if (tenant && !tenant.outOfWindowMessagesEnabled) {
            console.log(
                `Out-of-window messages disabled for tenant ${tenantId} — skipping ${purpose}`,
            );
            return 'ok';
        }
    }

    // Pre-flight: validate config before reserving a quota slot.
    const creds = await loadTenantCreds(tenantId);
    if (!creds) {
        await alertDashboard(
            tenantId,
            purpose,
            customerPhone,
            'WhatsApp not connected',
            `Could not send ${purpose} to ${customerPhone}: tenant has no WhatsApp credentials.`,
        );
        return 'ok';
    }

    const template = await prisma.messageTemplate.findUnique({
        where: { tenantId_purpose: { tenantId, purpose } },
    });

    if (!template || !template.isApproved) {
        await alertDashboard(
            tenantId,
            purpose,
            customerPhone,
            'Template not registered',
            `No approved template found for ${purpose}. Register one at /templates so reminders and confirmations can be delivered.`,
        );
        return 'ok';
    }

    if (variables.length !== template.variableCount) {
        await alertDashboard(
            tenantId,
            purpose,
            customerPhone,
            'Template variable mismatch',
            `Template ${template.name} expects ${template.variableCount} variables but ${variables.length} were supplied.`,
        );
        return 'ok';
    }

    // Atomic quota reservation — replaces check + increment. Two parallel
    // workers can't both reserve when only one slot remains.
    const reservation = await tryReserveOutbound(prisma, tenantId);
    if (!reservation.ok) {
        await alertDashboard(
            tenantId,
            purpose,
            customerPhone,
            'Message quota exhausted',
            `Plan ${reservation.planId} allows ${reservation.limit} outbound messages this month — used ${reservation.used}. Upgrade your plan to send more.`,
        );
        return 'ok';
    }

    const result = await sendTemplateMessage({
        accessToken: creds.accessToken,
        phoneNumberId: creds.phoneNumberId,
        to: customerPhone,
        template: {
            name: template.name,
            language: template.language,
            variableCount: template.variableCount,
        },
        variables,
    });

    if (result.ok) {
        return 'ok';
    }

    // Phase 5 — try Arkesel SMS, then Gmail SMTP. The reservation we hold
    // counts toward the tenant's quota regardless of which channel succeeds.
    // Resolve the customer self-service link so the SMS/email carry it.
    const links = await resolveMessageLinks(purpose, variables, bookingId);
    const bundle = buildTextBundle(purpose, variables, links);
    const smsOutcome = await trySmsFallback({ tenantId, customerPhone, bundle });
    if (smsOutcome === 'sent') {
        await auditFallback(tenantId, 'fallback.sms.success', { purpose });
        return 'ok';
    }
    const email = await tryEmailFallback({ tenantId, purpose, customerPhone, bundle });
    if (email.outcome === 'sent') {
        await auditFallback(tenantId, 'fallback.email.success', {
            purpose,
            source: email.source,
        });
        return 'ok';
    }

    // Every channel failed — release the reservation so a future retry
    // (BullMQ re-enqueues) gets a fresh chance against the same quota.
    await rollbackOutboundReservation(prisma, tenantId);
    console.error(
        `All channels failed (${purpose}): wa=${result.error ?? 'unknown'} sms=${smsOutcome} email=${email.outcome}`,
    );
    await auditFallback(tenantId, 'fallback.exhausted', {
        purpose,
        wa: result.error ?? 'unknown',
        sms: smsOutcome,
        email: email.outcome,
    });
    return 'retry';
}

// ---------------------------------------------------------------------------
// Phase 5 — fallback helpers + audit wrapper
// ---------------------------------------------------------------------------

type FallbackOutcome = 'sent' | 'not_configured' | 'no_body' | 'send_failed' | 'no_email';

async function trySmsFallback(args: {
    tenantId: string;
    customerPhone: string;
    bundle: TextBundle | null;
}): Promise<FallbackOutcome> {
    if (!args.bundle) return 'no_body';
    const tenant = await prisma.tenant.findUnique({
        where: { id: args.tenantId },
        select: { arkeselApiKey: true, arkeselSenderId: true },
    });
    if (!tenant?.arkeselApiKey || !tenant.arkeselSenderId) {
        return 'not_configured';
    }
    let apiKey: string;
    try {
        apiKey = decrypt(tenant.arkeselApiKey);
    } catch {
        return 'send_failed';
    }
    const res = await sendSms({
        apiKey,
        senderId: tenant.arkeselSenderId,
        to: args.customerPhone,
        message: args.bundle.sms,
    });
    return res.ok ? 'sent' : 'send_failed';
}

interface EmailFallbackResult {
    outcome: FallbackOutcome;
    source?: 'tenant' | 'platform';
}

async function tryEmailFallback(args: {
    tenantId: string;
    purpose: TemplatePurpose;
    customerPhone: string;
    bundle: TextBundle | null;
}): Promise<EmailFallbackResult> {
    if (!args.bundle) return { outcome: 'no_body' };

    const tenant = await prisma.tenant.findUnique({
        where: { id: args.tenantId },
        select: { gmailUser: true, gmailAppPassword: true, gmailFromName: true },
    });

    // Phase 5a — resolver picks tenant Gmail when connected, otherwise the
    // platform-level shared sender from BOOKINGFLOW_GMAIL_* env vars.
    const creds = resolveGmailCreds({
        tenantGmailUser: tenant?.gmailUser ?? null,
        tenantGmailAppPasswordEncrypted: tenant?.gmailAppPassword ?? null,
        tenantGmailFromName: tenant?.gmailFromName ?? null,
    });
    if (!creds) return { outcome: 'not_configured' };

    // Resolve the customer email by looking up the latest matching source
    // record. Booking purposes hit booking; order purposes hit order.
    const isOrderPurpose =
        args.purpose === 'ORDER_CONFIRMATION' ||
        args.purpose === 'ORDER_SHIPPED' ||
        args.purpose === 'ORDER_DELIVERED';
    const customerEmail = isOrderPurpose
        ? (await prisma.order.findFirst({
              where: { tenantId: args.tenantId, customerPhone: args.customerPhone },
              orderBy: { createdAt: 'desc' },
              select: { customerEmail: true },
          }))?.customerEmail
        : (await prisma.booking.findFirst({
              where: { tenantId: args.tenantId, customerPhone: args.customerPhone },
              orderBy: { createdAt: 'desc' },
              select: { customerEmail: true },
          }))?.customerEmail;

    if (!customerEmail) return { outcome: 'no_email' };

    const res = await sendEmail({
        user: creds.user,
        appPassword: creds.appPassword,
        fromName: creds.fromName,
        source: creds.source,
        to: customerEmail,
        subject: args.bundle.emailSubject,
        text: args.bundle.emailText,
        html: args.bundle.emailHtml,
    });
    return {
        outcome: res.ok ? 'sent' : 'send_failed',
        source: creds.source,
    };
}

/**
 * Audit fallback outcomes via raw prisma — we don't import the audit helper
 * (which expects ExtendedPrismaClient) because the worker uses the base
 * client. Safe parity with the helper's shape.
 */
async function auditFallback(
    tenantId: string,
    action: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                tenantId,
                actorType: 'SYSTEM',
                action,
                metadata: metadata as object,
            },
        });
    } catch (err) {
        console.error('Audit log write failed', err, { action });
    }
}

async function processNotification(job: Job<NotificationJob>): Promise<void> {
    const { purpose, tenantId, customerPhone, variables } = job.data;
    console.log(`Processing notification: ${purpose} for ${customerPhone}`);
    const outcome = await sendByPurpose(tenantId, purpose, customerPhone, variables);
    if (outcome === 'retry') {
        throw new Error(`Failed to send template ${purpose} — BullMQ will retry`);
    }
}

async function processReminder(job: Job<ReminderJob>): Promise<void> {
    const { purpose, tenantId, bookingId, customerPhone, variables } = job.data;
    console.log(`Processing reminder for booking ${bookingId}`);

    // Re-check that the booking is still active before sending the reminder.
    const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { status: true, tenantId: true },
    });

    if (!booking || booking.tenantId !== tenantId || booking.status !== 'CONFIRMED') {
        console.log('Booking no longer active, skipping reminder');
        return;
    }

    const outcome = await sendByPurpose(tenantId, purpose, customerPhone, variables, bookingId);
    if (outcome === 'retry') {
        throw new Error(`Failed to send reminder template — BullMQ will retry`);
    }
}

export function startNotificationWorkers(redisUrl: string | undefined): {
    notifications: Worker | null;
    reminders: Worker | null;
} {
    if (!redisUrl) {
        console.warn('Redis not configured - notification workers disabled');
        return { notifications: null, reminders: null };
    }

    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    const notificationsWorker = new Worker(
        QUEUE_NAMES.NOTIFICATIONS,
        async (job) => processNotification(job),
        { connection, concurrency: 5 },
    );

    notificationsWorker.on('completed', (job) => {
        console.log(`Notification job ${job.id} completed`);
    });
    notificationsWorker.on('failed', (job, err) => {
        console.error(`Notification job ${job?.id} failed:`, err.message);
    });

    const remindersWorker = new Worker(
        QUEUE_NAMES.REMINDERS,
        async (job) => processReminder(job),
        { connection, concurrency: 5 },
    );

    remindersWorker.on('completed', (job) => {
        console.log(`Reminder job ${job.id} completed`);
    });
    remindersWorker.on('failed', (job, err) => {
        console.error(`Reminder job ${job?.id} failed:`, err.message);
    });

    console.log('Notification workers started');

    return { notifications: notificationsWorker, reminders: remindersWorker };
}

export async function stopNotificationWorkers(workers: {
    notifications: Worker | null;
    reminders: Worker | null;
}): Promise<void> {
    if (workers.notifications) await workers.notifications.close();
    if (workers.reminders) await workers.reminders.close();
    console.log('Notification workers stopped');
}
