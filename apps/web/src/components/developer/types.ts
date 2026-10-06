/** Shapes returned by the API's /developer routes (apps/api/src/routes/developer). */

export type ApiKeyStatus = 'active' | 'expiring' | 'expired' | 'revoked';

export interface ApiKey {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    /** Set while a rotated key is in its grace period; it stops working at this time. */
    expiresAt: string | null;
    rotatedFromId: string | null;
    createdAt: string;
    status: ApiKeyStatus;
}

export interface ScopeInfo {
    scope: string;
    description: string;
}

export interface ExternalApp {
    name: string;
    url: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

/** Grace periods offered when rotating a key (hours; 0 = revoke the old key now). */
export const GRACE_OPTIONS = [
    { hours: 0, label: 'Now', hint: 'The old key stops working immediately.' },
    { hours: 1, label: '1 hour', hint: 'Enough to update one server.' },
    { hours: 24, label: '24 hours', hint: 'Recommended: time to deploy everywhere.' },
    { hours: 168, label: '7 days', hint: 'For clients you cannot update quickly.' },
] as const;

export const DEFAULT_GRACE_HOURS = 24;

export function maskedPrefix(prefix: string): string {
    return `bk_live_${prefix}…`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 3h", "in 45m", "in 6d" — for a future timestamp. */
export function timeUntil(iso: string, now: number = Date.now()): string {
    const ms = new Date(iso).getTime() - now;
    if (ms <= 0) return 'now';
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
    if (ms < 2 * DAY) return `${Math.round(ms / HOUR)}h`;
    return `${Math.round(ms / DAY)}d`;
}

/** "just now", "5 min ago", "3 h ago", "12 Oct 2026". */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
    if (!iso) return 'Never';
    const ms = now - new Date(iso).getTime();
    if (ms < MINUTE) return 'Just now';
    if (ms < HOUR) return `${Math.round(ms / MINUTE)} min ago`;
    if (ms < DAY) return `${Math.round(ms / HOUR)} h ago`;
    if (ms < 7 * DAY) return `${Math.round(ms / DAY)} d ago`;
    return formatDate(iso);
}

export function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function errorText(err: unknown, fallback: string): string {
    const message = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return typeof message === 'string' && message ? message : fallback;
}
