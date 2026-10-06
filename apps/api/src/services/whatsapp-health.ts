/**
 * WhatsApp connection health: every ~6 hours, for each connected number, ask
 * Meta how the number is doing and tell a person when it is not fine.
 *
 * Reads (all with the number's own token: the tenant's for OWN_ACCOUNT/MANUAL,
 * Bookly's platform token for BOOKLY_HOSTED):
 *   GET /{phone-number-id}?fields=quality_rating,messaging_limit_tier,status,name_status,...
 *   GET /debug_token                      (own tokens only: still valid? expiry?)
 *   GET /{waba-id}/subscribed_apps        (own WABAs only: is our app still subscribed?)
 *
 * Alerts (PlatformAlert, deduped per tenant):
 *   whatsapp.disconnected   critical  token invalid/expired, number banned/
 *                                     restricted/flagged/disconnected/deleted,
 *                                     app unsubscribed, platform token missing
 *   whatsapp.quality_low    warning on RED, info on YELLOW
 *   whatsapp.token_expiring warning   7 days before an own token expires
 * An alert is raised when its condition appears or changes; a condition that
 * merely persists does not reopen an alert a person already resolved.
 *
 * MULTI-PROCESS SAFETY: each tenant is claimed with
 *   updateMany WHERE id AND (checkedAt IS NULL OR checkedAt < due) SET checkedAt = now
 * and only the process whose claim returned count 1 checks it. Reading Meta is
 * not a send, so the outbound pause switches do not apply.
 *
 * Tokens are never logged; Graph errors carry Meta's code and message only.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ExtendedPrismaClient } from '../plugins/prisma.js';
import { config } from '../config/index.js';
import { decrypt } from './crypto.js';
import { raiseAlert, type AlertSeverity } from './alerts.js';
import { fetchPhoneHealth, GraphError, inspectToken, isAppSubscribed, type PhoneHealth, type TokenInfo } from './meta-waba.js';
import { parseMode } from './whatsapp-connection.js';

export const HEALTH_INTERVAL_MS = 6 * 60 * 60_000;
export const TOKEN_EXPIRY_WARN_MS = 7 * 24 * 60 * 60_000;
const SWEEP_EVERY_MS = 15 * 60_000;
const BATCH = 25;

export type HealthProblem =
    | 'TOKEN_INVALID'
    | 'TOKEN_EXPIRED'
    | 'PLATFORM_TOKEN_MISSING'
    | 'APP_UNSUBSCRIBED'
    | 'NUMBER_NOT_FOUND'
    | 'NUMBER_BANNED'
    | 'NUMBER_RESTRICTED'
    | 'NUMBER_FLAGGED'
    | 'NUMBER_DISCONNECTED'
    | 'NUMBER_DELETED';

export const PROBLEM_TEXT: Record<HealthProblem, string> = {
    TOKEN_INVALID: 'the access token is no longer valid (revoked, expired or permissions removed)',
    TOKEN_EXPIRED: 'the access token has expired',
    PLATFORM_TOKEN_MISSING: 'it is a Bookly-hosted number but PLATFORM_WHATSAPP_TOKEN is not set',
    APP_UNSUBSCRIBED: 'Bookly is no longer subscribed to its WhatsApp Business Account, so no messages arrive',
    NUMBER_NOT_FOUND: 'Meta no longer returns the phone number (removed or access lost)',
    NUMBER_BANNED: 'Meta has banned the number',
    NUMBER_RESTRICTED: 'Meta has restricted the number',
    NUMBER_FLAGGED: 'Meta has flagged the number for low quality',
    NUMBER_DISCONNECTED: 'Meta reports the number as disconnected',
    NUMBER_DELETED: 'the number was deleted from its WhatsApp Business Account',
};

const STATUS_PROBLEMS: Record<string, HealthProblem> = {
    BANNED: 'NUMBER_BANNED',
    RESTRICTED: 'NUMBER_RESTRICTED',
    FLAGGED: 'NUMBER_FLAGGED',
    DISCONNECTED: 'NUMBER_DISCONNECTED',
    DELETED: 'NUMBER_DELETED',
};

export interface HealthInputs {
    phone: PhoneHealth | null;
    phoneError: GraphError | null;
    token: TokenInfo | null;
    appSubscribed: boolean | null;
    platformTokenMissing: boolean;
    now: Date;
}

export interface HealthAssessment {
    /** Meta could not be reached (network / 5xx): keep what we knew. */
    transient: boolean;
    problem: HealthProblem | null;
    qualitySeverity: AlertSeverity | null;
    tokenExpiringAt: Date | null;
}

