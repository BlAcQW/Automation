/**
 * Support access (A5): a platform admin looks at one tenant, with a stated
 * reason, for a bounded time, read-only.
 *
 * A SupportSession row is the grant. It yields a SHORT-LIVED token (type
 * "support") that plugins/auth.ts accepts ONLY on the read routes listed in
 * SUPPORT_READ_ROUTES below (deny by default: a new route is unreachable to
 * support until someone adds it here on purpose), re-checking on every request
 * that the session is still live and the admin still entitled. The token is not
 * an access token, so nothing that accepts access tokens (the websocket,
 * refresh) accepts it. Every request made with it, allowed or refused, is
 * audited.
 *
 * Privacy while support reads: contacts in structured fields are always masked
 * (resolveMaskPolicy takes the support flag). Message TEXT is readable, because
 * diagnosing a conversation needs it; the free text itself is not rewritten.
 */
import type { AnyPrismaClient } from './usage.js';
import { can, resolveAdminRole, type AdminRole } from './admin-permissions.js';

export const MAX_SUPPORT_MINUTES = 60;
export const DEFAULT_SUPPORT_MINUTES = 30;
export const SUPPORT_TOKEN_MAX_SECONDS = 15 * 60;
const MIN_REASON = 5;
const MAX_REASON = 300;

/**
 * The ONLY routes a support token may reach, by resolved route pattern
 * (`request.routeOptions.url`, never the raw path) and only for GET.
 *
 * Included: the tenant's day-to-day read views, all of which mask contacts for
 * support. Deliberately NOT included (and why):
 *   /calendar/**        connect hands out a signed OAuth state; callback binds a calendar
 *   /payments/**        payment links, provider keys
 *   /whatsapp/**        number onboarding / tokens
 *   /channels/**        connect flows, tokens
 *   /users/**           team members, invites
 *   /money/**           balances, payout destinations
 *   /developer/**       API keys, webhooks
 *   /webhooks/**        inbound provider traffic
 *   /billing/**         plans and invoices
 *   /conversations/:id/media/:messageId   raw customer media
 *   /bookings/by-reference/:ref, /bookings/customer/:phone   lookups by contact (the first returns the booking unmasked)
 *   /notifications (list)   free-text rows that can embed customer contacts
 *   /privacy/reveal*    would unmask (POST anyway)
 */
export const SUPPORT_READ_ROUTES: readonly string[] = [
    '/auth/me',
    '/dashboard/stats',
    '/bookings',
    '/bookings/upcoming',
    '/bookings/:id',
    '/conversations',
    '/conversations/human-active',
    '/conversations/pending',
    '/conversations/:id',
    '/conversations/:id/messages',
    '/customers',
    '/customers/stats',
    '/services',
    '/services/active',
    '/services/categories',
    '/services/:id',
    '/availability/hours',
    '/availability/blackouts',
    '/availability/slots',
    '/orders',
    '/orders/recent',
    '/orders/stats',
    '/orders/:id',
    '/orders/by-reference/:ref',
    '/products',
    '/products/active',
    '/products/categories',
    '/products/:id',
    '/notifications/unread-count',
    '/templates',
    '/templates/:id',
    '/privacy/policy',
];

const SUPPORT_READ_SET = new Set(SUPPORT_READ_ROUTES);

/** Is this resolved route pattern one support may read? Unknown / undefined is NOT. */
export function isSupportReadRoute(routePattern: string | undefined | null): boolean {
    if (!routePattern) return false;
    const normal = routePattern.length > 1 && routePattern.endsWith('/') ? routePattern.slice(0, -1) : routePattern;
    return SUPPORT_READ_SET.has(normal);
}

export class SupportSessionError extends Error {
    constructor(public readonly code: 'reason_required' | 'bad_duration' | 'tenant_not_found', message: string) {
        super(message);
        this.name = 'SupportSessionError';
    }
}

export interface StartSupportArgs {
    adminId: string;
    tenantId: string;
    reason: string;
    minutes?: number;
}

export async function startSupportSession(prisma: AnyPrismaClient, args: StartSupportArgs, now: Date = new Date()) {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (reason.length < MIN_REASON) {
        throw new SupportSessionError('reason_required', `A reason of at least ${MIN_REASON} characters is required`);
    }
    const minutes = args.minutes ?? DEFAULT_SUPPORT_MINUTES;
    if (!Number.isInteger(minutes) || minutes < 1) {
        throw new SupportSessionError('bad_duration', 'Duration must be a whole number of minutes');
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: args.tenantId }, select: { id: true } });
    if (!tenant) throw new SupportSessionError('tenant_not_found', 'Organisation not found');

    // At most one live session per admin per tenant.
    await prisma.supportSession.updateMany({
        where: { adminId: args.adminId, tenantId: args.tenantId, endedAt: null, expiresAt: { gt: now } },
        data: { endedAt: now },
    });
    return prisma.supportSession.create({
        data: {
            adminId: args.adminId,
            tenantId: args.tenantId,
            reason: reason.slice(0, MAX_REASON),
            // Not a parameter on purpose: WRITE support access is not offered.
            mode: 'READ_ONLY',
            expiresAt: new Date(now.getTime() + Math.min(minutes, MAX_SUPPORT_MINUTES) * 60_000),
        },
    });
}

