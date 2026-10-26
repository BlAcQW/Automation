import Link from 'next/link';
import { Clock3, Mail, MessageCircle } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { ButtonLink, CheckList, ClosingCTA, PageHero, Panel, Section, SectionTitle } from '@/components/marketing/primitives';
import { TrustStrip } from '@/components/marketing/sections';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { LEGAL_EMAIL, SITE_TAGLINE, supportWhatsAppUrl } from '@/lib/site';

const CRUMBS = [{ name: 'About and contact', path: '/about' }];

export const metadata = pageMetadata({
    title: 'About Bookly and how to contact us',
    description:
        'Bookly is made in Ghana for small shops that live on WhatsApp. Here is why we built it, what we believe and how to reach a person.',
    path: '/about',
});

const BELIEFS = [
    'Your customers should book the way they already talk to you: on WhatsApp',
    'No payment gateway, no secret keys, nothing technical to set up',
    'Honest numbers only. We never invent customers, reviews or results',
    'Your customer list belongs to you, not to your staff and not to us',
] as const;

export default function AboutPage() {
    const whatsapp = supportWhatsAppUrl('Hi Bookly, I have a question');
    const demo = supportWhatsAppUrl("Hi Bookly, I'd like a demo") ?? `mailto:${LEGAL_EMAIL}?subject=${encodeURIComponent('Bookly demo request')}`;

    return (
        <SiteShell current="/about" jsonLd={[breadcrumbJsonLd(CRUMBS)]}>
            <PageHero
                crumbs={CRUMBS}
                eyebrow="About Bookly"
                title={SITE_TAGLINE}
                sub="Bookly is made in Ghana for the salons, boutiques, food vendors and small shops that run their business from a phone."
            />

            <Section labelledBy="why">
                <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
                    <SectionTitle
                        id="why"
                        eyebrow="Why we built it"
                        title="Because the booking goes to whoever answers first."
                        sub="Small shops in Ghana already take their bookings on WhatsApp. The trouble is answering while you work, chasing deposits and remembering who said two o'clock. Bookly does that part, so your shop keeps taking bookings even when your hands are full."
                    />
                    <div>
                        <h3 className="text-[1.125rem] font-bold text-text">What we believe</h3>
                        <CheckList items={BELIEFS} className="mt-4" />
                    </div>
                </div>
            </Section>

            <Section tone="surface" className="!py-8 sm:!py-10" labelledBy="trust">
                <h2 id="trust" className="sr-only">Why you can trust Bookly</h2>
                <TrustStrip />
            </Section>

            <Section tone="soft" id="contact" labelledBy="contact-title">
                <SectionTitle
                    id="contact-title"
                    eyebrow="Contact"
                    title="Talk to a person."
                    sub="A person replies during business hours, Ghana time. Most questions are answered the same day."
                />
                <ul className="mt-10 grid gap-4 md:grid-cols-3">
                    {whatsapp && (
                        <li>
                            <Panel className="h-full">
                                <MessageCircle className="h-6 w-6 text-primary" aria-hidden />
                                <h3 className="mt-4 text-[1.125rem] font-bold text-text">WhatsApp</h3>
                                <p className="mt-1.5 text-body text-muted">The quickest way to reach us.</p>
                                <ButtonLink href={whatsapp} variant="primary" size="md" className="mt-4">Message us</ButtonLink>
                            </Panel>
                        </li>
                    )}
                    <li>
                        <Panel className="h-full">
                            <Mail className="h-6 w-6 text-primary" aria-hidden />
                            <h3 className="mt-4 text-[1.125rem] font-bold text-text">Email</h3>
                            <p className="mt-1.5 break-words text-body text-muted">{LEGAL_EMAIL}</p>
                            <ButtonLink href={`mailto:${LEGAL_EMAIL}`} variant="secondary" size="md" className="mt-4">Send an email</ButtonLink>
                        </Panel>
                    </li>
                    <li>
                        <Panel className="h-full">
                            <Clock3 className="h-6 w-6 text-primary" aria-hidden />
                            <h3 className="mt-4 text-[1.125rem] font-bold text-text">See it working</h3>
                            <p className="mt-1.5 text-body text-muted">We&apos;ll show you Bookly on your own services and hours.</p>
                            <ButtonLink href={demo} event="Demo Request" variant="secondary" size="md" className="mt-4">Ask for a demo</ButtonLink>
                        </Panel>
                    </li>
                </ul>
                <p className="mt-8 text-body text-muted">
                    Already using Bookly? The <Link href="/support" className="font-semibold text-primary underline underline-offset-4">support page</Link> answers the common questions.
                    Read how we handle your data in our <Link href="/privacy" className="font-semibold text-primary underline underline-offset-4">privacy policy</Link>.
                </p>
            </Section>

            <ClosingCTA title="Open your shop on WhatsApp." sub="Free to start. Nothing to set up first." secondary={{ href: '/features', label: 'See what it does' }} />
        </SiteShell>
    );
}