/** Pure: what the readings mean. */
export function assessHealth(i: HealthInputs): HealthAssessment {
    const none = { qualitySeverity: null, tokenExpiringAt: null };
    if (i.platformTokenMissing) return { transient: false, problem: 'PLATFORM_TOKEN_MISSING', ...none };
    if (i.phoneError) {
        if (i.phoneError.isAuthFailure) return { transient: false, problem: 'TOKEN_INVALID', ...none };
        if (i.phoneError.httpStatus === 0 || i.phoneError.httpStatus >= 500) return { transient: true, problem: null, ...none };
        return { transient: false, problem: 'NUMBER_NOT_FOUND', ...none };
    }

    const expiresAt = i.token?.expiresAt ?? null;
    let problem: HealthProblem | null = null;
    if (i.token && !i.token.isValid) problem = 'TOKEN_INVALID';
    else if (expiresAt && expiresAt.getTime() <= i.now.getTime()) problem = 'TOKEN_EXPIRED';
    else if (i.phone?.status && STATUS_PROBLEMS[i.phone.status.toUpperCase()]) problem = STATUS_PROBLEMS[i.phone.status.toUpperCase()];
    else if (i.appSubscribed === false) problem = 'APP_UNSUBSCRIBED';

    const rating = i.phone?.qualityRating?.toUpperCase();
    const qualitySeverity: AlertSeverity | null = rating === 'RED' ? 'warning' : rating === 'YELLOW' ? 'info' : null;
    const tokenExpiringAt = expiresAt && !problem && expiresAt.getTime() - i.now.getTime() <= TOKEN_EXPIRY_WARN_MS
        ? expiresAt
        : null;
    return { transient: false, problem, qualitySeverity, tokenExpiringAt };
}

export interface HealthResult {
    checked: boolean;
    skipped?: 'not_found' | 'not_connected' | 'changed';
    transient?: boolean;
    problem: HealthProblem | null;
    qualityRating: string | null;
    messagingLimit: string | null;
    metaStatus: string | null;
    nameStatus: string | null;
    tokenExpiresAt: Date | null;
    checkedAt: Date;
    alerts: string[];
}

const HEALTH_SELECT = {
    id: true, name: true, whatsappPhoneNumberId: true, whatsappAccountId: true, whatsappAccessToken: true,
    whatsappHosted: true, whatsappNumberStatus: true, whatsappConnectionMode: true, whatsappDisplayNumber: true,
    whatsappQualityRating: true, whatsappMessagingLimit: true, whatsappMetaStatus: true, whatsappNameStatus: true,
    whatsappHealthProblem: true, whatsappTokenExpiresAt: true,
} as const;

/** Minimum gap between two quality alerts for one tenant, unless it got worse. */
export const QUALITY_ALERT_MIN_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Raise a quality alert when there is none yet, or when the rating changed and
 * either it got worse (YELLOW -> RED) or the last one is over a day old. A
 * rating flapping GREEN/YELLOW every sweep therefore alerts at most daily.
 */
async function qualityAlertDue(
    prisma: ExtendedPrismaClient,
    dedupeKey: string,
    rating: string,
    previous: string | null,
    severity: AlertSeverity,
    now: Date,
): Promise<boolean> {
    const existing = await prisma.platformAlert.findUnique({ where: { dedupeKey }, select: { lastSeenAt: true, severity: true } });
    if (!existing) return true;
    if (rating === previous) return false;
    if (severity === 'warning' && existing.severity !== 'warning') return true;
    return now.getTime() - existing.lastSeenAt.getTime() >= QUALITY_ALERT_MIN_INTERVAL_MS;
}

async function alertExists(prisma: ExtendedPrismaClient, dedupeKey: string): Promise<boolean> {
    return !!(await prisma.platformAlert.findUnique({ where: { dedupeKey }, select: { id: true } }));
}

async function readMeta(t: { whatsappHosted: boolean; whatsappPhoneNumberId: string; whatsappAccountId: string | null; whatsappAccessToken: string | null }) {
    const platformTokenMissing = t.whatsappHosted && !config.platformWhatsapp.accessToken;
    const result = { phone: null as PhoneHealth | null, phoneError: null as GraphError | null, token: null as TokenInfo | null, appSubscribed: null as boolean | null, platformTokenMissing };
    if (platformTokenMissing) return result;

    let token: string;
    try {
        token = t.whatsappHosted ? config.platformWhatsapp.accessToken! : decrypt(t.whatsappAccessToken ?? '');
    } catch {
        return { ...result, phoneError: new GraphError(401, 190, null, 'OAuthException', 'stored token unreadable') };
    }
    if (!token) return { ...result, phoneError: new GraphError(401, 190, null, 'OAuthException', 'no stored token') };

    try {
        result.phone = await fetchPhoneHealth(t.whatsappPhoneNumberId, token);
    } catch (err) {
        if (!(err instanceof GraphError)) throw err;
        return { ...result, phoneError: err };
    }
    if (!t.whatsappHosted) {
        // Both best-effort: an unreachable debug/subscription endpoint must not
        // be read as "broken".
        result.token = await inspectToken(token).catch(() => null);
        if (t.whatsappAccountId) result.appSubscribed = await isAppSubscribed(t.whatsappAccountId, token).catch(() => null);
    }
    return result;
}

