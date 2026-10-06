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
import { QUEUE_NAMES, NotificationJob } from '../plugins/redis.js';
import type { ReminderJobPayload } from './notification.js';
import { decrypt } from './crypto.js';
import { sendTemplateMessage } from './whatsapp-templates.js';
import {
    tryReserveOutbound,
    rollbackOutboundReservation,
    incrementPlatformSmsUsage,
    getPlatformSmsCount,
} from './usage.js';
import { raiseAlert } from './alerts.js';
import { getWhatsappCredentials } from './whatsapp-credentials.js';
import { sendSms } from './arkesel.js';
import { resolveSmsRoute, withinSmsBudget, DEFAULT_MONTHLY_SMS_BUDGET } from './sms-route.js';
import { sendEmail, resolveGmailCreds } from './gmail-smtp.js';
import { buildTextBundle, type TextBundle, type MessageLinks } from './notification-text.js';
import { config } from '../config/index.js';
import { scoped } from '../lib/logger.js';
import {
    OUT_OF_WINDOW_PURPOSES,
    purposeEntity,
    normalizeReminderJob,
    reminderStillApplies,
} from './notification-purposes.js';
import { resolveCustomerEmail } from './customers.js';

const log = scoped('notification-worker');

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
        if (
            purpose !== 'ORDER_CONFIRMATION' &&
            purpose !== 'ORDER_SHIPPED' &&
            purpose !== 'ORDER_DELIVERED' &&
            purpose !== 'BOOKING_REMINDER'
        ) {
            log.debug({ purpose }, 'No self-service link defined for purpose');
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
    // Resolver, not an inline token read: hosted numbers carry no per-tenant
    // token and must fall back to the platform one. See whatsapp-credentials.ts.
    return getWhatsappCredentials(prisma, tenantId);
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

/** Optional facts about the entity a send is for. */
interface SendContext {
    /** Booking reminders: builds the self-service cancel link. */
    bookingId?: string;
    /** Linked Customer record, preferred over a phone match for the email fallback. */
    customerId?: string | null;
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
    ctx: SendContext = {},
): Promise<'ok' | 'retry'> {
    const { bookingId } = ctx;
    // Master toggle — if the tenant has switched off out-of-window messages,
    // skip reminders + order updates entirely (no send, no quota burn).
    if (OUT_OF_WINDOW_PURPOSES.has(purpose)) {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { outOfWindowMessagesEnabled: true },
        });
        if (tenant && !tenant.outOfWindowMessagesEnabled) {
            log.info({ tenantId, purpose }, 'Out-of-window messages disabled for tenant — skipping');
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
    const email = await tryEmailFallback({
        tenantId,
        purpose,
        customerPhone,
        customerId: ctx.customerId,
        bundle,
    });
    if (email.outcome === 'sent') {
        await auditFallback(tenantId, 'fallback.email.success', {
            purpose,
            source: email.source,
            addressSource: email.addressSource,
        });
        return 'ok';
    }

    // Every channel failed — release the reservation so a future retry
    // (BullMQ re-enqueues) gets a fresh chance against the same quota.
    await rollbackOutboundReservation(prisma, tenantId);
    log.error(
        { purpose, whatsapp: result.error ?? 'unknown', sms: smsOutcome, email: email.outcome },
        'All channels failed',
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

    // Default to Bookly's own Arkesel account so a salon owner never has to
    // open an SMS gateway. Tenants who configured their own keep it — their
    // sender ID is their brand in the recipient's inbox.
    const route = resolveSmsRoute(tenant ?? { arkeselApiKey: null, arkeselSenderId: null }, {
        apiKey: config.platformSms?.apiKey ?? '',
        senderId: config.platformSms?.senderId ?? '',
    });
    if (!route) return 'not_configured';

    // Platform SMS is Bookly's money, so it is metered per tenant. One busy
    // tenant must not be able to spend everyone else's reminders.
    const budget = config.platformSms?.monthlyBudget ?? DEFAULT_MONTHLY_SMS_BUDGET;
    if (route.route === 'PLATFORM') {
        const cycle = await currentPlatformSmsCount(args.tenantId);
        if (!withinSmsBudget({ sentThisCycle: cycle, budget })) {
            log.warn(
                { tenantId: args.tenantId, cycle, budget },
                'Platform SMS budget reached for tenant — falling back to no SMS',
            );
            return 'not_configured';
        }
    }

    const res = await sendSms({
        apiKey: route.apiKey,
        senderId: route.senderId,
        to: args.customerPhone,
        message: args.bundle.sms,
    });

    if (res.ok && route.route === 'PLATFORM') {
        await countPlatformSms(args.tenantId).catch(() => {
            // A miscount is better than a dropped message; the budget is a
            // cost guard, not a correctness guarantee.
        });
    }

    return res.ok ? 'sent' : 'send_failed';
}

// Platform-SMS metering shares the message cycle row; see usage.ts.
async function currentPlatformSmsCount(tenantId: string): Promise<number> {
    return getPlatformSmsCount(prisma, tenantId);
}

async function countPlatformSms(tenantId: string): Promise<void> {
    await incrementPlatformSmsUsage(prisma, tenantId);
}

interface EmailFallbackResult {
    outcome: FallbackOutcome;
    /** Which gmail account sent it. */
    source?: 'tenant' | 'platform';
    /** Where the address came from. */
    addressSource?: 'customer' | 'booking' | 'order';
}

async function tryEmailFallback(args: {
    tenantId: string;
    purpose: TemplatePurpose;
    customerPhone: string;
    customerId?: string | null;
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

    // A purpose we cannot map is a code bug (new enum value not wired up),
    // not a customer without an email. Log loudly but do not throw — a
    // throw would crash-loop the job.
    if (!purposeEntity(args.purpose)) {
        log.error(
            { purpose: args.purpose, tenantId: args.tenantId },
            'Email fallback: unknown purpose, cannot determine which entity to look up',
        );
        await raiseAlert(prisma, {
            kind: 'notification.unknown_purpose',
            severity: 'warning',
            tenantId: args.tenantId,
            message: `Notification purpose ${String(args.purpose)} has no entity mapping; email fallback skipped.`,
            context: { purpose: String(args.purpose) },
            dedupeKey: `notification.unknown_purpose:${String(args.purpose)}`,
        });
    }

    // Customer record first, then the latest booking/order for the phone.
    const resolved = await resolveCustomerEmail(prisma, {
        tenantId: args.tenantId,
        purpose: args.purpose,
        customerPhone: args.customerPhone,
        customerId: args.customerId,
    });
    const customerEmail = resolved.email;

    if (!customerEmail) {
        // Normal: the customer carries no email address.
        log.debug(
            { purpose: args.purpose, tenantId: args.tenantId },
            'Email fallback: no customer email on file',
        );
        return { outcome: 'no_email' };
    }

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
        addressSource: resolved.source ?? undefined,
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
        log.error({ err, action }, 'Audit log write failed');
    }
}

async function processNotification(job: Job<NotificationJob>): Promise<void> {
    const { purpose, tenantId, customerPhone, variables } = job.data;
    log.info(`Processing notification: ${purpose} for ${customerPhone}`);
    const outcome = await sendByPurpose(tenantId, purpose, customerPhone, variables);
    if (outcome === 'retry') {
        throw new Error(`Failed to send template ${purpose} — BullMQ will retry`);
    }
}

async function processReminder(job: Job<ReminderJobPayload>): Promise<void> {
    // Accepts both the generic payload and jobs queued before it, which carry
    // only a bookingId.
    const reminder = normalizeReminderJob(job.data);
    if (!reminder) {
        log.error({ jobId: job.id }, 'Reminder job names no entity — dropping');
        return;
    }
    const { purpose, tenantId, entityType, entityId, customerPhone, variables } = reminder;
    log.info(`Processing reminder for ${entityType} ${entityId}`);

    // Re-check that the entity is still in a state the reminder applies to.
    const state = await reminderStillApplies(prisma, { entityType, entityId, tenantId });
    if (state === 'unknown_entity') {
        log.error({ entityType, tenantId }, 'Reminder for an unregistered entity type — skipping');
        await raiseAlert(prisma, {
            kind: 'notification.unknown_reminder_entity',
            severity: 'warning',
            tenantId,
            message: `A reminder for entity type "${entityType}" was skipped: no check is registered for it.`,
            context: { entityType },
            dedupeKey: `notification.unknown_reminder_entity:${entityType}`,
        });
        return;
    }
    if (state === 'skip') {
        log.info({ entityType, entityId }, 'Entity no longer eligible, skipping reminder');
        return;
    }

    const outcome = await sendByPurpose(tenantId, purpose, customerPhone, variables, {
        bookingId: reminder.bookingId,
        customerId: reminder.customerId,
    });
    if (outcome === 'retry') {
        throw new Error(`Failed to send reminder template — BullMQ will retry`);
    }
}

export function startNotificationWorkers(redisUrl: string | undefined): {
    notifications: Worker | null;
    reminders: Worker | null;
} {
    if (!redisUrl) {
        log.warn('Redis not configured - notification workers disabled');
        return { notifications: null, reminders: null };
    }

    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    const notificationsWorker = new Worker(
        QUEUE_NAMES.NOTIFICATIONS,
        async (job) => processNotification(job),
        { connection, concurrency: 5 },
    );

    notificationsWorker.on('completed', (job) => {
        log.info(`Notification job ${job.id} completed`);
    });
    notificationsWorker.on('failed', (job, err) => {
        log.error({ err: err.message }, `Notification job ${job?.id} failed:`);
    });

    const remindersWorker = new Worker(
        QUEUE_NAMES.REMINDERS,
        async (job) => processReminder(job),
        { connection, concurrency: 5 },
    );

    remindersWorker.on('completed', (job) => {
        log.info(`Reminder job ${job.id} completed`);
    });
    remindersWorker.on('failed', (job, err) => {
        log.error({ err: err.message }, `Reminder job ${job?.id} failed:`);
    });

    log.info('Notification workers started');

    return { notifications: notificationsWorker, reminders: remindersWorker };
}

export async function stopNotificationWorkers(workers: {
    notifications: Worker | null;
    reminders: Worker | null;
}): Promise<void> {
    if (workers.notifications) await workers.notifications.close();
    if (workers.reminders) await workers.reminders.close();
    log.info('Notification workers stopped');
}
