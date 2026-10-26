import Link from 'next/link';
import { SITE_TAGLINE } from '@/lib/site';
import { SiteLogo } from './site-logo';
import { Container } from './primitives';

const COLUMNS = [
    {
        h: 'Product',
        links: [
            ['What it does', '/features'],
            ['WhatsApp bookings', '/features/whatsapp-bookings'],
            ['Pricing', '/pricing'],
            ['Questions', '/faq'],
        ],
    },
    {
        h: 'Made for',
        links: [
            ['Salons and barbers', '/for/salons'],
            ['Boutiques and tailors', '/for/boutiques'],
            ['Food vendors', '/for/food-vendors'],
        ],
    },
    {
        h: 'Bookly',
        links: [
            ['About and contact', '/about'],
            ['Support', '/support'],
            ['Log in', '/login'],
            ['Start free', '/register'],
        ],
    },
    {
        h: 'Legal',
        links: [
            ['Privacy', '/privacy'],
            ['Terms', '/terms'],
        ],
    },
] as const;

/** Site footer on charcoal. Server-rendered, links only. */
export function SiteFooter() {
    return (
        <footer className="bg-charcoal text-cream">
            <Container className="py-12 sm:py-16">
                <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
                    <div className="max-w-xs">
                        <SiteLogo tone="inverse" size="md" />
                        <p className="mt-3 font-display text-xl font-semibold text-cream">{SITE_TAGLINE}</p>
                        <p className="mt-2 text-small text-cream/80">
                            Bookings, deposits and reminders on WhatsApp, for small businesses in Ghana.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-4">
                        {COLUMNS.map((c) => (
                            <div key={c.h}>
                                <h2 className="text-small font-semibold text-cream">{c.h}</h2>
                                <ul className="mt-2">
                                    {c.links.map(([label, href]) => (
                                        <li key={href}>
                                            <Link
                                                href={href}
                                                data-analytics={href === '/register' ? 'Signup' : undefined}
                                                className="inline-flex min-h-[44px] items-center text-[15px] text-cream/80 underline-offset-4 transition-colors duration-ui hover:text-cream hover:underline"
                                            >
                                                {label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="mt-12 flex flex-col gap-2 border-t border-cream/15 pt-6 text-small text-cream/80 sm:flex-row sm:justify-between">
                    <p>© {new Date().getFullYear()} Bookly. All rights reserved.</p>
                    <p>Made in Ghana.</p>
                </div>
            </Container>
        </footer>
    );
}
