import type { ReactNode } from 'react';
import { AwningDivider, BrandLogo, cn, formatCedi } from '@bookingflow/ui';

/**
 * Shell for the public, customer-facing pages (pay result, order tracking,
 * cancel link). These are opened from a WhatsApp message by a business's
 * customers, often on small, cheap phones — so: light, one 440px column,
 * big readable type, the BUSINESS as the hero and Bookly only as a small
 * "Powered by" line at the bottom.
 *
 * The `light` class pins the cream theme whatever the browser last stored
 * for the dashboard (a business owner previewing their own link).
 */
export function PublicPage({ children }: { children: ReactNode }) {
    return (
        <main
            id="main"
            className="light flex min-h-screen flex-col bg-bg text-text [color-scheme:light]"
        >
            <AwningDivider size="sm" />
            <div className="flex w-full flex-1 justify-center px-4 pb-8 pt-6 sm:pt-12">
                <div className="flex w-full max-w-[440px] flex-col">
                    {children}
                    <PoweredBy />
                </div>
            </div>
        </main>
    );
}

function PoweredBy() {
    return (
        <p className="mt-8 flex items-center justify-center gap-1.5 text-small text-muted">
            <span>Powered by</span>
            <BrandLogo size="sm" className="[&>span]:text-[16px]" />
        </p>
    );
}

/** The page's main card. */
export function PublicCard({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <section className={cn('rounded-card-lg border border-border bg-surface p-5 shadow-card sm:p-8', className)}>
            {children}
        </section>
    );
}

/**
 * The business is the hero: an initial badge + the business name in Clash.
 * Not a heading — each page keeps exactly one h1 for its status message.
 */
export function BusinessHero({ name }: { name?: string | null }) {
    if (!name) return null;
    const initial = name.trim().charAt(0).toUpperCase() || '•';
    return (
        <div className="mb-5 flex items-center gap-3">
            <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-primary-soft font-display text-[22px] font-semibold text-primary"
            >
                {initial}
            </span>
            <p className="min-w-0 break-words font-display text-[24px] font-semibold leading-tight text-text sm:text-[28px]">
                {name}
            </p>
        </div>
    );
}

/** Soft panel of label/value rows — the facts the customer came to check. */
export function FactList({ rows, className }: { rows: Array<[label: string, value: ReactNode]>; className?: string }) {
    return (
        <dl className={cn('divide-y divide-border rounded-card border border-border bg-surface-2', className)}>
            {rows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="shrink-0 text-small text-muted">{label}</dt>
                    <dd className="min-w-0 break-words text-right text-body font-semibold tabular-nums text-text">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Money in GH₵ by default; other tenant currencies keep their own code. */
export function formatMoney(amount: number, currency?: string | null): string {
    if (!currency || currency.toUpperCase() === 'GHS') return formatCedi(amount);
    try {
        const { format: toText } = new Intl.NumberFormat('en-GH', { style: 'currency', currency });
        return toText(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

/** "Sat, 14 Nov 2026, 10:00" — Ghana English, short and unambiguous. */
export function formatWhen(iso: string): string {
    return new Date(iso).toLocaleString('en-GH', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export const publicTitle = 'text-[24px] font-bold leading-tight text-text sm:text-[28px]';
export const publicBody = 'text-body leading-relaxed text-muted';