/** The session if it is live for this tenant and its admin is still active. */
export async function findLiveSession(
    prisma: AnyPrismaClient,
    sessionId: string,
    tenantId: string,
    now: Date = new Date(),
) {
    const session = await prisma.supportSession.findFirst({
        where: { id: sessionId, tenantId, endedAt: null, expiresAt: { gt: now } },
        include: { admin: { select: SESSION_ADMIN_SELECT } },
    });
    if (!session || !session.admin?.isActive) return null;
    return session;
}

/** The admin facts re-checked on every support request. */
const SESSION_ADMIN_SELECT = { isActive: true, role: true, isSuperAdmin: true, totpEnabledAt: true } as const;

export type SupportEntitlement = { ok: true } | { ok: false; reason: 'inactive' | 'no_support_permission' | 'two_factor_required' };

/**
 * Is this admin STILL allowed to act through a support session? Checked on
 * every request, so demoting an admin (to FINANCE/READONLY, which lack
 * support:access), deactivating them, or turning on the platform's 2FA
 * requirement takes effect immediately rather than when the session expires.
 */
export function checkSupportEntitlement(
    admin: { isActive?: boolean | null; role?: string | null; isSuperAdmin?: boolean | null; totpEnabledAt?: Date | null } | null | undefined,
    twoFactorRequired: boolean,
): SupportEntitlement {
    if (!admin || !admin.isActive) return { ok: false, reason: 'inactive' };
    if (!can(resolveAdminRole(admin), 'support:access')) return { ok: false, reason: 'no_support_permission' };
    if (twoFactorRequired && !admin.totpEnabledAt) return { ok: false, reason: 'two_factor_required' };
    return { ok: true };
}

/** A live session by id that belongs to this admin (for minting a fresh token). */
export async function findOwnLiveSession(
    prisma: AnyPrismaClient,
    sessionId: string,
    adminId: string,
    now: Date = new Date(),
) {
    const session = await prisma.supportSession.findFirst({
        where: { id: sessionId, adminId, endedAt: null, expiresAt: { gt: now } },
        include: { admin: { select: { isActive: true } } },
    });
    // The where clause already scopes to this admin; re-check so a changed query can never hand out someone else's session.
    if (!session || session.adminId !== adminId || !session.admin?.isActive) return null;
    return session;
}

export async function endSupportSession(
    prisma: AnyPrismaClient,
    sessionId: string,
    by: { adminId: string; role: AdminRole },
    now: Date = new Date(),
): Promise<boolean> {
    const res = await prisma.supportSession.updateMany({
        where: {
            id: sessionId,
            endedAt: null,
            // Only an OWNER may end somebody else's session.
            ...(by.role === 'OWNER' ? {} : { adminId: by.adminId }),
        },
        data: { endedAt: now },
    });
    return res.count > 0;
}

export function supportTokenTtlSeconds(session: { expiresAt: Date }, now: Date = new Date()): number {
    const remaining = Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000);
    return Math.max(0, Math.min(SUPPORT_TOKEN_MAX_SECONDS, remaining));
}

export function supportTokenPayload(session: { id: string; adminId: string; tenantId: string }) {
    return {
        // Not a real User id: a lookup by it finds nothing, so support cannot be
        // mistaken for (or act as) a tenant user.
        userId: `support:${session.adminId}`,
        tenantId: session.tenantId,
        // Least privilege: the staff view, not the owner's.
        role: 'STAFF' as const,
        type: 'support' as const,
        support: { sessionId: session.id, adminId: session.adminId },
    };
}

export async function listSupportSessions(
    prisma: AnyPrismaClient,
    q: { tenantId?: string; adminId?: string; limit?: number },
) {
    const take = Math.min(Math.max(q.limit ?? 50, 1), 100);
    return prisma.supportSession.findMany({
        where: { ...(q.tenantId ? { tenantId: q.tenantId } : {}), ...(q.adminId ? { adminId: q.adminId } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
            id: true, adminId: true, tenantId: true, reason: true, mode: true,
            createdAt: true, expiresAt: true, endedAt: true,
            admin: { select: { name: true, email: true } },
            tenant: { select: { name: true } },
        },
    });
}
