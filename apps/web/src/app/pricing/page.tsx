import Link from 'next/link';
import { Check } from 'lucide-react';
import { cx as cn } from '@/components/marketing/cx';
import { SiteShell } from '@/components/marketing/site-shell';
import { ButtonLink, ClosingCTA, PageHero, Section, SectionTitle, motionStyles as m } from '@/components/marketing/primitives';
import { FaqList } from '@/components/marketing/sections';
import { PRICING_FAQ } from '@/components/marketing/content';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, softwareApplicationJsonLd } from '@/lib/seo';
import { LEGAL_EMAIL, supportWhatsAppUrl } from '@/lib/site';

const CRUMBS = [{ name: 'Pricing', path: '/pricing' }];

export const metadata = pageMetadata({
    title: 'Bookly pricing: Solo, Team and Enterprise plans',
    description:
        'Three plans for shops of every size in Ghana. Prices are coming soon, and you can start free today with no card and nothing to set up.',
    path: '/pricing',
});

const TIERS = [
    { name: 'Solo', who: 'One person, one chair', points: ['Bookly on WhatsApp, Instagram and Messenger', 'Deposits and reminders', 'Mobile app', 'Your own diary'], featured: false },
    { name: 'Team', who: '2 to 8 people', points: ['Everything in Solo', 'Staff logins', 'Customer numbers hidden from staff', 'Shared inbox'], featured: true },
    { name: 'Enterprise', who: 'Groups and resellers', points: ['Everything in Team', 'Your own branding', 'Several locations', 'Priority support'], featured: false },
] as const;

/**
 * Pricing, deliberately unpriced. The tiers are named and shaped so a reader
 * can place themselves; no GH₵ figures until real prices exist (and the
 * SoftwareApplication JSON-LD has no `offers` for the same reason).
 */
export default function PricingPage() {
    const demoHref = supportWhatsAppUrl("Hi Bookly, I'd like a demo") ?? `mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent('Bookly demo request')}`;

    return (
        <SiteShell current="/pricing" jsonLd={[breadcrumbJsonLd(CRUMBS), softwareApplicationJsonLd(), faqJsonLd(PRICING_FAQ)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="Pricing"
                title="Three plans. Prices coming soon."
                sub="We're still setting the prices. What we can tell you now is the shape, and that there's a free way to start."
            />

            <Section labelledBy="plans">
                <h2 id="plans" className="sr-only">Plans</h2>
                <ul className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
                    {TIERS.map((t) => (
                        <li
                            key={t.name}
                            className={cn(
                                'flex flex-col rounded-card-lg p-6 sm:p-7',
                                m.lift,
                                t.featured
                                    ? 'bg-green text-cream shadow-card-lg'
                                    : 'border border-border bg-surface text-text shadow-card hover:shadow-card-hover',
                            )}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-[1.5rem] font-bold">{t.name}</h3>
                                {t.featured && (
                                    <span className="rounded-full bg-accent px-3 py-1 text-small font-semibold text-accent-fg">Most shops</span>
                                )}
                            </div>
                            <p className={cn('mt-1 text-body', t.featured ? 'text-cream/90' : 'text-muted')}>{t.who}</p>

                            <p className="mt-6 font-display text-[2rem] font-semibold leading-none">Coming soon</p>
                            <p className={cn('mt-2 text-small', t.featured ? 'text-cream/90' : 'text-muted')}>Prices in GH₵, announced shortly</p>

                            <ul className={cn('mt-6 flex-1 space-y-3 border-t pt-6', t.featured ? 'border-cream/20' : 'border-border')}>
                                {t.points.map((p) => (
                                    <li key={p} className="flex gap-2.5 text-body">
                                        <Check className={cn('mt-1 h-4 w-4 shrink-0', t.featured ? 'text-accent' : 'text-primary')} strokeWidth={3} aria-hidden />
                                        {p}
                                    </li>
                                ))}
                            </ul>

                            <ButtonLink
                                href="/register"
                                event="Signup"
                                variant={t.featured ? 'accent' : 'primary'}
                                className="mt-8 w-full"
                            >
                                Start free<span className="sr-only"> on {t.name}</span>
                            </ButtonLink>
                        </li>
                    ))}
                </ul>

                <p className="mt-8 max-w-2xl text-body text-muted">
                    You pay Meta&apos;s own WhatsApp message rates directly. We add nothing on top. Instagram and
                    Messenger cost nothing at all.
                </p>

                <div className="mt-10 flex flex-col gap-4 rounded-card border border-border bg-surface-2 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-[1.125rem] font-bold text-text">Not sure which plan fits?</h3>
                        <p className="mt-1 text-body text-muted">We&apos;ll show you Bookly on your own services and hours.</p>
                    </div>
                    <ButtonLink href={demoHref} event="Demo Request" variant="secondary">Ask for a demo</ButtonLink>
                </div>
            </Section>

            <Section tone="soft" labelledBy="pricing-faq">
                <SectionTitle id="pricing-faq" eyebrow="Questions" title="Pricing questions." />
                <div className="mt-8 max-w-3xl"><FaqList items={PRICING_FAQ} /></div>
                <p className="mt-6 text-body text-muted">
                    More on the <Link href="/faq" className="font-semibold text-primary underline underline-offset-4">questions page</Link>, or see{' '}
                    <Link href="/features" className="font-semibold text-primary underline underline-offset-4">what Bookly does</Link>.
                </p>
            </Section>

            <ClosingCTA
                title="Start free while we finish the prices."
                sub="No card, and nothing to set up first."
                secondary={{ href: '/features', label: 'See what it does' }}
            />
        </SiteShell>
    );
}
