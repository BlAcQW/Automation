import Link from 'next/link';
import { Check } from 'lucide-react';
import { Nav, Footer, MobileCTA } from '@/components/marketing/bronze/chrome';
import { PageHero, Section, ClosingCTA } from '@/components/marketing/bronze/pieces';
import { Reveal, LiftCard } from '@/components/marketing/bronze/motion';

export const metadata = {
    title: 'Pricing — Bookly',
    description: 'Solo, Team and Enterprise. Prices announced shortly; free to start.',
};

/**
 * Pricing, deliberately unpriced. The tiers are named and shaped so a reader
 * can place themselves; the numbers wait until the product can show what it
 * recovers in no-shows.
 */
export default function PricingPage() {
    const tiers = [
        { name: 'Solo', who: 'One person, one chair', points: ['The assistant on all channels', 'Deposits and reminders', 'Mobile app', 'Your own diary'], featured: false },
        { name: 'Team', who: '2–8 people', points: ['Everything in Solo', 'Staff logins', 'Customer numbers hidden from staff', 'Shared inbox'], featured: true },
        { name: 'Enterprise', who: 'Groups and resellers', points: ['Everything in Team', 'Your own branding', 'Several locations', 'Priority support'], featured: false },
    ];

    return (
        <main id="main" className="theme-bronze min-h-screen">
            <Nav />
            <PageHero
                eyebrow="Pricing"
                title="Three plans. Numbers coming soon."
                sub="We're still setting the prices. What we can tell you now is the shape — and that there's a free way to start."
            />

            <Section>
                <Reveal className="grid gap-4 lg:grid-cols-3">
                    {tiers.map((t) => (
                        <LiftCard
                            key={t.name}
                            className="flex flex-col rounded-2xl p-7"
                            style={{
                                background: t.featured ? 'var(--secondary)' : 'var(--card)',
                                border: `1px solid ${t.featured ? 'var(--primary)' : 'var(--border)'}`,
                            }}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>{t.name}</h2>
                                {t.featured && (
                                    <span
                                        className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                                        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                                    >
                                        Most shops
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>{t.who}</p>

                            <p className="mt-6 text-2xl font-semibold" style={{ color: 'var(--primary)' }}>Coming soon</p>
                            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Pricing announced shortly</p>

                            <ul className="mt-6 flex-1 space-y-2.5">
                                {t.points.map((p) => (
                                    <li key={p} className="flex gap-2.5 text-[14px]" style={{ color: 'var(--foreground)' }}>
                                        <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--primary)' }} />
                                        {p}
                                    </li>
                                ))}
                            </ul>

                            <Link
                                href="/register"
                                className="mt-7 inline-flex min-h-[48px] items-center justify-center rounded-xl text-sm font-semibold"
                                style={t.featured
                                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                                    : { border: '1px solid var(--border)', color: 'var(--foreground)' }}
                            >
                                Start free
                            </Link>
                        </LiftCard>
                    ))}
                </Reveal>

                <p className="mt-8 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                    You pay Meta&apos;s own message rates directly on WhatsApp — we add nothing on
                    top. Instagram and Messenger cost nothing at all.
                </p>
            </Section>

            <ClosingCTA title="Start free while we finish the pricing." sub="No card, and nothing to set up first." />
            <Footer />
            <MobileCTA />
        </main>
    );
}