/**
 * Check one tenant now, store the readings and raise alerts. Used by the
 * sweeper (after it has claimed the tenant) and by the admin "Run health
 * check" action.
 */
export async function checkTenantWhatsappHealth(
    prisma: ExtendedPrismaClient,
    tenantId: string,
    opts: { now?: Date; log?: Pick<FastifyBaseLogger, 'warn' | 'error'> } = {},
): Promise<HealthResult> {
    const now = opts.now ?? new Date();
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: HEALTH_SELECT });
    const empty = { problem: null, qualityRating: null, messagingLimit: null, metaStatus: null, nameStatus: null, tokenExpiresAt: null, checkedAt: now, alerts: [] };
    if (!t) return { checked: false, skipped: 'not_found', ...empty };
    const live = !!t.whatsappPhoneNumberId && (!t.whatsappHosted || t.whatsappNumberStatus === 'REGISTERED');
    if (!live) return { checked: false, skipped: 'not_connected', ...empty };

    const readings = await readMeta({ ...t, whatsappPhoneNumberId: t.whatsappPhoneNumberId! });
    const a = assessHealth({ ...readings, now });

    if (a.transient) {
        opts.log?.warn({ tenantId, reason: readings.phoneError?.message }, 'whatsapp health: Meta unreachable, keeping last readings');
        await prisma.tenant.updateMany({ where: { id: tenantId, whatsappPhoneNumberId: t.whatsappPhoneNumberId }, data: { whatsappHealthCheckedAt: now } });
        return {
            checked: true, transient: true, problem: (t.whatsappHealthProblem as HealthProblem | null) ?? null,
            qualityRating: t.whatsappQualityRating, messagingLimit: t.whatsappMessagingLimit, metaStatus: t.whatsappMetaStatus,
            nameStatus: t.whatsappNameStatus, tokenExpiresAt: t.whatsappTokenExpiresAt, checkedAt: now, alerts: [],
        };
    }

    const phone = readings.phone;
    const tokenExpiresAt = t.whatsappHosted ? null : readings.token ? readings.token.expiresAt : t.whatsappTokenExpiresAt;
    const stored = {
        whatsappQualityRating: phone?.qualityRating ?? (a.problem ? t.whatsappQualityRating : null),
        whatsappMessagingLimit: phone?.messagingLimitTier ?? (a.problem ? t.whatsappMessagingLimit : null),
        whatsappMetaStatus: phone?.status ?? (a.problem ? t.whatsappMetaStatus : null),
        whatsappNameStatus: phone?.nameStatus ?? t.whatsappNameStatus,
        ...(phone?.verifiedName ? { whatsappVerifiedName: phone.verifiedName } : {}),
        whatsappHealthProblem: a.problem,
        whatsappHealthCheckedAt: now,
        whatsappTokenExpiresAt: tokenExpiresAt,
    };
    // Write back only if the tenant still has the number we checked: a
    // disconnect or reconnect while Meta was answering must not get these
    // readings (or alerts about the old number).
    const written = await prisma.tenant.updateMany({
        where: { id: tenantId, whatsappPhoneNumberId: t.whatsappPhoneNumberId },
        data: stored,
    });
    if (written.count !== 1) return { checked: false, skipped: 'changed', ...empty };

    const alerts = await raiseHealthAlerts(prisma, t, a, stored.whatsappQualityRating, now);
    if (a.problem) opts.log?.warn({ tenantId, problem: a.problem }, 'whatsapp health problem');

    return {
        checked: true,
        problem: a.problem,
        qualityRating: stored.whatsappQualityRating,
        messagingLimit: stored.whatsappMessagingLimit,
        metaStatus: stored.whatsappMetaStatus,
        nameStatus: stored.whatsappNameStatus,
        tokenExpiresAt,
        checkedAt: now,
        alerts,
    };
}

