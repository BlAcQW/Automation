import { ArrowRight } from 'lucide-react';
import { cx as cn } from '@/components/marketing/cx';
import { SiteShell } from '@/components/marketing/site-shell';
import {
    Awning, ButtonLink, Container, Panel, Section, SectionTitle, SignupLink, ClosingCTA, motionStyles as m,
} from '@/components/marketing/primitives';
import {
    BusinessTypeCards, ChannelCards, JobsGrid, NoSetupBlock, Shopfront, StepsList, TrustStrip,
} from '@/components/marketing/sections';
import { LEAKS } from '@/components/marketing/content';
import { pageMetadata, softwareApplicationJsonLd } from '@/lib/seo';
import { SITE_TAGLINE } from '@/lib/site';

export const metadata = pageMetadata({
    title: 'Bookly: WhatsApp booking system for Ghana businesses',
    description:
        'Your shop, always open. Bookly answers WhatsApp while you work, books real free times, takes the deposit by Mobile Money and sends the reminder.',
    path: '/',
});

/**
 * Home. A typographic hero (the tagline in Clash Display) next to a
 * shopfront illustration, then the honest sections. Every number on the
 * page is something Bookly does, never a customer count.
 */
export default function HomePage() {
    return (
        <SiteShell current="/" jsonLd={[softwareApplicationJsonLd()]}>
            {/* Hero */}
            <header className="bg-bg">
                <Container className="grid items-center gap-12 pb-14 pt-8 sm:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-20 lg:pt-16">
                    <div>
                        <p className={cn('text-small font-semibold uppercase tracking-[0.08em] text-primary', m.enter)}>
                            WhatsApp bookings for small businesses in Ghana
                        </p>
                        <h1 className={cn('mt-4 font-display text-hero text-text [text-wrap:balance]', m.enterTitle)}>
                            {SITE_TAGLINE}
                        </h1>
                        <p className={cn('mt-5 max-w-xl text-[1.0625rem] text-muted sm:text-xl sm:leading-relaxed', m.enter, m.d1)}>
                            Bookly answers your WhatsApp while you work. It books customers into times you&apos;re really
                            free, takes the deposit by Mobile Money and sends the reminder, so they show up.
                        </p>
                        <div className={cn('mt-8 flex flex-col gap-3 sm:flex-row', m.enter, m.d2)}>
                            <SignupLink size="xl">
                                Start free <ArrowRight className="h-5 w-5" aria-hidden />
                            </SignupLink>
                            <ButtonLink href="/features" variant="secondary" size="xl">
                                See what it does
                            </ButtonLink>
                        </div>
                        <p className={cn('mt-4 text-small text-muted', m.enter, m.d3)}>
                            No card needed. Nothing to set up first.
                        </p>
                    </div>
                    <Shopfront className={cn(m.enter, m.d2)} />
                </Container>
            </header>

            <Awning />

            <Section tone="surface" className="!py-8 sm:!py-10" labelledBy="trust">
                <h2 id="trust" className="sr-only">Why you can trust Bookly</h2>
                <TrustStrip />
            </Section>

            {/* The two leaks */}
            <Section labelledBy="leaks">
                <SectionTitle
                    id="leaks"
                    eyebrow="Where the bookings go"
                    title="Two leaks, and both of them are money."
                    sub="Not admin. Two specific moments where a customer slips away."
                />
                <ul className="mt-10 grid gap-4 sm:grid-cols-2">
                    {LEAKS.map(({ icon: Icon, title, body }) => (
                        <li key={title}>
                            <Panel className="h-full">
                                <Icon className="h-6 w-6 text-primary" aria-hidden />
                                <h3 className="mt-4 text-[1.125rem] font-bold text-text">{title}</h3>
                                <p className="mt-1.5 text-body text-muted">{body}</p>
                            </Panel>
                        </li>
                    ))}
                </ul>
                <p className="mt-8 max-w-2xl text-[1.0625rem] font-medium text-text">
                    Bookly answers while you&apos;re mid-job, offers only the times you&apos;re really free, and holds
                    the slot with a deposit.
                </p>
            </Section>

            {/* How it works */}
            <Section tone="green" labelledBy="how">
                <SectionTitle
                    id="how"
                    inverse
                    eyebrow="How it works"
                    title="Three steps, once. Then it just runs."
                    sub="Most people are taking bookings the same afternoon."
                />
                <div className="mt-10"><StepsList inverse /></div>
            </Section>

            {/* What it does */}
            <Section labelledBy="jobs">
                <SectionTitle
                    id="jobs"
                    eyebrow="What it does"
                    title="A front desk that never takes lunch."
                    sub="The jobs Bookly takes off your hands, in the order you'll feel them."
                />
                <div className="mt-10"><JobsGrid limit={6} /></div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <ButtonLink href="/features" variant="secondary">Everything it does</ButtonLink>
                    <ButtonLink href="/features/whatsapp-bookings" variant="ghost">
                        How WhatsApp bookings work <ArrowRight className="h-4 w-4" aria-hidden />
                    </ButtonLink>
                </div>
            </Section>

            <Section tone="soft" labelledBy="no-setup">
                <NoSetupBlock headingId="no-setup" />
            </Section>

            {/* Channels */}
            <Section labelledBy="channels">
                <SectionTitle
                    id="channels"
                    eyebrow="Where it works"
                    title="Your customers don't install anything."
                    sub="They message you the way they already do. One assistant and one diary behind every channel."
                />
                <div className="mt-10"><ChannelCards /></div>
            </Section>

            {/* Business types */}
            <Section tone="surface" labelledBy="made-for">
                <SectionTitle
                    id="made-for"
                    eyebrow="Made for"
                    title="Built for a business run from a phone."
                    sub="Big enough to lose bookings while you're busy, too small to pay someone to answer the phone."
                />
                <div className="mt-10"><BusinessTypeCards /></div>
            </Section>

            <ClosingCTA
                title="Stop losing bookings because you were busy."
                sub="Set it up this afternoon. Bookly answers the next message that comes in."
            />
        </SiteShell>
    );
}
