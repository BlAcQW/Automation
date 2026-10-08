import Link from 'next/link';
import { Check } from 'lucide-react';
import { Nav, Footer, MobileCTA } from '@/components/marketing/site/chrome';
import { PageHero, Section, ClosingCTA } from '@/components/marketing/site/pieces';
import { Reveal, LiftCard } from '@/components/marketing/site/motion';

export const metadata = {
    title: 'Pricing — Bookly',
    description: 'Solo, Team and Enterprise. Prices announced shortly; free to start.',
};

/** Light tiers: a raised panel on the paper inset. */
const PLAIN_CARD: React.CSSProperties = {
    background: '#FBFAF7',
    boxShadow: '0 14px 30px -22px rgba(20,26,22,0.45), 0 0 0 1px var(--border)',
};

/**
 * The featured tier is a dark forest card. It re-scopes the text tokens so
 * the children (written against --foreground / --muted-foreground) read
 * cream-on-forest.
 */
const FEATURED_CARD: React.CSSProperties = {
    background: 'var(--forest-card)',
    color: 'var(--forest-cream)',
    boxShadow: '0 30px 50px -28px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
    ['--foreground' as string]: 'var(--forest-cream)',
    ['--muted-foreground' as string]: 'rgba(236,235,225,0.62)',
    ['--border' as string]: 'rgba(236,235,225,0.12)',
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
        <main id="main" className="theme-site">
            <Nav />
            <PageHero
                eyebrow="Pricing"
                title="Three plans. Numbers coming soon."
                sub="We're still setting the prices. What we can tell you now is the shape — and that there's a free way to start."
            />

            <Section tint>
                <Reveal className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
                    {tiers.map((t) => (
                        <LiftCard
                            key={t.name}
                            className="flex flex-col rounded-[6px] p-7"
                            style={t.featured ? FEATURED_CARD : PLAIN_CARD}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-[26px] font-normal leading-none tracking-[-0.04em]" style={{ color: 'var(--foreground)' }}>{t.name}</h2>
                                {t.featured && (
                                    // Inside the paper inset fs-badge turns night; pin it cream on the dark card.
                                    <span className="fs-badge" style={{ background: 'var(--forest-cream)', color: 'var(--forest-night)' }}>
                                        Most shops
                                    </span>
                                )}
                            </div>
                            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>{t.who}</p>

                            <p className="mt-8 text-[2.1rem] font-light leading-none tracking-[-0.045em]" style={{ color: 'var(--foreground)' }}>Coming soon</p>
                            <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>Pricing announced shortly</p>

                            <ul className="mt-6 flex-1 space-y-2.5 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
                                {t.points.map((p) => (
                                    <li key={p} className="flex gap-2.5 text-[14px]" style={{ color: 'var(--foreground)' }}>
                                        <Check
                                            className="mt-0.5 h-4 w-4 shrink-0"
                                            style={{ color: t.featured ? 'var(--forest-glow)' : 'var(--forest-brand)' }}
                                        />
                                        {p}
                                    </li>
                                ))}
                            </ul>

                            <Link
                                href="/register"
                                className={`fs-btn fs-btn--wide mt-8 ${t.featured ? 'fs-btn--cream' : 'fs-btn--brand'}`}
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
