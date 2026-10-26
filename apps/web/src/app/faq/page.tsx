import Link from 'next/link';
import { SiteShell } from '@/components/marketing/site-shell';
import { ClosingCTA, PageHero, Section } from '@/components/marketing/primitives';
import { FaqList } from '@/components/marketing/sections';
import { FAQ_GROUPS, PRICING_FAQ } from '@/components/marketing/content';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

const CRUMBS = [{ name: 'Questions', path: '/faq' }];

export const metadata = pageMetadata({
    title: 'Bookly questions: WhatsApp bookings and payments',
    description:
        'Straight answers about how Bookly books your customers on WhatsApp, takes Mobile Money deposits, pays you and keeps your customer list safe.',
    path: '/faq',
});

const GROUPS = [...FAQ_GROUPS, { title: 'Pricing', items: PRICING_FAQ }];

export default function FaqPage() {
    return (
        <SiteShell current="/faq" jsonLd={[breadcrumbJsonLd(CRUMBS), faqJsonLd(GROUPS.flatMap((g) => g.items))]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="Questions"
                title="Straight answers."
                sub="The things people actually ask before they start."
            />

            {GROUPS.map((g, i) => {
                const id = `faq-${g.title.toLowerCase().replace(/\s+/g, '-')}`;
                return (
                    <Section key={g.title} tone={i % 2 ? 'soft' : 'bg'} labelledBy={id} className="!py-10 sm:!py-14">
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
                            <h2 id={id} className="text-[1.5rem] font-bold text-text sm:text-[1.75rem]">{g.title}</h2>
                            <FaqList items={g.items} />
                        </div>
                    </Section>
                );
            })}

            <Section tone="surface" className="!py-10">
                <p className="text-body text-muted">
                    Already using Bookly and stuck? <Link href="/support" className="font-semibold text-primary underline underline-offset-4">Visit support</Link>.
                    {' '}Want to talk to us? <Link href="/about#contact" className="font-semibold text-primary underline underline-offset-4">Get in touch</Link>.
                </p>
            </Section>

            <ClosingCTA title="Still wondering? Just try it." sub="Free to start, and you can be taking bookings this afternoon." />
        </SiteShell>
    );
}
