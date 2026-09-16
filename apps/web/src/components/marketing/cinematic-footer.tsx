import Link from 'next/link';
import { BooklyWordmark } from './bookly-wordmark';

/**
 * Only links that go somewhere. A footer full of "Changelog", "Careers"
 * and "Status page" pointing at `#` tells a careful visitor the site was
 * generated, not built.
 */
const COLUMNS = [
    {
        heading: 'Product',
        links: [
            { label: 'Features', href: '#features' },
            { label: 'How it works', href: '#how' },
            { label: 'Pricing', href: '#pricing' },
        ],
    },
    {
        heading: 'Account',
        links: [
            { label: 'Sign in', href: '/login' },
            { label: 'Start free', href: '/register' },
        ],
    },
    {
        heading: 'Legal',
        links: [
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
        ],
    },
];

export function CinematicFooter() {
    return (
        <footer className="relative overflow-hidden border-t border-ink-700 bg-ink-1000 pt-16 pb-10">
            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8 sm:gap-10">
                    <div className="col-span-2">
                        <Link href="/" className="inline-block">
                            <BooklyWordmark size="lg" />
                        </Link>
                        <p className="mt-4 text-body-sm text-ink-300 max-w-[36ch]">
                            WhatsApp bookings for salons, clinics, studios and every other business that lives in its inbox.
                        </p>
                    </div>

                    {COLUMNS.map((col) => (
                        <div key={col.heading}>
                            <h4 className="text-[13px] font-semibold text-ink-100 mb-4">
                                {col.heading}
                            </h4>
                            <ul className="space-y-2.5">
                                {col.links.map((l) => (
                                    <li key={l.label}>
                                        <Link
                                            href={l.href}
                                            className="text-body-sm text-ink-300 hover:text-ink-50 transition-colors"
                                        >
                                            {l.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-14 pt-6 border-t border-ink-700/60">
                    <p className="text-[13px] text-ink-300">
                        &copy; {new Date().getFullYear()} Bookly. Made in Accra.
                    </p>
                </div>
            </div>
        </footer>
    );
}
