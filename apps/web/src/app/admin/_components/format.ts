/** Small display helpers shared by the admin pages. */

/** Minor units (pesewas/kobo/cents) as "GHS 1,234.50". */
export function formatMinor(amountMinor: number | null | undefined, currency: string | null | undefined): string {
    const value = (amountMinor ?? 0) / 100;
    const code = currency || '';
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: code || 'GHS', currencyDisplay: 'code' }).format(value);
    } catch {
        return `${code} ${value.toFixed(2)}`.trim();
    }
}

export function formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB');
}

export function formatDate(value: string | Date | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB');
}

/** "3h ago", "2d ago". */
export function timeAgo(value: string | Date | null | undefined, now: number = Date.now()): string {
    if (!value) return '—';
    const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** 0.1234 -> "12.3%"; null -> "—". */
export function formatRate(rate: number | null | undefined): string {
    return rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(1)}%`;
}

/** Message from an axios error, or a fallback. */
export function errorMessage(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { message?: string } } };
    return e?.response?.data?.message ?? fallback;
}

export const ROLE_LABEL: Record<string, string> = {
    OWNER: 'Owner',
    FINANCE: 'Finance',
    SUPPORT: 'Support',
    READONLY: 'Read-only',
};
