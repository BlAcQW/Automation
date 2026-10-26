import { formatCedi } from '@bookingflow/ui';

/**
 * Money shown in the signed-in app. Cedis (the default for Bookly) render as
 * `GH₵ 1,250.00` via formatCedi; a tenant charging in another currency keeps
 * its ISO code (`USD 12.00`) so the figure is never mislabelled.
 */
export function displayMoney(
    amount: number | string | null | undefined,
    currency = 'GHS',
    { compact = false }: { compact?: boolean } = {},
): string {
    if (!currency || currency.toUpperCase() === 'GHS') return formatCedi(amount, { compact });
    if (amount === null || amount === undefined || amount === '') return '—';
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    const digits = compact && Number.isInteger(n) ? 0 : 2;
    return `${currency.toUpperCase()} ${n.toLocaleString('en-GH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