async function raiseHealthAlerts(
    prisma: ExtendedPrismaClient,
    t: { id: string; name: string; whatsappPhoneNumberId: string | null; whatsappDisplayNumber: string | null; whatsappHosted: boolean; whatsappConnectionMode: string | null; whatsappHealthProblem: string | null; whatsappQualityRating: string | null },
    a: HealthAssessment,
    qualityRating: string | null,
    now: Date,
): Promise<string[]> {
    const raised: string[] = [];
    const mode = parseMode(t.whatsappConnectionMode) ?? (t.whatsappHosted ? 'BOOKLY_HOSTED' : 'OWN_ACCOUNT');
    const context = { phoneNumberId: t.whatsappPhoneNumberId, displayNumber: t.whatsappDisplayNumber, mode };
    const who = `${t.name}${t.whatsappDisplayNumber ? ` (${t.whatsappDisplayNumber})` : ''}`;

    if (a.problem) {
        const dedupeKey = `whatsapp.disconnected:${t.id}`;
        if (a.problem !== t.whatsappHealthProblem || !(await alertExists(prisma, dedupeKey))) {
            await raiseAlert(prisma, {
                kind: 'whatsapp.disconnected', severity: 'critical', tenantId: t.id, dedupeKey,
                message: `WhatsApp for ${who} has stopped working: ${PROBLEM_TEXT[a.problem]}.`,
                context: { ...context, problem: a.problem },
            });
            raised.push('whatsapp.disconnected');
        }
    }

    if (a.qualitySeverity && qualityRating) {
        const dedupeKey = `whatsapp.quality_low:${t.id}`;
        if (await qualityAlertDue(prisma, dedupeKey, qualityRating, t.whatsappQualityRating, a.qualitySeverity, now)) {
            await raiseAlert(prisma, {
                kind: 'whatsapp.quality_low', severity: a.qualitySeverity, tenantId: t.id, dedupeKey,
                message: `WhatsApp quality rating for ${who} is ${qualityRating}. ${qualityRating === 'RED' ? 'Meta may limit or flag the number soon.' : 'Watch for complaints and blocks.'}`,
                context: { ...context, qualityRating },
            });
            raised.push('whatsapp.quality_low');
        }
    }

    if (a.tokenExpiringAt) {
        const day = a.tokenExpiringAt.toISOString().slice(0, 10);
        const dedupeKey = `whatsapp.token_expiring:${t.id}:${day}`;
        if (!(await alertExists(prisma, dedupeKey))) {
            await raiseAlert(prisma, {
                kind: 'whatsapp.token_expiring', severity: 'warning', tenantId: t.id, dedupeKey,
                message: `The WhatsApp access token for ${who} expires on ${day}. The organisation must reconnect WhatsApp before then.`,
                context: { ...context, expiresAt: a.tokenExpiringAt.toISOString() },
            });
            raised.push('whatsapp.token_expiring');
        }
    }
    return raised;
}

/** One sweep: claim up to BATCH due tenants and check each. */
export async function sweepWhatsappHealth(
    prisma: ExtendedPrismaClient,
    log?: Pick<FastifyBaseLogger, 'warn' | 'error'>,
    now: Date = new Date(),
): Promise<{ checked: number; problems: number }> {
    const due = new Date(now.getTime() - HEALTH_INTERVAL_MS);
    const dueWhere = { OR: [{ whatsappHealthCheckedAt: null }, { whatsappHealthCheckedAt: { lt: due } }] };
    const candidates = await prisma.tenant.findMany({
        where: {
            isActive: true,
            whatsappPhoneNumberId: { not: null },
            AND: [{ OR: [{ whatsappHosted: false }, { whatsappNumberStatus: 'REGISTERED' }] }, dueWhere],
        },
        orderBy: [{ whatsappHealthCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: BATCH,
        select: { id: true },
    });

    let checked = 0;
    let problems = 0;
    for (const { id } of candidates) {
        const claim = await prisma.tenant.updateMany({ where: { id, ...dueWhere }, data: { whatsappHealthCheckedAt: now } });
        if (claim.count !== 1) continue; // another process has it
        try {
            const r = await checkTenantWhatsappHealth(prisma, id, { now, log });
            if (r.checked) checked += 1;
            if (r.problem) problems += 1;
        } catch (err) {
            log?.error({ err: (err as Error).message, tenantId: id }, 'whatsapp health check failed');
        }
    }
    return { checked, problems };
}

export function startWhatsappHealthSweeper(prisma: ExtendedPrismaClient, log: FastifyBaseLogger): () => void {
    const run = () => {
        sweepWhatsappHealth(prisma, log).catch((err) => log.error({ err }, 'WhatsApp health sweep failed'));
    };
    const timer = setInterval(run, SWEEP_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
}
