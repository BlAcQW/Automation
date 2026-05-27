import Link from 'next/link';
import { BooklyWordmark } from './bookly-wordmark';

const COLUMNS = [
    {
        heading: 'Product',
        links: [
            { label: 'Features', href: '#features' },
            { label: 'How it works', href: '#how' },
            { label: 'Pricing', href: '#pricing' },
            { label: 'Changelog', href: '#' },
        ],
    },
    {
        heading: 'Resources',
        links: [
            { label: 'Documentation', href: '#' },
            { label: 'WhatsApp setup', href: '#' },
            { label: 'Bot patterns', href: '#' },
            { label: 'Status page', href: '#' },
        ],
    },
    {
        heading: 'Company',
        links: [
            { label: 'About', href: '#' },
            { label: 'Customers', href: '#' },
            { label: 'Careers', href: '#' },
            { label: 'Contact', href: '#' },
        ],
    },
    {
        heading: 'Legal',
        links: [
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
            { label: 'Cookies', href: '#' },
            { label: 'DPA', href: '#' },
        ],
    },
];

/**
 * CinematicFooter — ui.md §7.9. Oversized footer with the Bookly wordmark
 * faintly behind the link columns, status dot on the bottom row.
 */
export function CinematicFooter() {
    return (
        <footer className="relative overflow-hidden border-t border-ink-700 bg-ink-1000 pt-20 pb-10">
            {/* Massive faint wordmark backdrop — clamped so it never overflows
                a small viewport horizontally. Scales fluidly from 8rem on phones
                to 28rem on large desktop. */}
            <div
                aria-hidden
                className="absolute -bottom-2 sm:-bottom-8 left-1/2 -translate-x-1/2 opacity-[0.045] pointer-events-none whitespace-nowrap overflow-hidden"
            >
                <span
                    className="font-display font-bold leading-none tracking-tighter text-ink-50"
                    style={{ fontSize: 'clamp(8rem, 30vw, 28rem)' }}
                >
                    Bookly
                </span>
            </div>

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8 sm:gap-10">
                    {/* Brand cell — spans 1 col on md, 2 on mobile */}
                    <div className="col-span-2 md:col-span-1">
                        <Link href="/" className="inline-block">
                            <BooklyWordmark size="lg" />
                        </Link>
                        <p className="mt-4 text-body-sm text-ink-300 max-w-xs">
                            WhatsApp-first SaaS for small businesses across Africa.
                        </p>
                    </div>

                    {COLUMNS.map((col) => (
                        <div key={col.heading}>
                            <h4 className="text-caption uppercase tracking-wider text-ink-300 mb-4">
                                {col.heading}
                            </h4>
                            <ul className="space-y-2.5">
                                {col.links.map((l) => (
                                    <li key={l.label}>
                                        <Link
                                            href={l.href}
                                            className="text-body-sm text-ink-100 hover:text-bookly-emerald-400 transition-colors"
                                        >
                                            {l.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-16 pt-6 border-t border-ink-700/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <p className="text-caption uppercase tracking-wider text-ink-300">
                        © {new Date().getFullYear()} Bookly. All rights reserved.
                    </p>
                    <div className="flex items-center gap-2 text-caption uppercase tracking-wider text-ink-300">
                        <span className="status-dot" />
                        All systems operational
                    </div>
                </div>
            </div>
        </footer>
    );
}
